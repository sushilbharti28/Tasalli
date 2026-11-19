import { randomUUID } from 'node:crypto';
import { maskPhone } from '../util/mask';
import { consoleLogger, type Logger } from '../util/logger';
import { isProduction, type Env } from '../util/env';
import { OtpSendError, type OtpMessage, type OtpSender } from './types';

/** Records every message. Can be told to fail. For tests. */
export class FakeOtpSender implements OtpSender {
  readonly name = 'fake';
  readonly sent: Array<OtpMessage & { providerMessageId: string }> = [];
  private failures: Array<{ retryable: boolean }> = [];

  failNext(times = 1, retryable = true): void {
    for (let i = 0; i < times; i++) this.failures.push({ retryable });
  }

  async send(msg: OtpMessage): Promise<{ providerMessageId: string }> {
    const f = this.failures.shift();
    if (f) throw new OtpSendError('fake send failure', f.retryable);
    const providerMessageId = `fake-otp-${this.sent.length + 1}`;
    this.sent.push({ ...msg, providerMessageId });
    return { providerMessageId };
  }

  lastCodeFor(phone: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === phone)?.code;
  }
}

/**
 * Dev mode: prints the code to the console with the phone masked (safety rule 8).
 * Refuses to start in production so codes can never end up in production logs.
 */
export class DevConsoleOtpSender implements OtpSender {
  readonly name = 'console';
  constructor(env: Env, private readonly logger: Logger = consoleLogger) {
    if (isProduction(env)) {
      throw new Error('DevConsoleOtpSender cannot be used in production');
    }
  }

  async send(msg: OtpMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `console-${randomUUID()}`;
    this.logger.info(`[dev OTP] ${maskPhone(msg.to)} code ${msg.code} (valid ${msg.ttlMinutes} min)`);
    return { providerMessageId };
  }
}

/**
 * Sends Indian numbers (+91) through one sender and everything else through another.
 * A real Indian SMS route needs a DLT-registered template; international routes do not.
 */
export class RoutingOtpSender implements OtpSender {
  readonly name = 'routing';
  constructor(private readonly domestic: OtpSender, private readonly international: OtpSender) {}

  send(msg: OtpMessage): Promise<{ providerMessageId: string }> {
    return (msg.to.startsWith('+91') ? this.domestic : this.international).send(msg);
  }
}

/**
 * OTP_PROVIDER: "console" (default outside production) or "fake".
 * No paid SMS provider is wired yet; production startup fails loudly until one is.
 */
export function createOtpSenderFromEnv(env: Env, logger: Logger = consoleLogger): OtpSender {
  const provider = env['OTP_PROVIDER'] ?? (isProduction(env) ? undefined : 'console');
  switch (provider) {
    case 'console':
      return new DevConsoleOtpSender(env, logger);
    case 'fake':
      if (isProduction(env)) throw new Error('OTP_PROVIDER=fake is not allowed in production');
      return new FakeOtpSender();
    default:
      throw new Error(
        `No OTP provider configured for OTP_PROVIDER=${provider ?? '(unset)'}. ` +
          'A real SMS provider has not been added yet; see packages/integrations/README.md.',
      );
  }
}
