import type { TelephonyProvider } from '@tasalli/contracts';
import type { AudioSource } from '../engine/deps.js';
import { SayUrls, TwilioProvider } from './twilio.js';

export interface TwilioEnv {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  publicBaseUrl: string;
}

/** Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, CALL_ENGINE_PUBLIC_BASE_URL (or PUBLIC_BASE_URL). Names only; values never logged. */
export function twilioEnv(env: NodeJS.ProcessEnv): TwilioEnv {
  const publicBase = env.CALL_ENGINE_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL;
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'].filter((k) => !env[k]);
  if (!publicBase) missing.push('PUBLIC_BASE_URL (or CALL_ENGINE_PUBLIC_BASE_URL)');
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return { accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, fromNumber: env.TWILIO_FROM_NUMBER!, publicBaseUrl: publicBase!.replace(/\/$/, '') };
}

export function buildTwilio(env: NodeJS.ProcessEnv): { provider: TelephonyProvider; audio: AudioSource } {
  const c = twilioEnv(env);
  return { provider: new TwilioProvider({ accountSid: c.accountSid, authToken: c.authToken, publicBaseUrl: c.publicBaseUrl, record: env.TWILIO_RECORD !== 'false', ssml: env.TWILIO_SSML !== 'off',
    speechTimeout: speechTimeoutFrom(env.TWILIO_SPEECH_TIMEOUT), speechModel: speechModelFrom(env.TWILIO_SPEECH_MODEL) }), audio: new SayUrls() };
}

/** "auto" or whole seconds (1-10); anything else falls back to 1. */
export function speechTimeoutFrom(v: string | undefined): string {
  const x = (v ?? '').trim();
  return x === 'auto' || /^(10|[1-9])$/.test(x) ? x : '1';
}
/** A Twilio speech model name (letters, digits, _ . -), or none for Twilio's default. */
export function speechModelFrom(v: string | undefined): string | undefined {
  const x = (v ?? '').trim();
  return /^[a-z0-9_.-]{1,60}$/i.test(x) ? x : undefined;
}
