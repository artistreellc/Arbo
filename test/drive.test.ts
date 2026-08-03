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
