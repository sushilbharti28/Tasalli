// Reference reply matcher. It exists to prove the speech test set and the
// scenario suites are self-consistent; it is NOT the production matcher
// (that lives in services/call-engine). Safety rule 4: special phrases first,
// then stop, then negatives, then the rest, and confirm last. Anything not
// recognised is 'unclear'.

import type { CallLanguage, ReplyIntent } from '@tasalli/contracts';

export type MatchPurpose = 'reminder' | 'consent';
export type ReplyMatcher = (
  transcript: string | undefined,
  ctx: { language: CallLanguage; purpose: MatchPurpose },
) => ReplyIntent | Promise<ReplyIntent>;

type Pattern = string | RegExp;
type Table = Partial<Record<ReplyIntent | 'special', Pattern[]>>;

/** Phrases that contain a negative word but are not a "not taken" reply. Checked first. */
const SPECIAL: Array<[Pattern, ReplyIntent]> = [
  ['samajh nahi aaya', 'repeat'], ['samajh nahin aaya', 'repeat'], ['समझ नहीं आया', 'repeat'],
  ["didn't understand", 'repeat'], ['didnt understand', 'repeat'], ['did not understand', 'repeat'],
  ['kalla nahi', 'repeat'], ['कळलं नाही', 'repeat'], ['कळले नाही', 'repeat'],
  ['bujhini', 'repeat'], ['বুঝিনি', 'repeat'], ['bujhte parini', 'repeat'], ['বুঝতে পারিনি', 'repeat'],
  ['puriyala', 'repeat'], ['புரியல', 'repeat'], ['புரியவில்லை', 'repeat'],
  ['artham kaledu', 'repeat'], ['అర్థం కాలేదు', 'repeat'],
  // "don't stop" must never block a number
  ['band mat karo', 'unclear'], ['बंद मत करो', 'unclear'], ["don't stop", 'unclear'], ['dont stop', 'unclear'],
  // "haan, bolo" is "yes, go on", said when picking up: not a confirmation
  ['haan bolo', 'unclear'], ['haan ji bolo', 'unclear'], ['हाँ बोलो', 'unclear'], ['हां बोलो', 'unclear'],
  ['hello', 'unclear'], ['हेलो', 'unclear'],
];

const EN: Table = {
  stop: ['stop calling', 'stop', "don't call", 'dont call', 'do not call', 'no more calls'],
  decline: ['no', 'not', 'nope', "didn't", 'didnt', 'did not', "haven't", 'havent', 'have not', 'not yet', 'never'],
  snooze: ['later', 'after some time', 'remind me later', 'in a while'],
  repeat: ['repeat', 'again', 'say again', 'pardon'],
  doctor_changed: ['doctor changed'],
  unwell: ['not feeling well', 'unwell'],
  confirm: ['yes', 'yeah', 'taken', 'took it', 'i took', 'done', 'have taken'],
};

const HI: Table = {
  stop: ['band karo', 'mat karo phone', 'phone mat karo', 'phone band karo', 'बंद करो', 'मत करो फोन', 'फोन मत करो', 'फोन बंद करो'],
  decline: ['nahi', 'nahin', 'nahee', 'nai', 'nhi', 'na', 'abhi nahi', 'नहीं', 'नही', 'ना', 'नहीं ली'],
  snooze: ['baad mein', 'baad me', 'thodi der', 'बाद में', 'थोड़ी देर', 'थोडी देर'],
  repeat: ['phir se', 'fir se', 'dobara', 'फिर से', 'दोबारा'],
  doctor_changed: ['doctor ne badli', 'doctor ne badal', 'dawai badal', 'डॉक्टर ने बदली', 'डॉक्टर ने बदल'],
  confirm: ['le li', 'le liya', 'le lee', 'haan', 'han', 'haa', 'ji haan', 'kha li', 'kha liya', 'ho gaya', 'ले ली', 'ले लिया', 'हाँ', 'हां', 'खा ली', 'खा लिया', 'हो गया'],
};

