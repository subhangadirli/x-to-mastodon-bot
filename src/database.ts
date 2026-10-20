import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { z } from 'zod';

const counter = z.number().int().nonnegative();
const stateSchema = z.object({
  postedItems: z.array(z.string()),
  lastSync: z.iso.datetime().nullable(),
  stats: z.object({ total: counter, failed: counter, mediaUploaded: counter }),
});
export type SyncState = z.infer<typeof stateSchema>;

export class SyncDatabase {
  private readonly db: Low<SyncState>;
  private posted = new Set<string>();

  constructor(private readonly filePath: string) {
    this.db = new Low(new JSONFile<SyncState>(filePath), {
      postedItems: [],
      lastSync: null,
      stats: { total: 0, failed: 0, mediaUploaded: 0 },
    });
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    let raw: unknown = this.db.data;
    try {
      raw = JSON.parse(await readFile(this.filePath, 'utf8'));
      // Distinguish a missing file from JSON null; corrupt state must never reset silently.
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const result = stateSchema.safeParse(raw);
    if (!result.success)
      throw new Error('Invalid sync state. Restore a valid backup before running.');
    this.db.data = result.data;
    this.posted = new Set(result.data.postedItems);
    // Persist a new state file before making any external changes. Lowdb uses atomic writes.
    await this.db.write();
  }

  isPosted(id: string): boolean {
    return this.posted.has(id);
  }

  async markAsPosted(id: string, mediaCount = 0): Promise<void> {
    if (this.posted.has(id)) return;
    const next: SyncState = {
      postedItems: [id, ...this.db.data.postedItems],
      lastSync: new Date().toISOString(),
      stats: {
        ...this.db.data.stats,
        total: this.db.data.stats.total + 1,
        mediaUploaded: this.db.data.stats.mediaUploaded + mediaCount,
      },
    };
    await this.save(next);
    this.posted.add(id);
  }

  async incrementFailed(): Promise<void> {
    await this.save({
      ...this.db.data,
      stats: { ...this.db.data.stats, failed: this.db.data.stats.failed + 1 },
    });
  }

  getStats(): Readonly<SyncState['stats']> {
    return { ...this.db.data.stats };
  }

  private async save(next: SyncState): Promise<void> {
    const previous = this.db.data;
    this.db.data = next;
    try {
      await this.db.write();
    } catch (error) {
      this.db.data = previous;
      throw error;
    }
  }
}
