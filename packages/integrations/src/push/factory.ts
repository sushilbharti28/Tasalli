import type { Env } from '../util/env';
import { isProduction } from '../util/env';
import { FakePushSender } from './fake';
import { FcmPushSender, fcmConfigFromEnv } from './fcm';
import type { PushSender } from './types';

/** PUSH_PROVIDER: "fcm" or "fake" (default outside production). */
export function createPushSenderFromEnv(env: Env): PushSender {
  const provider = env['PUSH_PROVIDER'] ?? (isProduction(env) ? 'fcm' : 'fake');
  if (provider === 'fcm') return new FcmPushSender(fcmConfigFromEnv(env));
  if (provider === 'fake' && !isProduction(env)) return new FakePushSender();
  throw new Error(`Unsupported PUSH_PROVIDER=${provider}`);
}
