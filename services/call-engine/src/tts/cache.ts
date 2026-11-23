import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { CallLanguage, SpeechProvider } from '@tasalli/contracts';
import { withoutPauseMarks } from '../scripts/builder.js';

/** Where generated audio lives. Local filesystem for dev; object storage (Mumbai region) later. */
export interface AudioStorage {
  has(key: string): Promise<boolean>;
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; mimeType: string } | null>;
  /** URL the telephony provider fetches the audio from. */
  publicUrl(key: string): string;
}

const EXT: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'text/plain; charset=utf-8': 'txt',
};
const MIME_BY_EXT: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8' };

export function extensionFor(mimeType: string): string {
  return EXT[mimeType] ?? 'bin';
}

/** Key = sha256(provider, language, text). Same words in the same language are generated once. */
export function audioKey(provider: string, language: CallLanguage, text: string, mimeType: string): string {
  const hash = createHash('sha256').update(`${provider}\u0000${language}\u0000${text}`).digest('hex');
  return `${language}/${hash}.${extensionFor(mimeType)}`;
}

export class MemoryAudioStorage implements AudioStorage {
  readonly files = new Map<string, { data: Buffer; mimeType: string }>();
  constructor(private readonly baseUrl = 'http://audio.test/audio') {}
  async has(key: string) {
    return this.files.has(key);
  }
  async put(key: string, data: Buffer, mimeType: string) {
    this.files.set(key, { data, mimeType });
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  publicUrl(key: string) {
    return `${this.baseUrl}/${key}`;
  }
}

export class LocalFsAudioStorage implements AudioStorage {
  constructor(private readonly dir: string, private readonly baseUrl: string) {}
  private path(key: string): string {
    if (!/^[a-z]{2}\/[0-9a-f]{64}\.[a-z0-9]+$/.test(key)) throw new Error('bad audio key');
    const p = normalize(join(this.dir, key));
    if (!p.startsWith(normalize(this.dir) + sep)) throw new Error('bad audio key');
    return p;
  }
  async has(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    try {
      const data = await readFile(this.path(key));
      return { data, mimeType: MIME_BY_EXT[key.split('.').pop() ?? ''] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }
  publicUrl(key: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/${key}`;
  }
}

/**
 * Text -> audio URL with a content-hash cache. The provider's mime type is learned on the first
 * synthesis and remembered per (provider, language), so cache hits need no synthesis at all.
 */
export class AudioCache {
  private mimeByLang = new Map<string, string>();
  /** url -> text, for previews, logs and tests. */
  private readonly texts = new Map<string, string>();
  private inflight = new Map<string, Promise<string>>();

  constructor(private readonly speech: SpeechProvider, private readonly storage: AudioStorage) {}

  async urlFor(text: string, language: CallLanguage): Promise<string> {
    text = withoutPauseMarks(text); // TTS files have no SSML: the longer pause mark is dropped
    // After a restart the provider's mime type is not known yet: probe each supported extension.
    const known = this.mimeByLang.get(`${this.speech.name}/${language}`);
    for (const mime of known ? [known] : Object.keys(EXT)) {
      const key = audioKey(this.speech.name, language, text, mime);
      if (await this.storage.has(key)) return this.remember(key, text);
    }
    const flightKey = `${language}\u0000${text}`;
    const existing = this.inflight.get(flightKey);
    if (existing) return existing;
    const p = (async () => {
      const { audio, mimeType } = await this.speech.synthesize(text, language);
      this.mimeByLang.set(`${this.speech.name}/${language}`, mimeType);
      const key = audioKey(this.speech.name, language, text, mimeType);
      if (!(await this.storage.has(key))) await this.storage.put(key, audio, mimeType);
      return this.remember(key, text);
    })();
    this.inflight.set(flightKey, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(flightKey);
    }
  }

  textFor(url: string): string | undefined {
    return this.texts.get(url);
  }

  private remember(key: string, text: string): string {
    const url = this.storage.publicUrl(key);
    this.texts.set(url, text);
    return url;
  }
}
