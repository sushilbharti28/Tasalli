import type { ReplyIntent } from '@tasalli/contracts';

export type MatchIntent = Exclude<ReplyIntent, 'unclear'>;
export type ContextPhrases = Partial<Record<MatchIntent, string[]>>;

export interface PhraseBook {
  reminder: ContextPhrases;
  consent: ContextPhrases;
  /** Any of these words anywhere in a reply means it can never be a confirmation. */
  negationWords: string[];
}

/**
 * Built-in starting lists (docs/call-scripts.md). Grow them from the manual calling week via
 * packages/scripts/<lang>.yaml (the lists there are added to these, never replace them).
 * Romanised and Devanagari forms are both listed because speech-to-text may return either.
 */
const hiStop = ['band karo', 'phone band karo', 'mat karo phone', 'phone mat karo', 'phone mat karna', 'kabhi phone mat karna',
  'बंद करो', 'फोन बंद करो', 'मत करो फोन', 'फोन मत करो', 'फ़ोन मत करो'];
const hiRepeat = ['phir se', 'fir se', 'dobara', 'dubara', 'samajh nahi aaya', 'samajh nahin aaya', 'samjha nahi', 'phir se boliye',
  'फिर से', 'दोबारा', 'समझ नहीं आया'];

export const BUILTIN_PHRASES: Record<'hi' | 'en', PhraseBook> = {
  hi: {
    negationWords: ['nahi', 'nahin', 'nahee', 'nhi', 'mat', 'नहीं', 'नही', 'मत'],
    reminder: {
      stop: hiStop,
      doctor_changed: ['doctor ne badli', 'doctor ne badal di', 'doctor ne badla', 'dawai badal gayi', 'dawai badli',
        'डॉक्टर ने बदली', 'डॉक्टर ने बदल दी', 'दवाई बदल गई'],
      unwell: ['tabiyat kharab', 'tabiyat theek nahi', 'tabiyat thik nahi', 'tabiyat theek nahin', 'bimar hoon', 'bimar hu',
        'तबीयत खराब', 'तबीयत ठीक नहीं', 'बीमार हूँ'],
      snooze: ['baad mein', 'bad mein', 'baad me', 'thodi der mein', 'thodi der me', 'thodi der baad', 'बाद में', 'थोड़ी देर में', 'थोड़ी देर बाद'],
      repeat: hiRepeat,
      decline: ['nahi', 'nahin', 'nahi li', 'nahin li', 'nahi liya', 'abhi nahi', 'abhi nahin', 'nahi khayi', 'नहीं', 'नहीं ली', 'अभी नहीं', 'नहीं लिया'],
      confirm: ['le li', 'le liya', 'le li hai', 'le liye', 'le lee', 'haan', 'haa', 'han', 'haan ji', 'ji haan', 'haan le li',
        'kha li', 'kha liya', 'kha liye', 'ho gaya', 'ho gayi', 'ले ली', 'ले लिया', 'हाँ', 'हां', 'हाँ ले ली', 'खा ली', 'खा लिया', 'हो गया'],
    },
    consent: {
      stop: hiStop,
      repeat: hiRepeat,
      decline: ['nahi', 'nahin', 'nahi chahiye', 'nahin chahiye', 'mana', 'नहीं', 'नहीं चाहिए'],
      confirm: ['haan', 'haa', 'han', 'haan ji', 'ji haan', 'theek hai', 'thik hai', 'manzoor hai', 'हाँ', 'हां', 'जी हाँ', 'ठीक है'],
    },
  },
  en: {
    negationWords: ['no', 'not', 'never', 'nope', "didn't", 'didnt', "haven't", 'havent', "don't", 'dont', "hasn't", 'hasnt'],
    reminder: {
      stop: ['stop', 'stop calling', "don't call", 'do not call', 'never call', 'no more calls'],
      doctor_changed: ['doctor changed', 'doctor changed it', 'doctor changed the medicine', 'medicine changed', 'changed medicine'],
      unwell: ['not well', 'unwell', 'feeling sick', 'i am sick', "i'm sick", 'not feeling well'],
      snooze: ['later', 'after some time', 'remind me later', 'in a while', 'not now later'],
      repeat: ['repeat', 'again', 'say again', 'say that again', "didn't understand", 'pardon', 'what'],
      decline: ['no', 'not taken', 'not yet', "didn't take", 'did not take', "haven't taken", 'have not taken', 'nope'],
      confirm: ['taken', 'i took it', 'took it', 'i have taken', 'i took', 'done', 'yes', 'yes taken', 'already taken', 'yes i took it'],
    },
    consent: {
      stop: ['stop', 'stop calling', "don't call", 'do not call', 'never call'],
      repeat: ['repeat', 'again', 'say again', "didn't understand", 'pardon'],
      decline: ['no', 'not interested', "don't want", 'nope'],
      confirm: ['yes', 'okay', 'ok', 'sure', 'i agree', 'agree', 'yes please'],
    },
  },
};
