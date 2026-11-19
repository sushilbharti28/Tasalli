// Call engine contracts (DRAFT, needs founder approval).
// Every telephony vendor (Exotel, Plivo, Fake) implements TelephonyProvider.
// Every speech vendor (Sarvam, Google, Fake) implements SpeechProvider.

export type CallLanguage = 'hi' | 'en' | 'bn' | 'mr' | 'ta' | 'te';
export type CallPurpose = 'consent' | 'reminder' | 'test';

/** One step of a call: play audio, then optionally wait for a key or a short phrase. */
export interface CallStep {
  audioUrl: string;              // pre-generated, cached TTS audio
  listen?: {
    keys: string[];              // e.g. ['1','2','0','3','9']
    speech: boolean;             // also accept a short spoken reply
    timeoutSeconds: number;
  };
}

export interface PlaceCallRequest {
  callId: string;                // our id, echoed back in every event
  to: string;                    // E.164
  callerId: string;              // approved, fixed caller ID
  language: CallLanguage;
  purpose: CallPurpose;
  firstStep: CallStep;
  statusWebhookUrl: string;
  inputWebhookUrl: string;
}

export interface PlaceCallResult {
  providerCallId: string;
}

/** What the provider tells us happened. Normalised by each adapter. */
export type CallEvent =
  | { type: 'status'; eventId: string; callId: string; providerCallId: string;
      status: 'ringing' | 'answered' | 'no_answer' | 'busy' | 'failed' | 'completed'; at: string }
  | { type: 'input'; eventId: string; callId: string; providerCallId: string;
      kind: 'key'; value: string; at: string }
  | { type: 'input'; eventId: string; callId: string; providerCallId: string;
      kind: 'speech'; audioUrl?: string; transcript?: string; confidence?: number; at: string };

/** Our reply to an input event: what the call does next. */
export type NextAction =
  | { action: 'play'; step: CallStep }
  | { action: 'hangup'; finalAudioUrl?: string };

export interface TelephonyProvider {
  readonly name: 'twilio' | 'exotel' | 'plivo' | 'fake';
  placeCall(req: PlaceCallRequest): Promise<PlaceCallResult>;
  /** Verify the signature and normalise a raw webhook into a CallEvent. Throws if the signature is invalid. */
  parseWebhook(headers: Record<string, string>, body: unknown): CallEvent;
  /** Turn our NextAction into the provider's response format (e.g. Exotel flow JSON, Plivo XML). */
  renderNextAction(next: NextAction, ctx?: { callId: string }): { contentType: string; body: string };
}

export interface SpeechProvider {
  readonly name: 'sarvam' | 'google' | 'fake';
  synthesize(text: string, language: CallLanguage): Promise<{ audio: Buffer; mimeType: string }>;
  transcribe(audio: Buffer, language: CallLanguage): Promise<{ transcript: string; confidence: number }>;
}

/**
 * Result of interpreting a spoken reply. Safety rule 4:
 * negative phrases are checked before positive ones; anything unclear is 'unclear'.
 */
export type ReplyIntent = 'confirm' | 'snooze' | 'repeat' | 'doctor_changed' | 'unwell' | 'stop' | 'decline' | 'unclear';

/** Keypad mapping for reminder calls. */
export const REMINDER_KEYS: Record<string, ReplyIntent> = {
  '1': 'confirm',
  '2': 'snooze',
  '0': 'repeat',
  '3': 'doctor_changed',
  '9': 'stop',
};

/** Keypad mapping for consent calls. */
export const CONSENT_KEYS: Record<string, ReplyIntent> = {
  '1': 'confirm',
  '9': 'stop',
};

export const RULES = {
  retryCount: 2,
  retryGapMinutes: 10,
  snoozeMinutes: 15,
  maxSnoozesPerDose: 1,
  groupWindowMinutes: 30,
  maxCallsPerNumberPerDay: 6,
  maxPeoplePerAccount: 4,
} as const;