const LANG: Record<CallLanguage, Table> = {
  en: {},
  hi: {},
  mr: {
    stop: ['band kara', 'phone karu naka', 'बंद करा', 'फोन करू नका'],
    decline: ['nahi', 'nahee', 'naahi', 'नाही', 'ajun nahi', 'अजून नाही', 'naka', 'नका'],
    snooze: ['nantar', 'thodya velane', 'नंतर', 'थोड्या वेळाने'],
    repeat: ['parat', 'punha', 'परत', 'पुन्हा'],
    doctor_changed: ['doctor ne badalli', 'डॉक्टरांनी बदलली'],
    confirm: ['ho', 'hoy', 'ghetli', 'ghetla', 'ghetle', 'zhali', 'jhala', 'हो', 'होय', 'घेतली', 'घेतला', 'घेतले', 'झाली', 'झालं'],
  },
  bn: {
    stop: ['bondho koro', 'phone korben na', 'বন্ধ করো', 'বন্ধ করুন', 'ফোন করবেন না'],
    decline: ['na', 'না', 'ni', 'নি', 'ekhono', 'এখনো', /(^| )\S+ini( |$)/u, /(^| )\S+নি( |$)/u],
    snooze: ['pore', 'ektu pore', 'পরে', 'একটু পরে'],
    repeat: ['abar bolun', 'abar', 'আবার'],
    confirm: ['hyan', 'ha', 'haan', 'kheyechi', 'niyechi', 'হ্যাঁ', 'হ্যা', 'খেয়েছি', 'নিয়েছি', 'খেয়ে নিয়েছি'],
  },
  ta: {
    stop: ['niruthunga', 'nirutthunga', 'நிறுத்துங்க', 'நிறுத்து'],
    decline: ['illai', 'illa', 'innum', 'இல்லை', 'இல்ல', 'இன்னும்', /(^| )\S+(ala|kala|la)( |$)/u, /(^| )\S+(ல|லை)( |$)/u],
    snooze: ['apparam', 'konja neram', 'அப்புறம்', 'கொஞ்ச நேரம்'],
    repeat: ['thirumba', 'meendum', 'திரும்ப', 'மீண்டும்'],
    confirm: ['aamaa', 'aama', 'aam', 'saapten', 'saapitten', 'sapten', 'eduthuten', 'eduthutten', 'pottuten', 'ஆமா', 'ஆம்', 'சாப்பிட்டேன்', 'எடுத்துட்டேன்', 'போட்டுட்டேன்'],
  },
  te: {
    stop: ['apandi', 'aapandi', 'ఆపండి', 'phone cheyakandi', 'ఫోన్ చేయకండి'],
    decline: ['ledu', 'ledhu', 'లేదు', 'kaadu', 'కాదు', 'inka', 'ఇంకా', 'vaddu', 'వద్దు', /ledu|ledhu|లేదు/u],
    snooze: ['tarvata', 'taruvata', 'konchem sepu', 'తర్వాత', 'తరువాత', 'కొంచెం సేపు'],
    repeat: ['malli', 'మళ్ళీ', 'మళ్లీ'],
    confirm: ['avunu', 'avnu', 'vesukunna', 'vesukunnanu', 'tinnanu', 'aindi', 'ayindi', 'అవును', 'వేసుకున్నా', 'వేసుకున్నాను', 'తిన్నాను', 'అయింది', 'అయ్యింది'],
  },
};

const ORDER: ReplyIntent[] = ['stop', 'decline', 'snooze', 'repeat', 'doctor_changed', 'unwell', 'confirm'];

export function normalise(transcript: string): string {
  return transcript
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hit(text: string, p: Pattern): boolean {
  return typeof p === 'string' ? ` ${text} `.includes(` ${p} `) : p.test(text);
}

function tablesFor(language: CallLanguage): Table[] {
  // English and Hindi words are common in every language's replies (code-mixing).
  return language === 'hi' || language === 'en' ? [LANG[language], HI, EN] : [LANG[language], EN, HI];
}

export const referenceMatcher: ReplyMatcher = (transcript, { language }) => {
  if (!transcript) return 'unclear';
  const text = normalise(transcript);
  if (!text) return 'unclear';
  for (const [p, intent] of SPECIAL) if (hit(text, p)) return intent;
  const tables = tablesFor(language);
  for (const intent of ORDER) {
    for (const t of tables) {
      // Tamil negative suffixes (-la) would misread Hindi/Marathi words; only the
      // language's own table may use regex patterns.
      const pats = (t[intent] ?? []).filter((p) => t === LANG[language] || typeof p === 'string');
      if (pats.some((p) => hit(text, p))) return intent;
    }
  }
  return 'unclear';
};
