import type { AppLocale } from '../otp/types';

/**
 * What the alert worker needs from the database. services/api implements this over Postgres;
 * InMemoryAlertData is the fake. Everything is read at send time so a dose marked taken
 * after the engine decided "missed" does not produce an alert.
 */
export interface AlertPerson {
  id: string;
  ownerUserId: string;
  nickname: string;     // as the family entered it
  timeZone: string;     // IANA, the parent's (safety rule 7)
}

export interface AlertRecipient {
  userId: string;
  phoneE164: string;
  locale: AppLocale;
  timeZone: string;
  whatsappOptIn: boolean;
  pushTokens: string[];
}

export type DoseStatus = 'upcoming' | 'calling' | 'confirmed' | 'missed' | 'skipped_paused';

export interface AlertDose {
  doseId: string;
  spokenName: string;   // what the call says, verbatim (safety rule 1)
  dueAt: string;        // ISO UTC
  status: DoseStatus;
}

export interface AlertDataSource {
  /** Null if the person was deleted (then nothing is sent). */
  getPerson(personId: string): Promise<AlertPerson | null>;
  /** Null if the account was deleted. */
  getRecipient(userId: string): Promise<AlertRecipient | null>;
  getDoses(doseIds: string[]): Promise<AlertDose[]>;
  /** All doses of this person whose due time falls on `localDate` in the person's time zone. */
  getDosesForLocalDate(personId: string, localDate: string): Promise<AlertDose[]>;
  /** FCM said this token is dead. */
  removePushToken(userId: string, token: string): Promise<void>;
}

export class InMemoryAlertData implements AlertDataSource {
  readonly people = new Map<string, AlertPerson>();
  readonly recipients = new Map<string, AlertRecipient>();
  readonly doses = new Map<string, AlertDose & { personId: string }>();
  readonly removedTokens: Array<{ userId: string; token: string }> = [];

  async getPerson(id: string) { return this.people.get(id) ?? null; }
  async getRecipient(id: string) { return this.recipients.get(id) ?? null; }
  async getDoses(ids: string[]) {
    return ids.map((id) => this.doses.get(id)).filter((d): d is AlertDose & { personId: string } => !!d);
  }
  async getDosesForLocalDate(personId: string, localDate: string) {
    const person = this.people.get(personId);
    if (!person) return [];
    return [...this.doses.values()].filter(
      (d) => d.personId === personId && localDateIn(person.timeZone, new Date(d.dueAt)) === localDate,
    );
  }
  async removePushToken(userId: string, token: string) {
    this.removedTokens.push({ userId, token });
    const r = this.recipients.get(userId);
    if (r) r.pushTokens = r.pushTokens.filter((t) => t !== token);
  }
}

/** YYYY-MM-DD of an instant in an IANA time zone. */
export function localDateIn(timeZone: string, d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
