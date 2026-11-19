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
  return { provider: new TwilioProvider({ accountSid: c.accountSid, authToken: c.authToken, publicBaseUrl: c.publicBaseUrl, record: env.TWILIO_RECORD !== 'false' }), audio: new SayUrls() };
}
