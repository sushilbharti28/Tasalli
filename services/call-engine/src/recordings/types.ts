/**
 * Call recordings must live in India, not at the telephony provider (CLAUDE.md rule 9).
 * The provider keeps a recording only until our copy is saved and size-checked.
 */

/** Where recordings are stored. LocalFsRecordingStorage for dev and the pilot box; production uses object storage in the Mumbai region (ap-south-1) behind this same interface. */
export interface RecordingStorage {
  /** Save the audio under `key` (`<callId>/<recordingSid>.mp3`), replacing any earlier copy. Returns the bytes now stored. */
  put(key: string, data: Buffer, mimeType: string): Promise<{ size: number }>;
  /** Size of the stored copy in bytes, or null if there is none. */
  size(key: string): Promise<number | null>;
  get(key: string): Promise<{ data: Buffer; mimeType: string } | null>;
}

/** The provider side of a recording: fetch the audio, then delete it there. */
export interface RecordingClient {
  /** Authenticated download of the mp3. `expectedSize` is the Content-Length when the provider sent one. */
  download(recordingUrl: string): Promise<{ data: Buffer; expectedSize: number | null }>;
  /** Idempotent: a recording that is already gone is success. */
  remove(recordingSid: string): Promise<void>;
}

/** calls.recording_url values we write start with this; anything else (a provider URL) is not our copy. */
export const RECORDING_URL_PREFIX = '/internal/recordings/';

export const recordingKey = (callId: string, recordingSid: string) => `${callId}/${recordingSid}.mp3`;
export const recordingUrlFor = (key: string) => `${RECORDING_URL_PREFIX}${key}`;
export const isOwnRecordingUrl = (url: string | null): url is string => !!url && url.startsWith(RECORDING_URL_PREFIX);
export const keyFromRecordingUrl = (url: string) => url.slice(RECORDING_URL_PREFIX.length);
