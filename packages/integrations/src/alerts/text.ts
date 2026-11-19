import type { AppLocale } from '../otp/types';
import { sanitizeParam } from '../whatsapp/templates';
import type { AlertDose, AlertPerson, AlertRecipient } from './data';
import type { AlertJob } from './jobs';

/**
 * Push notification texts. Names and medicine names are the family's own words, verbatim
 * (safety rule 1). No medical advice. Hindi needs native-speaker review.
 */

/** Time of day in the parent's zone; adds the zone name when the child is elsewhere (rule 7). */
export function formatDueTime(dueAtIso: string, person: AlertPerson, recipient: AlertRecipient): string {
  const differs = person.timeZone !== recipient.timeZone;
  return new Intl.DateTimeFormat(recipient.locale === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: person.timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(differs ? { timeZoneName: 'short' } : {}),
  }).format(new Date(dueAtIso));
}

export function formatLocalDate(localDate: string, locale: AppLocale): string {
  // localDate is already the parent's date; format it at noon UTC to avoid any day shift.
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${localDate}T12:00:00Z`));
}

export function medicineList(doses: AlertDose[]): string {
  return sanitizeParam([...new Set(doses.map((d) => d.spokenName))].join(', '));
}

type Ctx = { nick: string; time: string; meds: string };

const PUSH: Record<Exclude<AlertJob['kind'], 'evening_summary'>, Record<AppLocale, (c: Ctx, reason?: string) => { title: string; body: string }>> = {
  dose_missed: {
    en: (c, reason) => ({
      title: `${c.nick}: medicine not confirmed`,
      body: reason === 'said_not_taken'
        ? `${c.nick} said they have not taken the ${c.time} medicine (${c.meds}).`
        : `The ${c.time} reminder (${c.meds}) was not confirmed.`,
    }),
    hi: (c, reason) => ({
      title: `${c.nick}: दवाई की पुष्टि नहीं हुई`,
      body: reason === 'said_not_taken'
        ? `${c.nick} ने बताया कि ${c.time} की दवाई (${c.meds}) नहीं ली।`
        : `${c.time} की कॉल (${c.meds}) पर पुष्टि नहीं हुई।`,
    }),
  },
  doctor_changed: {
    en: (c) => ({ title: `${c.nick}: doctor changed a medicine`, body: `${c.nick} said the doctor changed a medicine. Please update it in the app.` }),
    hi: (c) => ({ title: `${c.nick}: डॉक्टर ने दवाई बदली`, body: `${c.nick} ने बताया कि डॉक्टर ने दवाई बदली है। कृपया ऐप में बदल दीजिए।` }),
  },
  unwell: {
    en: (c) => ({ title: `${c.nick} is not feeling well`, body: `${c.nick} said on the reminder call that they are not feeling well.` }),
    hi: (c) => ({ title: `${c.nick} की तबीयत ठीक नहीं`, body: `${c.nick} ने कॉल पर बताया कि उनकी तबीयत ठीक नहीं है।` }),
  },
  opted_out: {
    en: (c) => ({ title: `${c.nick} stopped the calls`, body: `${c.nick} asked to stop all calls. We will not call this number again.` }),
    hi: (c) => ({ title: `${c.nick} ने कॉल बंद कीं`, body: `${c.nick} ने सभी कॉल बंद करने को कहा। इस नंबर पर अब कॉल नहीं होंगी।` }),
  },
  consent_given: {
    en: (c) => ({ title: `${c.nick} said yes`, body: `${c.nick} agreed to medicine reminder calls.` }),
    hi: (c) => ({ title: `${c.nick} ने हाँ कहा`, body: `${c.nick} ने दवाई की याद वाली कॉल के लिए हाँ कहा।` }),
  },
  consent_declined: {
    en: (c) => ({ title: `${c.nick} said no`, body: `${c.nick} did not agree to reminder calls. No calls will be made.` }),
    hi: (c) => ({ title: `${c.nick} ने मना किया`, body: `${c.nick} ने याद वाली कॉल के लिए मना किया। कोई कॉल नहीं होगी।` }),
  },
  consent_no_answer: {
    en: (c) => ({ title: `${c.nick} did not answer`, body: `${c.nick} did not answer the consent call. You can try again from the app.` }),
    hi: (c) => ({ title: `${c.nick} ने फ़ोन नहीं उठाया`, body: `${c.nick} ने अनुमति वाली कॉल नहीं उठाई। ऐप से फिर से कोशिश कर सकते हैं।` }),
  },
};

export function hasPushText(kind: string): boolean {
  return kind in PUSH;
}

export function pushText(
  job: AlertJob, person: AlertPerson, recipient: AlertRecipient, doses: AlertDose[],
): { title: string; body: string } {
  if (job.kind === 'evening_summary') throw new Error('use summaryPushText');
  const first = [...doses].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const ctx: Ctx = {
    nick: person.nickname,
    time: first ? formatDueTime(first.dueAt, person, recipient) : '',
    meds: medicineList(doses),
  };
  return PUSH[job.kind][recipient.locale](ctx, job.reason);
}

export interface DaySummary { confirmed: number; total: number; notConfirmed: string }

export function summarize(doses: AlertDose[], person: AlertPerson, recipient: AlertRecipient): DaySummary {
  // Only doses that are decided count. Paused days and still-pending doses are left out.
  const decided = doses.filter((d) => d.status === 'confirmed' || d.status === 'missed')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const missed = decided.filter((d) => d.status === 'missed');
  return {
    confirmed: decided.length - missed.length,
    total: decided.length,
    notConfirmed: missed.length
      ? sanitizeParam(missed.map((d) => `${formatDueTime(d.dueAt, person, recipient)} ${d.spokenName}`).join(', '))
      : recipient.locale === 'hi' ? 'कोई नहीं' : 'none',
  };
}

export function summaryPushText(s: DaySummary, person: AlertPerson, locale: AppLocale): { title: string; body: string } {
  return locale === 'hi'
    ? { title: `${person.nickname}: आज का हाल`, body: `${s.total} में से ${s.confirmed} दवाई की कॉल पर पुष्टि हुई। पुष्टि नहीं हुई: ${s.notConfirmed}` }
    : { title: `${person.nickname}: today`, body: `${s.confirmed} of ${s.total} medicine reminders confirmed. Not confirmed: ${s.notConfirmed}` };
}
