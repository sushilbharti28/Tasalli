import { isProduction, type Env } from '../util/env';
import { renderTemplate } from './templates';
import { WhatsAppSendError, type WhatsAppSender, type WhatsAppTemplateMessage } from './types';

/**
 * Records messages with their rendered text, validating params exactly as a real
 * provider would reject them. Can be told to fail.
 */
export class FakeWhatsAppSender implements WhatsAppSender {
  readonly name = 'fake';
  readonly sent: Array<WhatsAppTemplateMessage & { providerMessageId: string; text: string }> = [];
  private failures: boolean[] = [];

  failNext(times = 1, retryable = true): void {
    for (let i = 0; i < times; i++) this.failures.push(retryable);
  }

  async sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }> {
    const text = renderTemplate(msg.template, msg.locale, msg.params);
    const f = this.failures.shift();
    if (f !== undefined) throw new WhatsAppSendError('fake WhatsApp failure', f);
    const providerMessageId = `wamid.fake.${this.sent.length + 1}`;
    this.sent.push({ ...msg, providerMessageId, text });
    return { providerMessageId };
  }
}

/** WHATSAPP_PROVIDER: only "fake" exists. Production refuses until a real provider is added. */
export function createWhatsAppSenderFromEnv(env: Env): WhatsAppSender {
  const provider = env['WHATSAPP_PROVIDER'] ?? (isProduction(env) ? undefined : 'fake');
  if (provider === 'fake' && !isProduction(env)) return new FakeWhatsAppSender();
  throw new Error(
    `No WhatsApp provider for WHATSAPP_PROVIDER=${provider ?? '(unset)'}; see packages/integrations/README.md`,
  );
}
