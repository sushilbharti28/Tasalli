export type AppLocale = 'en' | 'hi';

export interface OtpMessage {
  /** E.164, Indian or international. */
  to: string;
  /** The code to deliver. Senders must never log it in production. */
  code: string;
  locale: AppLocale;
  ttlMinutes: number;
}

/**
 * Delivers a one-time code. Implementations: FakeOtpSender (tests), DevConsoleOtpSender
 * (local and staging), and later a real SMS provider (see README "Adding real providers later").
 */
export interface OtpSender {
  readonly name: string;
  send(msg: OtpMessage): Promise<{ providerMessageId: string }>;
}

export class OtpSendError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'OtpSendError';
  }
}
