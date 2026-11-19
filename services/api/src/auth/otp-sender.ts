import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { maskPhoneForLog } from '../common/phone';

export const OTP_SENDER = Symbol('OTP_SENDER');

/**
 * Sends a one-time code by SMS. Founder rule: no paid services, so only FakeOtpSender
 * exists for now. A real sender (e.g. MSG91) would implement this interface and be
 * selected with OTP_SENDER.
 */
export interface OtpSender {
  readonly name: string;
  send(phoneE164: string, code: string, locale: 'en' | 'hi'): Promise<void>;
}

@Injectable()
export class FakeOtpSender implements OtpSender {
  readonly name = 'fake';
  private readonly logger = new Logger('FakeOtpSender');
  /** Last code per phone, for tests. */
  readonly sent = new Map<string, string>();

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async send(phoneE164: string, code: string): Promise<void> {
    this.sent.set(phoneE164, code);
    if (this.config.env === 'production') {
      this.logger.log(`OTP generated for ${maskPhoneForLog(phoneE164)} (fake sender; code not logged in production)`);
    } else {
      // Dev convenience: the code is printed; the phone number is masked (safety rule 8).
      this.logger.log(`DEV OTP for ${maskPhoneForLog(phoneE164)}: ${code}`);
    }
  }
}
