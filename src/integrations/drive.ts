/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// Google Drive filing (brief §7). Per-property folder convention:
//
//   ARBOR Clients/
//     <Property Address — City>/
//       Estimates/
//       Signed Contracts/
//       Job Photos/
//       Documents/
//
// The Client Master index (DB) ties Drive file ids back to records.
//
// Auth: the production backend calls the Drive API with an injected access
// token (service account or stored OAuth). This module is auth-agnostic — pass
// a `DriveApi` implementation. The live folder tree for the pilot property was
// created under the real "ARBOR Clients" root (id in ARBOR_DRIVE_ROOT_FOLDER_ID).

export const PROPERTY_SUBFOLDERS = ['Estimates', 'Signed Contracts', 'Job Photos', 'Documents'] as const;
export type PropertySubfolder = (typeof PROPERTY_SUBFOLDERS)[number];

export interface DriveFolder {
  id: string;
  title: string;
  parentId?: string;
}

/** Minimal Drive surface this module needs — implemented by the live API or a fake. */
export interface DriveApi {
  findFolder(title: string, parentId: string): Promise<DriveFolder | null>;
  createFolder(title: string, parentId: string): Promise<DriveFolder>;
}

export interface PropertyFolders {
  propertyFolderId: string;
  subfolders: Record<PropertySubfolder, string>;
}

/** Canonical folder name for a property (matches the live pilot folder). */
export function propertyFolderName(address: string, city: string): string {
  return `${address.trim()} — ${city.trim()}`;
}

/**
 * Ensure a property's folder + the four subfolders exist under the ARBOR root.
 * Idempotent: reuses any folder that already exists, so re-filing never creates
 * duplicates (the same discipline as the property-twin dedupe).
 */
export async function ensurePropertyFolders(
  api: DriveApi,
  rootFolderId: string,
  address: string,
  city: string,
): Promise<PropertyFolders> {
  const name = propertyFolderName(address, city);
  const propertyFolder =
    (await api.findFolder(name, rootFolderId)) ?? (await api.createFolder(name, rootFolderId));

  const subfolders = {} as Record<PropertySubfolder, string>;
  for (const sub of PROPERTY_SUBFOLDERS) {
    const existing = await api.findFolder(sub, propertyFolder.id);
    const folder = existing ?? (await api.createFolder(sub, propertyFolder.id));
    subfolders[sub] = folder.id;
  }
  return { propertyFolderId: propertyFolder.id, subfolders };
}

// ---------------------------------------------------------------------------
// Live implementation over Drive API v3. `getAccessToken` is injected so this
// module stays independent of how the app authenticates (service account vs
// stored OAuth) — the one credential detail wired at deploy time.
// ---------------------------------------------------------------------------
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function createGoogleDriveApi(getAccessToken: () => Promise<string>): DriveApi {
  const authHeader = async () => ({ Authorization: `Bearer ${await getAccessToken()}` });

  return {
    async findFolder(title, parentId) {
      const q = `mimeType = '${FOLDER_MIME}' and trashed = false and name = ${JSON.stringify(title)} and '${parentId}' in parents`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
      const res = await fetch(url, { headers: { ...(await authHeader()) } });
      if (!res.ok) throw new Error(`Drive findFolder failed: ${res.status}`);
      const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
      const f = data.files?.[0];
      return f ? { id: f.id, title: f.name, parentId } : null;
    },
    async createFolder(title, parentId) {
      const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ name: title, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      if (!res.ok) throw new Error(`Drive createFolder failed: ${res.status}`);
      const f = (await res.json()) as { id: string; name: string };
      return { id: f.id, title: f.name, parentId };
    },
  };
}
