/**
 * Exotel Voicebot bridge: runs one call's conversation over Exotel's bidirectional WebSocket
 * (developer.exotel.com/docs/agentstream/stream-voicebot-applet).
 *
 * Exotel sends: connected, start (call_sid, stream_sid), media (base64 16-bit PCM, 8 kHz), dtmf, mark, stop.
 * We send:      media (our audio, chunks of 3,200 bytes = 100 ms), mark (tell us when playback reached here).
 *
 * The engine stays the same as with Twilio: the bridge turns what the parent says or presses into input events,
 * gives them to Engine.handleEvent, and plays the NextAction that comes back. Safety: like Twilio's Gather, we only
 * listen after the question has been played in full (the part before the last LONG_PAUSE mark is never listened to).
 */
import type { CallEvent, CallLanguage, CallStep, NextAction, SpeechProvider } from '@tasalli/contracts';
import { LONG_PAUSE_MARK, SAY_SPLIT } from '../scripts/builder.js';
import type { Logger } from '../log.js';
import { decodeSay } from './twilio.js';

export const SAMPLE_RATE = 8000;
/** 100 ms of 16-bit mono audio at 8 kHz: Exotel's minimum chunk, a multiple of 320 bytes. */
export const CHUNK_BYTES = 3200;
/** Frame energy (RMS of 16-bit samples) above which we treat the frame as speech. */
export const SPEECH_RMS = 600;
/** Speech must last this long to count (filters clicks). */
const MIN_SPEECH_MS = 200;
/** Silence after speech that ends the answer (Twilio speechTimeout = 1). */
const END_SILENCE_MS = 1000;
/** Longest answer we record before transcribing anyway. */
const MAX_SPEECH_MS = 8000;

export interface BridgeSocket {
  send(data: string): void;
  close(): void;
  on(event: 'message', fn: (data: string | Buffer) => void): void;
  on(event: 'close', fn: () => void): void;
}

export interface BridgeDeps {
  /** Engine.handleEvent: returns the provider's rendering of the NextAction (JSON for Exotel). */
  handleEvent(ev: CallEvent): Promise<{ status: number; contentType: string; body: string }>;
  /** Our call for an Exotel call sid. */
  findCall(providerCallId: string): Promise<{ id: string } | null>;
  /** The first prompt, kept by ExotelProvider at placeCall. */
  takeFirstStep(providerCallId: string): CallStep | undefined;
  speech: SpeechProvider;
  log: Logger;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

type Mode = 'idle' | 'playing' | 'listening' | 'closing';

export class VoicebotSession {
  private streamSid = '';
  private callSid = '';
  private callId = '';
  private mode: Mode = 'idle';
  private language: CallLanguage = 'hi';
  private seq = 0;
  private marks = 0;
  private waitingFor = '';
  private listen: CallStep['listen'] | undefined;
  private speech: Buffer[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private heardMs = 0;
  private noInputTimer: unknown;
  private busy: Promise<void> = Promise.resolve();

  constructor(private readonly ws: BridgeSocket, private readonly d: BridgeDeps) {
    ws.on('message', (raw) => { this.busy = this.busy.then(() => this.onMessage(String(raw))).catch((e) => this.fail(e)); });
    ws.on('close', () => this.clearNoInput());
  }

  private get setTimer() { return this.d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)); }
  private get clearTimer() { return this.d.clearTimer ?? ((t: unknown) => clearTimeout(t as NodeJS.Timeout)); }

  private async onMessage(raw: string): Promise<void> {
    const m = JSON.parse(raw) as { event: string; stream_sid?: string; start?: { call_sid: string; stream_sid: string };
      media?: { payload: string }; dtmf?: { digit: string }; mark?: { name: string } };
    switch (m.event) {
      case 'start': return this.onStart(m.start!);
      case 'media': return this.onAudio(Buffer.from(m.media!.payload, 'base64'));
      case 'dtmf': return this.onKey(m.dtmf!.digit);
      case 'mark': return this.onMark(m.mark!.name);
      case 'stop': this.mode = 'closing'; this.clearNoInput(); return;
      default: return; // connected
    }
  }

  private async onStart(s: { call_sid: string; stream_sid: string }): Promise<void> {
    this.streamSid = s.stream_sid;
    this.callSid = s.call_sid;
    const call = await this.d.findCall(s.call_sid);
    const first = this.d.takeFirstStep(s.call_sid);
    if (!call || !first) {
      this.d.log.warn('exotel stream for an unknown call', { callSid: s.call_sid });
      return this.ws.close();
    }
    this.callId = call.id;
    await this.perform({ action: 'play', step: first });
  }

  // ---- speaking ---------------------------------------------------------------

  private async perform(next: NextAction): Promise<void> {
    this.clearNoInput();
    if (next.action === 'hangup') {
      if (next.finalAudioUrl) await this.say(next.finalAudioUrl, 'end');
      else this.end();
      return;
    }
    this.listen = next.step.listen;
    await this.say(next.step.audioUrl, next.step.listen ? 'listen' : 'end');
  }

  /** Speak a prompt; when the last of it has played (mark), start listening or end the stream. */
  private async say(audioUrl: string, then: 'listen' | 'end'): Promise<void> {
    const { language, text } = decodeSay(audioUrl);
    this.language = language;
    this.mode = 'playing';
    const parts = text.split(/[\n\u2016\u2029]/).map((x) => x.trim()).filter(Boolean);
    for (const part of parts) await this.play(await this.synthesize(part, language));
    this.waitingFor = `${then}-${++this.marks}`;
    this.send({ event: 'mark', stream_sid: this.streamSid, mark: { name: this.waitingFor } });
  }

