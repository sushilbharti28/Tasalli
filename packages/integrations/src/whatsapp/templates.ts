import type { AppLocale } from '../otp/types';

/**
 * WhatsApp template definitions. The text must match, word for word, what is approved
 * with the WhatsApp provider; docs/whatsapp-templates.md is the copy for founder review.
 * Variables use named parameters ({{person_name}}) and are filled from the family's own
 * entries, verbatim (safety rule 1). No medical advice in any template.
 */
export type WhatsAppTemplateName = 'missed_dose_alert' | 'evening_summary';

export interface TemplateDefinition {
  category: 'UTILITY';
  params: readonly string[];
  text: Record<AppLocale, string>;
}

export const WHATSAPP_TEMPLATES: Record<WhatsAppTemplateName, TemplateDefinition> = {
  missed_dose_alert: {
    category: 'UTILITY',
    params: ['person_name', 'time', 'medicines'],
    text: {
      en:
        'Tasalli: {{person_name}} did not confirm the {{time}} medicine reminder ({{medicines}}). ' +
        'You may want to check on them.',
      hi:
        'तसल्ली: {{person_name}} ने {{time}} की दवाई की याद वाली कॉल पर पुष्टि नहीं की ({{medicines}})। ' +
        'एक बार उनसे बात कर लीजिए।',
    },
  },
  evening_summary: {
    category: 'UTILITY',
    params: ['person_name', 'date', 'confirmed', 'total', 'not_confirmed'],
    text: {
      en:
        'Tasalli daily summary for {{person_name}}, {{date}}: {{confirmed}} of {{total}} medicine reminders confirmed. ' +
        'Not confirmed: {{not_confirmed}}. Open the Tasalli app for details.',
      hi:
        'तसल्ली: {{person_name}} का आज का हाल, {{date}}: {{total}} में से {{confirmed}} दवाई की कॉल पर पुष्टि हुई। ' +
        'पुष्टि नहीं हुई: {{not_confirmed}}। पूरी जानकारी तसल्ली ऐप में देखें।',
    },
  },
};

/** WhatsApp rejects parameters with newlines, tabs or more than 4 consecutive spaces. */
export function sanitizeParam(value: string, maxLength = 200): string {
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

export class TemplateParamError extends Error {}

/** Checks that exactly the declared params are present and non-empty. */
export function validateParams(name: WhatsAppTemplateName, params: Record<string, string>): void {
  const def = WHATSAPP_TEMPLATES[name];
  const missing = def.params.filter((p) => !params[p] || params[p]!.trim() === '');
  const extra = Object.keys(params).filter((p) => !def.params.includes(p));
  if (missing.length || extra.length) {
    throw new TemplateParamError(
      `Template ${name}: missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`,
    );
  }
  for (const p of def.params) {
    if (/[\r\n\t]| {5,}/.test(params[p]!)) throw new TemplateParamError(`Template ${name}: param ${p} has newlines, tabs or long spaces`);
  }
}

/** Renders the approved text with params; used by the fake, previews and tests. */
export function renderTemplate(name: WhatsAppTemplateName, locale: AppLocale, params: Record<string, string>): string {
  validateParams(name, params);
  return WHATSAPP_TEMPLATES[name].text[locale].replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k]!);
}
