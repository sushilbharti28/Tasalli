import type { CallLanguage, SpeechProvider } from '@tasalli/contracts';

/**
 * In-memory SpeechProvider. `synthesize` returns the text as bytes so tests
 * can check what would be spoken. `transcribe` returns the bytes as text,
 * so a test "recording" is just the transcript encoded as a Buffer.
 */
export class FakeSpeechProvider implements SpeechProvider {
  readonly name = 'fake' as const;
  readonly synthesized: Array<{ text: string; language: CallLanguage }> = [];

  async synthesize(text: string, language: CallLanguage): Promise<{ audio: Buffer; mimeType: string }> {
    this.synthesized.push({ text, language });
    return { audio: Buffer.from(text, 'utf8'), mimeType: 'text/plain' };
  }

  async transcribe(audio: Buffer, _language: CallLanguage): Promise<{ transcript: string; confidence: number }> {
    const transcript = audio.toString('utf8');
    return { transcript, confidence: transcript.trim() ? 0.9 : 0 };
  }
}
