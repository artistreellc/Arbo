// READ-ONLY Google Drive: the hourly assistant's daily "Lead Log" sheets and
// "Ops State" docs (owner ruling R24, Mike 2026-09-27: "Give Arbo read only
// access"). One job: list the folder's newest files and export each as plain
// text. It cannot create, edit, move, share, or trash anything — the only
// HTTP method in this file is GET, pinned by test, and the Google consent
// asks for `drive.readonly`, so the credential cannot write either.
//
// Nothing read here is stored in a database or written anywhere: it lives
// in memory, feeds the Quo study, and shows only in the keywalled app.
// Logs carry counts and file names' dates only — never a row (§4.3).

/** The hourly assistant's lead-log folder (Mike's assistant brief, 2026-09-25). */
export const LEAD_LOG_FOLDER_ID = '1aP2VLR3mU7B95JELfwDFIZUqL1btBNQE';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const DOC = 'application/vnd.google-apps.document';

export interface DriveTextFile {
  id: string;
  name: string;
  modifiedTime: string | null;
  kind: 'sheet' | 'doc';
  /** CSV for a sheet (first tab), plain text for a doc. */
  text: string;
}

export interface DriveFolderReader {
  /** The newest sheets and docs in the folder, as text. Throws a named error when Drive cannot be read. */
  recent(limit: number): Promise<DriveTextFile[]>;
}

type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/** Drive refused — carries the status so the app can say WHY (403 = the sign-in lacks Drive read). */
export class DriveReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DriveReadError';
  }
}

export function createDriveFolderReader(
  token: () => Promise<string>,
  folderId: string = LEAD_LOG_FOLDER_ID,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): DriveFolderReader {
  const get = async (url: string) => {
    const res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${await token()}` } });
    // Status only — a Drive error body can quote file content (§4.3).
    if (!res.ok) throw new DriveReadError(`Drive GET -> ${res.status}`, res.status);
    return res;
  };
  return {
    async recent(limit) {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and (mimeType = '${SHEET}' or mimeType = '${DOC}')`);
      const list = (await (await get(`${DRIVE}/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=${Math.max(1, Math.min(limit, 20))}&fields=files(id,name,mimeType,modifiedTime)`)).json()) as {
        files?: Array<{ id?: unknown; name?: unknown; mimeType?: unknown; modifiedTime?: unknown }>;
      };
      const out: DriveTextFile[] = [];
      for (const f of list.files ?? []) {
        if (typeof f.id !== 'string' || typeof f.name !== 'string') continue;
        const kind = f.mimeType === SHEET ? 'sheet' : f.mimeType === DOC ? 'doc' : null;
        if (!kind) continue;
        const mime = kind === 'sheet' ? 'text/csv' : 'text/plain';
        const text = await (await get(`${DRIVE}/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(mime)}`)).text();
        out.push({ id: f.id, name: f.name, modifiedTime: typeof f.modifiedTime === 'string' ? f.modifiedTime : null, kind, text });
      }
      return out;
    },
  };
}

/** Minimal CSV parser (quoted fields, "" escapes, CRLF) — the export's own format, no dependency. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
