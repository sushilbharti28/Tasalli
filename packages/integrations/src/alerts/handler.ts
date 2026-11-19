import type { IdempotencyStore } from '../util/idempotency';
import type { Logger } from '../util/logger';
import { maskPhone } from '../util/mask';
import type { PushSender } from '../push/types';
import { TemplateParamError } from '../whatsapp/templates';
import { WhatsAppSendError, type WhatsAppSender, type WhatsAppTemplateMessage } from '../whatsapp/types';
import type { AlertDataSource, AlertDose, AlertPerson, AlertRecipient } from './data';
import { localDateIn } from './data';
import type { AlertJob } from './jobs';
import { formatDueTime, formatLocalDate, hasPushText, medicineList, pushText, summarize, summaryPushText } from './text';

export interface AlertDeps {
  data: AlertDataSource;
  push: PushSender;
  whatsapp: WhatsAppSender;
  idempotency: IdempotencyStore;
  logger: Logger;
  /** Android notification channel created by the app. */
  androidChannelId?: string;
}

/** Thrown when at least one channel failed temporarily; BullMQ retries the job. */
export class AlertRetryableError extends Error {}

export type AlertOutcome =
  | { status: 'sent'; channels: string[] }
  | { status: 'skipped'; why: string };

/** WhatsApp is sent for these kinds only (approved templates exist for them). */
const WHATSAPP_KINDS = new Set<AlertJob['kind']>(['dose_missed', 'evening_summary']);

/**
 * Handles one alert job. Exactly once per channel and recipient (safety rule 6):
 * the queue dedupes enqueues by jobId, and each channel send is claimed in the
 * IdempotencyStore under `${jobId}:${channel}:${userId}`, so a retried job never re-sends a
 * channel that already went out. A failed channel releases its claim and is retried.
 */
export async function handleAlertJob(jobId: string, job: AlertJob, deps: AlertDeps): Promise<AlertOutcome> {
  const { data, logger } = deps;
  if (job.kind !== 'evening_summary' && !hasPushText(job.kind)) return skip(deps, jobId, job, `unknown kind ${job.kind}`);
  const person = await data.getPerson(job.personId);
  if (!person) return skip(deps, jobId, job, 'person deleted');
  const recipient = await data.getRecipient(job.ownerUserId);
  if (!recipient) return skip(deps, jobId, job, 'account deleted');

  let push: { title: string; body: string };
  let wa: WhatsAppTemplateMessage | undefined;

  if (job.kind === 'evening_summary') {
    const localDate = job.localDate ?? localDateIn(person.timeZone, new Date(job.at));
    const s = summarize(await data.getDosesForLocalDate(person.id, localDate), person, recipient);
    if (s.total === 0) return skip(deps, jobId, job, 'no decided doses today');
    push = summaryPushText(s, person, recipient.locale);
    wa = {
      to: recipient.phoneE164, template: 'evening_summary', locale: recipient.locale,
      params: {
        person_name: person.nickname, date: formatLocalDate(localDate, recipient.locale),
        confirmed: String(s.confirmed), total: String(s.total), not_confirmed: s.notConfirmed,
      },
    };
  } else {
    let doses: AlertDose[] = [];
    if (job.kind === 'dose_missed') {
      // Re-read: the family may have marked it taken since the engine decided.
      doses = (await data.getDoses(job.doseIds)).filter((d) => d.status === 'missed');
      if (doses.length === 0) return skip(deps, jobId, job, 'doses no longer missed');
      wa = missedTemplate(doses, person, recipient);
    }
    push = pushText(job, person, recipient, doses);
  }

  const sent: string[] = [];
  const retryable: string[] = [];

  // Push
  if (recipient.pushTokens.length) {
    const r = await once(deps, `${jobId}:push:${recipient.userId}`, () => sendPush(deps, job, recipient, push));
    if (r === 'sent') sent.push('push');
    if (r === 'retry') retryable.push('push');
  }

  // WhatsApp
  if (wa && WHATSAPP_KINDS.has(job.kind) && recipient.whatsappOptIn) {
    const msg = wa;
    const r = await once(deps, `${jobId}:whatsapp:${recipient.userId}`, async () => {
      try {
        await deps.whatsapp.sendTemplate(msg);
        return 'sent';
      } catch (err) {
        if (err instanceof WhatsAppSendError && err.retryable) return 'retry';
        const what = err instanceof TemplateParamError ? 'template params rejected' : (err as Error).message;
        logger.error(`WhatsApp ${job.kind} to ${maskPhone(recipient.phoneE164)} failed permanently: ${what}`, { jobId });
        return 'failed';
      }
    });
    if (r === 'sent') sent.push('whatsapp');
    if (r === 'retry') retryable.push('whatsapp');
  }

  if (retryable.length) {
    throw new AlertRetryableError(`alert ${jobId}: retry ${retryable.join(', ')} (already sent: ${sent.join(', ') || 'none'})`);
  }
  logger.info(`alert ${job.kind} handled`, { jobId, personId: job.personId, channels: sent });
  return { status: 'sent', channels: sent };
}

type ChannelResult = 'sent' | 'failed' | 'retry' | 'duplicate';

/** Claim, run, then complete (sent / permanent failure) or release (retry). */
async function once(deps: AlertDeps, key: string, run: () => Promise<'sent' | 'failed' | 'retry'>): Promise<ChannelResult> {
  if (!(await deps.idempotency.claim(key))) return 'duplicate';
  let r: 'sent' | 'failed' | 'retry';
  try {
    r = await run();
  } catch (err) {
    await deps.idempotency.release(key);
    throw err;
  }
  if (r === 'retry') await deps.idempotency.release(key);
  else await deps.idempotency.complete(key);
  return r;
}

/** One logical push to all of the user's devices. Sent if any device got it. */
async function sendPush(
  deps: AlertDeps, job: AlertJob, recipient: AlertRecipient, text: { title: string; body: string },
): Promise<'sent' | 'failed' | 'retry'> {
  let anyOk = false;
  let anyRetry = false;
  for (const token of recipient.pushTokens) {
    const r = await deps.push.send({
      token, ...text,
      data: { type: job.kind, personId: job.personId, ...(job.callGroupId ? { callGroupId: job.callGroupId } : {}) },
      androidChannelId: deps.androidChannelId,
      tag: job.callGroupId ?? `${job.kind}-${job.personId}`,
    });
    if (r.ok) anyOk = true;
    else if (r.reason === 'invalid_token') await deps.data.removePushToken(recipient.userId, token);
    else if (r.reason === 'retryable') anyRetry = true;
    else deps.logger.error(`push ${job.kind} failed: ${r.detail}`, { personId: job.personId });
  }
  return anyOk ? 'sent' : anyRetry ? 'retry' : 'failed';
}

function missedTemplate(doses: AlertDose[], person: AlertPerson, recipient: AlertRecipient): WhatsAppTemplateMessage {
  const first = [...doses].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]!;
  return {
    to: recipient.phoneE164, template: 'missed_dose_alert', locale: recipient.locale,
    params: { person_name: person.nickname, time: formatDueTime(first.dueAt, person, recipient), medicines: medicineList(doses) },
  };
}

function skip(deps: AlertDeps, jobId: string, job: AlertJob, why: string): AlertOutcome {
  deps.logger.info(`alert ${job.kind} skipped: ${why}`, { jobId, personId: job.personId });
  return { status: 'skipped', why };
}
