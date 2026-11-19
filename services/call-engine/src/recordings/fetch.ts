import type { Deps } from '../engine/deps.js';
import { isOwnRecordingUrl, keyFromRecordingUrl, recordingKey, recordingUrlFor } from './types.js';

/**
 * Job `recording.fetch`: move one recording from the provider to our storage in India.
 *   1. download (skipped if calls.recording_url already points at our verified copy)
 *   2. save, then check the stored size equals the downloaded size (and the Content-Length, if sent)
 *   3. write our path to calls.recording_url
 *   4. only then delete from the provider (404 = already gone = success)
 * Idempotent per RecordingSid: every step can be re-run. A failure throws so the queue retries with backoff;
 * nothing is deleted at the provider before step 3 has succeeded.
 */
export async function fetchRecording(d: Deps, job: { callId: string; recordingSid: string; recordingUrl: string }): Promise<void> {
  const rec = d.recordings;
  if (!rec) return void d.log.error('recording.fetch without recording storage configured; recording left at the provider', { callId: job.callId });
  const call = await d.store.getCall(job.callId);
  if (!call) return void d.log.warn('recording for unknown call ignored', { callId: job.callId });

  const key = recordingKey(call.id, job.recordingSid);
  let stored = isOwnRecordingUrl(call.recordingUrl) && keyFromRecordingUrl(call.recordingUrl) === key ? await rec.storage.size(key) : null;
  if (stored === null || stored === 0) {
    const { data, expectedSize } = await rec.client.download(job.recordingUrl);
    if (data.length === 0) throw new Error('downloaded recording is empty');
    if (expectedSize !== null && expectedSize !== data.length) throw new Error(`download truncated: ${data.length} of ${expectedSize} bytes`);
    const saved = await rec.storage.put(key, data, 'audio/mpeg');
    const onDisk = await rec.storage.size(key);
    if (saved.size !== data.length || onDisk !== data.length) throw new Error(`stored copy size mismatch: ${onDisk} vs ${data.length}`);
    await d.store.updateCall(call.id, { recordingUrl: recordingUrlFor(key) });
    stored = onDisk;
  }
  // Last safety check right before the irreversible step.
  if (!stored || (await rec.storage.size(key)) !== stored) throw new Error('local copy missing; not deleting from the provider');
  await rec.client.remove(job.recordingSid);
  d.log.info('recording moved to local storage and deleted at the provider', { callId: call.id, bytes: stored });
}
