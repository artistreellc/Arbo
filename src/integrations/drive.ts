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
