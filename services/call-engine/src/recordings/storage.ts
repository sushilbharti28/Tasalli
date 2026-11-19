import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { RecordingStorage } from './types.js';

const KEY = /^[0-9a-zA-Z-]{1,64}\/[0-9a-zA-Z]{1,64}\.mp3$/;

function safePath(dir: string, key: string): string {
  if (!KEY.test(key)) throw new Error('bad recording key');
  const p = normalize(join(dir, key));
  if (!p.startsWith(normalize(dir) + sep)) throw new Error('bad recording key');
  return p;
}

/**
 * Recordings on the local disk under RECORDINGS_DIR (default ./.recordings). For development and a single-box pilot.
 * Production: use storage in the Mumbai region (for example an S3 bucket in ap-south-1) by implementing RecordingStorage;
 * recordings are health-adjacent data and must not leave India. Delete on request: remove the file named in calls.recording_url.
 */
export class LocalFsRecordingStorage implements RecordingStorage {
  constructor(private readonly dir: string) {}

  async put(key: string, data: Buffer, _mimeType?: string): Promise<{ size: number }> {
    const path = safePath(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.part`;
    await writeFile(tmp, data);
    await rename(tmp, path); // atomic: a half-written file is never visible under the final name
    return { size: (await stat(path)).size };
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(safePath(this.dir, key))).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async get(key: string) {
    try {
      return { data: await readFile(safePath(this.dir, key)), mimeType: 'audio/mpeg' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}

export class MemoryRecordingStorage implements RecordingStorage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.files.set(key, data); return { size: data.length }; }
  async size(key: string) { return this.files.get(key)?.length ?? null; }
  async get(key: string) { const d = this.files.get(key); return d ? { data: d, mimeType: 'audio/mpeg' } : null; }
}
