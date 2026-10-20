import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncDatabase } from '../src/database.js';
import { temporaryState } from './helpers.js';

describe('sync database', () => {
  let state: Awaited<ReturnType<typeof temporaryState>>;
  beforeEach(async () => {
    state = await temporaryState();
  });
  afterEach(async () => {
    await state.cleanup();
  });

  it('creates missing directories and persists state across restarts', async () => {
    const path = join(state.directory, 'nested', 'state.json');
    const db = new SyncDatabase(path);
    await db.init();
    expect(db.isPosted('one')).toBe(false);
    await db.markAsPosted('one', 2);
    await db.markAsPosted('one', 2);
    await db.incrementFailed();
    expect(db.getStats()).toEqual({ total: 1, failed: 1, mediaUploaded: 2 });
    const restored = new SyncDatabase(path);
    await restored.init();
    expect(restored.isPosted('one')).toBe(true);
    expect(restored.getStats()).toEqual(db.getStats());
  });

  it('loads the legacy state shape without discarding IDs', async () => {
    await writeFile(
      state.path,
      JSON.stringify({
        postedItems: ['legacy'],
        lastSync: null,
        stats: { total: 4, failed: 1, mediaUploaded: 3 },
      }),
    );
    const db = new SyncDatabase(state.path);
    await db.init();
    expect(db.isPosted('legacy')).toBe(true);
    expect(db.getStats().total).toBe(4);
  });

  it.each(['broken JSON', 'null', '{}', '{"postedItems": [123]}'])(
    'fails closed on corrupt state: %s',
    async (contents) => {
      await writeFile(state.path, contents);
      await expect(new SyncDatabase(state.path).init()).rejects.toThrow();
      expect(await readFile(state.path, 'utf8')).toBe(contents);
    },
  );

  it('does not expose mutable statistics', async () => {
    const db = new SyncDatabase(state.path);
    await db.init();
    expect(db.getStats()).not.toBe(db.getStats());
  });

  it('rolls back in-memory state if persistence fails', async () => {
    const { JSONFile } = await import('lowdb/node');
    const db = new SyncDatabase(state.path);
    await db.init();
    vi.spyOn(JSONFile.prototype, 'write').mockRejectedValue(new Error('disk full'));
    await expect(db.markAsPosted('new')).rejects.toThrow('disk full');
    expect(db.isPosted('new')).toBe(false);
    expect(db.getStats().total).toBe(0);
  });
});
