import { randomBytes } from 'crypto';

export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  bullPrefix: string;
  sessionSecret: string;
  sessionTtlDays: number;
  otpSender: 'fake';
  otpFixedCode: string | null;
  doseHorizonDays: number;
  /** Run the BullMQ worker for call-engine events and the daily dose window job in this process. */
  runWorkers: boolean;
  /** HMAC secret for POST /webhooks/billing. Empty means every billing webhook is rejected (fail closed). */
  billingWebhookSecret: string;
}

/** Reads configuration from environment variables by name only (safety rule 8). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['env'];
  const prod = nodeEnv === 'production';

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (!sessionSecret) {
    if (prod) throw new Error('SESSION_SECRET must be set in production');
    sessionSecret = randomBytes(32).toString('hex'); // dev only: sessions end on restart
  }
  const otpSender = (env.OTP_SENDER ?? 'fake') as string;
  if (otpSender !== 'fake') {
    throw new Error(`OTP_SENDER=${otpSender} is not available; only "fake" exists (no paid services yet)`);
  }
  const otpFixedCode = env.OTP_FIXED_CODE || null;
  if (otpFixedCode && !/^\d{6}$/.test(otpFixedCode)) throw new Error('OTP_FIXED_CODE must be 6 digits');
  if (otpFixedCode && prod) throw new Error('OTP_FIXED_CODE must not be set in production');

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tasalli_api_dev',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    bullPrefix: env.BULLMQ_PREFIX ?? 'bull',
    sessionSecret,
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    otpSender: 'fake',
    otpFixedCode,
    doseHorizonDays: Number(env.DOSE_HORIZON_DAYS ?? 7),
    runWorkers: env.RUN_WORKERS !== 'false',
    billingWebhookSecret: env.BILLING_WEBHOOK_SECRET ?? '',
  };
}
