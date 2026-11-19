import type { ReplyIntent } from '@tasalli/contracts';

/**
 * Runtime copies of the values in packages/contracts/src/telephony.ts. Under tsx Node cannot read named
 * exports from the contracts package (CommonJS entry with `export *`), so the values live here and
 * test/contracts-sync.test.ts fails if they ever drift from the contract. Types still come from the package.
 */
export const REMINDER_KEYS: Record<string, ReplyIntent> = { '1': 'confirm', '2': 'snooze', '0': 'repeat', '3': 'doctor_changed', '9': 'stop' };
export const CONSENT_KEYS: Record<string, ReplyIntent> = { '1': 'confirm', '9': 'stop' };
export const RULES = {
  retryCount: 2, retryGapMinutes: 10, snoozeMinutes: 15, maxSnoozesPerDose: 1, groupWindowMinutes: 30,
  maxCallsPerNumberPerDay: 6, maxPeoplePerAccount: 4,
} as const;
