import { describe, expect, it } from 'vitest';
import {
  FakeWhatsAppSender,
  WHATSAPP_TEMPLATES,
  createWhatsAppSenderFromEnv,
  renderTemplate,
  sanitizeParam,
  TemplateParamError,
} from '../src';

const missed = { person_name: 'Papa', time: '9:00 am', medicines: 'BP wali, Sugar wali' };

describe('WhatsApp templates', () => {
  it('renders the missed-dose alert in both languages, values verbatim', () => {
    expect(renderTemplate('missed_dose_alert', 'en', missed)).toBe(
      'Tasalli: Papa did not confirm the 9:00 am medicine reminder (BP wali, Sugar wali). You may want to check on them.',
    );
    expect(renderTemplate('missed_dose_alert', 'hi', missed)).toContain('BP wali, Sugar wali');
  });

  it('no template starts or ends with a variable (WhatsApp rejects those)', () => {
    for (const def of Object.values(WHATSAPP_TEMPLATES)) {
      for (const t of Object.values(def.text)) {
        expect(t.trim().startsWith('{{')).toBe(false);
        expect(t.trim().endsWith('}}')).toBe(false);
        const used = [...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
        expect(used).toEqual([...def.params].sort());
      }
    }
  });

  it('rejects missing, extra or multi-line params', () => {
    expect(() => renderTemplate('missed_dose_alert', 'en', { ...missed, time: '' })).toThrow(TemplateParamError);
    expect(() => renderTemplate('missed_dose_alert', 'en', { ...missed, dose: '2' })).toThrow(/unexpected \[dose\]/);
    expect(() => renderTemplate('missed_dose_alert', 'en', { ...missed, medicines: 'a\nb' })).toThrow(/newlines/);
  });

  it('sanitizes free text into a valid param', () => {
    expect(sanitizeParam('BP\nwali   goli\t')).toBe('BP wali goli');
    expect(sanitizeParam('x'.repeat(300), 10)).toHaveLength(10);
  });
});

describe('FakeWhatsAppSender', () => {
  it('records rendered text and can fail', async () => {
    const s = new FakeWhatsAppSender();
    s.failNext();
    await expect(s.sendTemplate({ to: '+919876512861', template: 'missed_dose_alert', locale: 'en', params: missed })).rejects.toThrow();
    const r = await s.sendTemplate({ to: '+919876512861', template: 'missed_dose_alert', locale: 'en', params: missed });
    expect(r.providerMessageId).toBe('wamid.fake.1');
    expect(s.sent[0]!.text).toContain('Papa');
  });

  it('factory refuses production without a real provider', () => {
    expect(createWhatsAppSenderFromEnv({}).name).toBe('fake');
    expect(() => createWhatsAppSenderFromEnv({ NODE_ENV: 'production' })).toThrow();
    expect(() => createWhatsAppSenderFromEnv({ WHATSAPP_PROVIDER: 'meta' })).toThrow();
  });
});
