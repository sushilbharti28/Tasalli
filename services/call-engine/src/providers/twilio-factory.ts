import type { TelephonyProvider } from '@tasalli/contracts';
import type { AudioSource } from '../engine/deps.js';
import { SayUrls, TwilioProvider } from './twilio.js';

export interface TwilioEnv {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  publicBaseUrl: string;
}

/** Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL. Names only; values never logged. */
export function twilioEnv(env: NodeJS.ProcessEnv): TwilioEnv {
  const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'PUBLIC_BASE_URL'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return { accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, fromNumber: env.TWILIO_FROM_NUMBER!, publicBaseUrl: env.PUBLIC_BASE_URL!.replace(/\/$/, '') };
}

export function buildTwilio(env: NodeJS.ProcessEnv): { provider: TelephonyProvider; audio: AudioSource } {
  const c = twilioEnv(env);
  return { provider: new TwilioProvider({ accountSid: c.accountSid, authToken: c.authToken, publicBaseUrl: c.publicBaseUrl }), audio: new SayUrls() };
}
