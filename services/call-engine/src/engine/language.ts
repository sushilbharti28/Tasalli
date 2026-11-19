import type { CallLanguage } from '@tasalli/contracts';
import type { Deps } from './deps.js';

/** v1.1: Hindi only. A person whose language is not hi or en is called in Hindi (and we log it). */
export function callLanguage(d: Deps, language: CallLanguage, personId: string | null): CallLanguage {
  if (language === 'hi' || language === 'en') return language;
  d.log.warn('language not supported yet, using Hindi', { personId, requested: language });
  return 'hi';
}
