import type { CallLanguage, SpeechProvider } from '@tasalli/contracts';

/**
 * Offline speech provider. synthesize() returns the text itself as a UTF-8 "audio" file
 * (text/plain), so local dev and tests can read exactly what a call would say.
 * transcribe() understands audio produced by fakeAudioUrl() and plain UTF-8 text.
 */
export class FakeSpeech implements SpeechProvider {
  readonly name = 'fake' as const;
  synthCount = 0;
  transcribeCount = 0;
  /** Make the next N synthesize calls fail (provider outage). */
  failNextSynth = 0;
  /** Override the confidence returned for plain-text audio. */
  defaultConfidence = 0.9;

  async synthesize(text: string, language: CallLanguage): Promise<{ audio: Buffer; mimeType: string }> {
    if (this.failNextSynth > 0) {
      this.failNextSynth--;
      throw new Error('FakeSpeech: synthesize failed');
    }
    this.synthCount++;
    return { audio: Buffer.from(`[${language}] ${text}`, 'utf8'), mimeType: 'text/plain; charset=utf-8' };
  }

  async transcribe(audio: Buffer, _language: CallLanguage): Promise<{ transcript: string; confidence: number }> {
    this.transcribeCount++;
    const raw = audio.toString('utf8');
    try {
      const parsed = JSON.parse(raw) as { t?: unknown; c?: unknown };
      if (typeof parsed.t === 'string') return { transcript: parsed.t, confidence: typeof parsed.c === 'number' ? parsed.c : this.defaultConfidence };
    } catch {
      // plain text
    }
    return { transcript: raw, confidence: this.defaultConfidence };
  }
}

/** Fetches audio for transcription. Understands fake-audio: URLs; anything else uses HTTP fetch. */
export async function fetchAudio(url: string): Promise<Buffer> {
  if (url.startsWith('fake-audio:')) return Buffer.from(url.slice('fake-audio:'.length), 'base64url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
