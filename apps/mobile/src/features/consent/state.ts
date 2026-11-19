import type { Person } from '@/api/types';

export type ConsentView = 'calling' | 'waiting' | 'confirmed' | 'declined' | 'opted_out';

/** How long after placing a consent call we show "calling" before "no answer yet". */
export const CALLING_WINDOW_MS = 90_000;

/** When this phone last asked for a consent call, per person (memory only). */
const requestedAt = new Map<string, number>();

export function noteConsentCall(personId: string, at = Date.now()) {
  requestedAt.set(personId, at);
}

/**
 * The API only has pending / consented / declined / opted_out. "Calling" vs "waiting" is
 * derived from when we placed the call. (Contract change requested: expose consent call status.)
 */
export function consentView(p: Pick<Person, 'id' | 'consent'>, now = Date.now()): ConsentView {
  switch (p.consent) {
    case 'consented':
      return 'confirmed';
    case 'declined':
      return 'declined';
    case 'opted_out':
      return 'opted_out';
    default: {
      const at = p.id ? requestedAt.get(p.id) : undefined;
      return at !== undefined && now - at < CALLING_WINDOW_MS ? 'calling' : 'waiting';
    }
  }
}