  private async synthesize(text: string, language: CallLanguage): Promise<Buffer> {
    const out = await this.d.speech.synthesize(text, language);
    return toPcm8k(out.audio, out.mimeType, text);
  }

  private async play(pcm: Buffer): Promise<void> {
    for (let i = 0; i < pcm.length; i += CHUNK_BYTES) {
      let chunk = pcm.subarray(i, i + CHUNK_BYTES);
      if (chunk.length < CHUNK_BYTES) chunk = Buffer.concat([chunk, Buffer.alloc(CHUNK_BYTES - chunk.length)]); // pad with silence
      this.send({ event: 'media', stream_sid: this.streamSid, media: { payload: chunk.toString('base64') } });
    }
  }

  private onMark(name: string): void {
    if (name !== this.waitingFor) return;
    this.waitingFor = '';
    if (name.startsWith('end-')) return this.end();
    this.startListening();
  }

  // ---- listening --------------------------------------------------------------

  private startListening(): void {
    this.mode = 'listening';
    this.speech = [];
    this.speechMs = this.silenceMs = this.heardMs = 0;
    const timeout = (this.listen?.timeoutSeconds ?? 6) * 1000;
    // Nothing said within the listen time: a silence event, like Twilio's Gather timeout.
    this.noInputTimer = this.setTimer(() => { this.busy = this.busy.then(() => this.finishListening(null)).catch((e) => this.fail(e)); }, timeout);
  }

  private async onAudio(frame: Buffer): Promise<void> {
    if (this.mode !== 'listening' || this.listen?.speech === false) return; // never listen while our prompt plays
    const ms = (frame.length / 2 / SAMPLE_RATE) * 1000;
    const loud = rms(frame) >= SPEECH_RMS;
    if (loud || this.heardMs > 0) this.speech.push(frame);
    if (loud) { this.heardMs += ms; this.silenceMs = 0; } else if (this.heardMs > 0) this.silenceMs += ms;
    this.speechMs += this.heardMs > 0 ? ms : 0;
    if (this.heardMs >= MIN_SPEECH_MS) this.clearNoInput(); // the parent is answering
    const done = this.heardMs >= MIN_SPEECH_MS && (this.silenceMs >= END_SILENCE_MS || this.speechMs >= MAX_SPEECH_MS);
    if (done) await this.finishListening(Buffer.concat(this.speech));
    else if (this.heardMs > 0 && this.heardMs < MIN_SPEECH_MS && this.silenceMs >= END_SILENCE_MS) {
      this.speech = []; this.heardMs = this.silenceMs = this.speechMs = 0; // a click, not speech
    }
  }

  private async onKey(digit: string): Promise<void> {
    if (this.mode !== 'listening') return; // a key pressed during the prompt is ignored, like Twilio with bargeIn off
    this.clearNoInput();
    this.mode = 'idle';
    await this.emit({ kind: 'key', value: digit });
  }

  private async finishListening(audio: Buffer | null): Promise<void> {
    if (this.mode !== 'listening') return;
    this.clearNoInput();
    this.mode = 'idle';
    if (!audio) return this.emit({ kind: 'speech' }); // silence
    const r = await this.d.speech.transcribe(wav8k(audio), this.language);
    await this.emit({ kind: 'speech', transcript: r.transcript, confidence: r.confidence });
  }

  private async emit(input: { kind: 'key'; value: string } | { kind: 'speech'; transcript?: string; confidence?: number }): Promise<void> {
    const ev = { type: 'input', eventId: `${this.callSid}:in:${++this.seq}`, callId: this.callId, providerCallId: this.callSid,
      at: new Date().toISOString(), ...input } as CallEvent;
    const out = await this.d.handleEvent(ev);
    if (out.contentType !== 'application/json') return this.end();
    await this.perform(JSON.parse(out.body) as NextAction);
  }

  // ---- end ---------------------------------------------------------------------

  private end(): void {
    this.mode = 'closing';
    this.clearNoInput();
    this.ws.close(); // the Voicebot applet ends; the flow's next applet hangs up
  }

  private clearNoInput(): void {
    if (this.noInputTimer !== undefined) this.clearTimer(this.noInputTimer);
    this.noInputTimer = undefined;
  }

  private fail(e: unknown): void {
    this.d.log.error('exotel voicebot error', { callSid: this.callSid, err: String(e) });
    this.end();
  }

  private send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
}

// ---- audio helpers -------------------------------------------------------------

export function rms(pcm: Buffer): number {
  let sum = 0;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) { const s = pcm.readInt16LE(i * 2); sum += s * s; }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Speech provider output to raw 16-bit 8 kHz mono PCM. Text (FakeSpeech, local dev) becomes silence of a similar length. */
export function toPcm8k(audio: Buffer, mimeType: string, text: string): Buffer {
  const mt = mimeType.toLowerCase();
  if (mt.startsWith('audio/l16') || mt === 'audio/pcm') return audio;
  if (mt.includes('wav')) {
    const rate = audio.readUInt32LE(24), bits = audio.readUInt16LE(34), channels = audio.readUInt16LE(22);
    if (rate !== SAMPLE_RATE || bits !== 16 || channels !== 1) throw new Error(`speech audio must be 8 kHz 16-bit mono WAV, got ${rate} Hz ${bits}-bit ${channels} ch`);
    const data = audio.indexOf('data', 12);
    return audio.subarray(data + 8);
  }
  if (mt.startsWith('text/')) return Buffer.alloc(Math.max(CHUNK_BYTES, Math.round(text.length * 0.07 * SAMPLE_RATE) * 2));
  throw new Error(`unsupported speech audio type ${mimeType}`);
}

/** Wrap raw 8 kHz 16-bit mono PCM in a WAV header for speech-to-text. */
export function wav8k(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export { LONG_PAUSE_MARK, SAY_SPLIT };
