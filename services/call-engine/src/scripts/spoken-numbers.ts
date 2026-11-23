/**
 * Speech rendering of numbers and units (v1.5). A pure function: it only changes the text that is SPOKEN.
 * Stored data (amount_text, strength_text, ...) stays exactly as the family entered it (safety rule 1); the number
 * value is never changed, only written as Hindi words ("120" -> "ek sau bees"), so a digit is never read out in the wrong way.
 *
 * 1..99 have their own words in Hindi, so the tables list all of them. Above 99999, and anything odd, is read digit by digit.
 */
export type NumberScript = 'roman' | 'devanagari';

const ROMAN = ['zero', 'ek', 'do', 'teen', 'chaar', 'paanch', 'chhah', 'saat', 'aath', 'nau', 'das', 'gyaarah', 'baarah', 'terah', 'chaudah', 'pandrah',
  'solah', 'satrah', 'atharah', 'unnees', 'bees', 'ikkees', 'baaees', 'teis', 'chaubees', 'pachchees', 'chhabbees', 'sattaaees', 'atthaaees', 'unatees',
  'tees', 'ikatees', 'batees', 'taintees', 'chauntees', 'paintees', 'chhattees', 'saintees', 'adtees', 'untaalees', 'chaalees', 'iktaalees', 'bayaalees',
  'taintaalees', 'chauvaalees', 'paitaalees', 'chhiyaalees', 'saintaalees', 'adtaalees', 'unchaas', 'pachaas', 'ikyaavan', 'baavan', 'tirpan', 'chauvan',
  'pachpan', 'chhappan', 'sattaavan', 'atthaavan', 'unsath', 'saath', 'iksath', 'baasath', 'tirsath', 'chausath', 'painsath', 'chhiyaasath', 'sadsath',
  'adsath', 'unhattar', 'sattar', 'ikhattar', 'bahattar', 'tihattar', 'chauhattar', 'pachhattar', 'chhihattar', 'sathattar', 'athhattar', 'unaasi', 'assi',
  'ikyaasi', 'bayaasi', 'tiraasi', 'chaurasi', 'pachaasi', 'chhiyaasi', 'sataasi', 'athaasi', 'nawaasi', 'nabbe', 'ikyaanave', 'baanave', 'tiraanave',
  'chauraanave', 'pachaanave', 'chhiyaanave', 'sattaanave', 'atthaanave', 'ninyaanave'];

const DEVA = ['ज़ीरो', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह',
  'उन्नीस', 'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस',
  'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस', 'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस',
  'उनचास', 'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ', 'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ',
  'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी', 'अस्सी',
  'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी', 'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे',
  'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे'];

const WORDS = {
  roman: { tbl: ROMAN, sau: 'sau', hazaar: 'hazaar', aadha: 'aadha', dedh: 'dedh', dhaai: 'dhaai', point: 'point',
    mg: 'milligram', ml: 'milli litre', mcg: 'microgram', g: 'gram', iu: 'unit', kg: 'kilogram' },
  devanagari: { tbl: DEVA, sau: 'सौ', hazaar: 'हज़ार', aadha: 'आधा', dedh: 'डेढ़', dhaai: 'ढाई', point: 'पॉइंट',
    mg: 'मिलीग्राम', ml: 'मिली लीटर', mcg: 'माइक्रोग्राम', g: 'ग्राम', iu: 'यूनिट', kg: 'किलोग्राम' },
} as const;

/** Whole number as words: 0..99999. Beyond that (or not a plain integer) it is read digit by digit. */
export function numberToWords(n: number | string, script: NumberScript = 'roman'): string {
  const w = WORDS[script];
  const s = String(n);
  if (!/^\d+$/.test(s)) throw new Error(`not a whole number: ${s}`);
  const v = Number(s);
  if (s.length > 5 || s.length > 1 && s.startsWith('0')) return [...s].map((c) => w.tbl[Number(c)]!).join(' '); // 007 and 123456 are read digit by digit
  const below1000 = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return [h ? `${w.tbl[h]!} ${w.sau}` : '', r || !h ? w.tbl[r]! : ''].filter(Boolean).join(' ');
  };
  if (v < 1000) return below1000(v);
  const th = Math.floor(v / 1000), r = v % 1000;
  return [`${below1000(th)} ${w.hazaar}`, r ? below1000(r) : ''].filter(Boolean).join(' ');
}

function decimalToWords(int: string, frac: string, script: NumberScript): string {
  const w = WORDS[script];
  if (frac === '5' || frac === '50') {
    if (int === '0') return w.aadha;
    if (int === '1') return w.dedh;
    if (int === '2') return w.dhaai;
  }
  return `${numberToWords(int, script)} ${w.point} ${[...frac].map((c) => w.tbl[Number(c)]!).join(' ')}`;
}

const UNITS: Record<string, 'mg' | 'ml' | 'mcg' | 'g' | 'iu' | 'kg'> = { mg: 'mg', ml: 'ml', mcg: 'mcg', 'µg': 'mcg', 'μg': 'mcg', g: 'g', gm: 'g', iu: 'iu', kg: 'kg' };

// One pass over: n 1/2 | 1/2 | n½ | ½ | decimal | integer, each optionally followed by a unit; then the word "half".
const TOKEN = /(\d+)\s+1\/2(?!\d)|(?<![\d/])1\/2(?![\d/])|(\d+)\s*½|½|(\d+)\.(\d+)|(\d+)/gu;
const UNIT_AFTER = /^\s*(mcg|mg|ml|kg|gm|iu|g|µg|μg)(?![\p{L}\p{N}])/iu;

export function speakNumbers(text: string, script: NumberScript = 'roman'): string {
  const w = WORDS[script];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    if (start < last) continue;
    let words: string;
    if (m[1] !== undefined) words = decimalToWords(m[1], '5', script);
    else if (m[2] !== undefined) words = decimalToWords(m[2], '5', script);
    else if (m[0] === '½' || m[0] === '1/2') words = w.aadha;
    else if (m[3] !== undefined) words = decimalToWords(m[3], m[4]!, script);
    else words = numberToWords(m[5]!, script);
    let end = start + m[0].length;
    const u = UNIT_AFTER.exec(text.slice(end));
    let unit = '';
    if (u) { unit = w[UNITS[u[1]!.toLowerCase()]!]; end += u[0].length; }
    const prev = text[start - 1];
    const glued = prev !== undefined && /[\p{L}]/u.test(prev); // "Telma40" -> "Telma chaalees"
    out += text.slice(last, start) + (glued ? ' ' : '') + words + (unit ? ` ${unit}` : '');
    last = end;
  }
  out += text.slice(last);
  return out.replace(/(?<![\p{L}\p{N}])half(?![\p{L}\p{N}])/giu, w.aadha);
}

/** Number words follow the script of the template text: Devanagari templates get Devanagari words, Roman ones Roman words. */
export const scriptOf = (sample: string): NumberScript => (/[\u0900-\u097F]/.test(sample) ? 'devanagari' : 'roman');
