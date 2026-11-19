import type { AppLocale } from '../otp/types';
import type { WhatsAppTemplateName } from './templates';

export interface WhatsAppTemplateMessage {
  /** E.164 of the recipient (the child). They must have opted in to WhatsApp messages. */
  to: string;
  template: WhatsAppTemplateName;
  locale: AppLocale;
  /** Named parameters; see WHATSAPP_TEMPLATES for the list per template. */
  params: Record<string, string>;
}

/**
 * Sends approved template messages. Provider-agnostic: Meta Cloud API, Gupshup, Exotel or
 * any BSP can implement it. Only a fake exists today (founder rule: no paid services yet).
 */
export interface WhatsAppSender {
  readonly name: string;
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }>;
}

export class WhatsAppSendError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}
