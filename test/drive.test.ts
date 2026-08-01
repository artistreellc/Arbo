import { describe, it, expect } from 'vitest';
import {
  ensurePropertyFolders,
  propertyFolderName,
  PROPERTY_SUBFOLDERS,
  type DriveApi,
  type DriveFolder,
} from '../src/integrations/drive.js';

// In-memory Drive fake — verifies the filing orchestration without the network.
function makeFakeDrive() {
  const folders = new Map<string, DriveFolder>(); // key: `${parentId}/${title}`
  let seq = 0;
  const api: DriveApi = {
    async findFolder(title, parentId) {
      return folders.get(`${parentId}/${title}`) ?? null;
    },
    async createFolder(title, parentId) {
      const f = { id: `f${++seq}`, title, parentId };
      folders.set(`${parentId}/${title}`, f);
      return f;
    },
  };
  return { api, folders };
}

describe('Drive per-property filing (§7)', () => {
  it('names the property folder canonically', () => {
    expect(propertyFolderName('742 Evergreen Terrace', 'Virginia Beach')).toBe(
      '742 Evergreen Terrace — Virginia Beach',
    );
  });

  it('creates the property folder + all four subfolders', async () => {
    const { api } = makeFakeDrive();
    const res = await ensurePropertyFolders(api, 'ROOT', '742 Evergreen Terrace', 'Virginia Beach');
    expect(res.propertyFolderId).toBeTruthy();
    for (const sub of PROPERTY_SUBFOLDERS) {
      expect(res.subfolders[sub]).toBeTruthy();
    }
  });

  it('is idempotent — refiling reuses folders, never duplicates', async () => {
    const { api, folders } = makeFakeDrive();
    const first = await ensurePropertyFolders(api, 'ROOT', '10 Birch Ln', 'Norfolk');
    const countAfterFirst = folders.size;
    const second = await ensurePropertyFolders(api, 'ROOT', '10 Birch Ln', 'Norfolk');
    expect(second.propertyFolderId).toBe(first.propertyFolderId);
    expect(second.subfolders).toEqual(first.subfolders);
    expect(folders.size).toBe(countAfterFirst); // no new folders created
  });
});
