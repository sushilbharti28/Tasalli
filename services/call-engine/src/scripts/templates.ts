/**
 * Call script templates.
 * Pieces (pack, cap, print, marking, disambiguators) never start with punctuation: the template
 * that uses them supplies the separators, and separators around empty pieces are dropped.
 * The content agent writes packages/scripts/<lang>.yaml in this shape
 * (documented in README.md, "Script template format"). Built-in Hindi and English defaults below.
 *
 * Placeholders are {curly}. Family-entered values ({spoken_name}, {amount_text},
 * {extra_instruction}, {strip_letters}) are inserted verbatim, after template cleanup.
 */
export interface ScriptTemplates {
  language: string;
  /** e.g. "needs native-speaker review" until the founder approves the file. */
  status?: string;
  reminder: {
    full_intro: string;      // {person_name} {child_name} {count} {dose_unit}
    /** Optional: used instead of full_intro when exactly one medicine is due. */
    full_intro_one?: string;
    full_item: string;       // {ordinal} {spoken_name} {amount_text} {appearance_phrase} {pack_phrase} {disambiguator} {food_phrase} {extra_instruction}
    full_outro: string;
    short_intro: string;     // {person_name} {child_name} {names}
    short_item: string;      // {spoken_name} {amount_text} {disambiguator} {food_phrase} {extra_instruction}
    short_outro: string;
    /** Optional: one sentence for a short call with a single medicine (replaces intro + item + outro). */
    short_single?: string;
    sunday_line: string;     // {number} {spoken_name}
    unclear: string;         // asked once after unclear speech or silence
    keypad_only: string;     // second time: keypad only
    confirm_ack: string;
    snooze_ack: string;      // {minutes}
    snooze_used: string;     // second snooze request: take it now and press 1
    /** Optional: "not taken" while the snooze is still available: take it, press 1, or 2 to be reminded. */
    not_taken_ack?: string;
    declined_ack: string;    // not taken, snooze already used: {child_name} will be told
    doctor_changed_ack: string; // {child_name}
    unwell_ack: string;      // {child_name}
    stop_ack: string;
    no_input_goodbye: string;
    /**
     * One-medicine-at-a-time flow (v1.3). {ordinal} may already include the word for medicine (yaml) or not (built-in: "Pehli").
     * step_item_one / step_intro_one are used when exactly one medicine is due; step_short_* after the first call of the day.
     */
    step_intro: string;       // {person_name} {meal_phrase} {count_word} {count}; reminder calls never name the child
    step_intro_one: string;   // {person_name} {meal_phrase}
    step_short_intro: string; // later calls of the day: {person_name} {meal_phrase} {count_word} {count}
    step_short_intro_one: string;
    /** The food timing is said once, in the intro, so the item lines leave it out. */
    step_greeting?: string;   // {person_name}: said alone first, then a 1 s pause
    step_presence?: string;   // "can you hear me?": asked after the greeting, before any medicine or the consent question
    step_spoken_line?: string; // {spoken_name}: "Jise aap ... kehte hain."; left out when it equals the strip name
    step_item: string;        // {ordinal} {strip_name} {strength} {spoken_line} {spoken_name} {amount_text} {appearance_phrase} {pack_phrase} {disambiguator} {extra_instruction}
    step_item_one: string;    // no ordinal
    step_item_short: string;  // {ordinal} {spoken_name} {amount_text} {disambiguator} {extra_instruction}
    step_item_short_one: string;
    /** {meal_phrase}: with food, "<meal> <relation>" (meal by the dose's local hour: <11 breakfast, 11-16 lunch, else dinner); with food=any, the day part. */
    step_meals: Record<'breakfast' | 'lunch' | 'dinner', string>;
    step_food_rel: Record<'before' | 'after' | 'with', string>;
    /** Day part by local hour: morning <11, afternoon 11-16, evening 16-19, night 19+. */
    step_day_part: Record<'morning' | 'afternoon' | 'evening' | 'night', string>;
    /** {relation_phrase} by the caller's relation; missing (or "other") means no phrase. */
    step_relations: Partial<Record<'son' | 'daughter' | 'grandson' | 'granddaughter' | 'daughter_in_law' | 'son_in_law', string>>;
    step_count_words: string[]; // [0] is the word for 1
    step_ack_next: string;    // after "le li"
    step_ack_not_now: string; // after "nahi" / "baad mein" / 2
    step_ack_silence: string; // after no usable answer
    step_unclear: string;     // asked once, then keypad only
    step_all_done: string;
    step_all_done_one: string;
    step_some_left: string;
    step_some_left_one: string;
    /** Said when a medicine has been heard 3 times (repeated twice): the dose stays unconfirmed and the call moves on. */
    step_repeat_limit?: string;
    /** Said when the call's soft time limit is reached: the call ends and the unconfirmed doses follow the normal retry/snooze rules. */
    step_time_up?: string;
  };
  consent: {
    prompt: string;          // {person_name} {relation_phrase} {child_name}
    unclear: string;
    keypad_only: string;
    yes_ack: string;
    no_ack: string;
    stop_ack: string;
    no_input_goodbye: string;
  };
  test: {
    prompt: string;          // {person_name}
    ack: string;
  };
  words: {
    person_suffix: string;   // " ji" in Hindi, "" in English
    child_fallback: string;  // used when the account holder has no name
    dose_unit: { one: string; many: string };
    ordinals: string[];
    list_joiner: string;     // between names in the short intro
    list_last_joiner: string;
    food: Record<'before' | 'after' | 'with' | 'any', string>;
    /** Optional variants used before 11:00 local time (e.g. "nashte ke baad"). */
    food_morning?: Partial<Record<'before' | 'after' | 'with' | 'any', string>>;
    appearance: string;      // {size} {colour} {shape} {kind} {marking}
    two_colour: string;      // {colour} {colour2}, capsules
    colours: Record<string, string>;
    sizes: Record<string, string>;
    shapes: Record<string, string>;
    kinds: Record<string, string>;
    markings: Record<string, string>;
    pack: { strip: string; bottle: string; loose: string }; // {pack_colour} {print_colour} {cap_phrase}
    cap_phrase: string;      // {cap_colour}
    print_phrase: string;    // {print_colour}
    disambiguator_number: string;        // {number}
    disambiguator_printed_name: string;  // {strip_letters}
  };
  /** Optional gender forms (hi): word key -> { m, f, obl }. Chosen by the noun the word describes. */
  words_gendered?: Partial<Record<'colours' | 'shapes' | 'sizes', Record<string, Partial<Record<'m' | 'f' | 'obl', string>>>>>;
}

export const HI_TEMPLATES: ScriptTemplates = {
  language: 'hi',
  status: 'needs native-speaker review',
  reminder: {
    full_intro: 'Namaste {person_name}, {child_name} ki taraf se dawai ka samay. Abhi {count} {dose_unit} leni hain.',
    full_item: '{ordinal}, {spoken_name}: {amount_text}, {appearance_phrase}, {pack_phrase}, {disambiguator}. {food_phrase}. {extra_instruction}',
    full_outro: 'Dawai le lein, phir boliye "le li" ya "haan", ya 1 dabaiye. Dobara sunne ke liye "phir se" boliye, ya 0 dabaiye. Pandrah minute baad yaad dilane ke liye 2.',
    short_intro: '{person_name}, {names} ka samay.',
    short_item: '{spoken_name}, {disambiguator}: {amount_text}, {food_phrase}. {extra_instruction}',
    short_outro: 'Le li ho to "le li" ya "haan" boliye, ya 1 dabaiye. Dobara sunne ke liye "phir se" boliye, ya 0 dabaiye.',
    sunday_line: 'Nayi patti kholi ho to us par {number} likh dijiye.',
    unclear: 'Maaf kijiye, samajh nahi aaya. Dawai le li ho to "le li" ya "haan" boliye, ya 1 dabaiye.',
    keypad_only: 'Dawai le li ho to 1 dabaiye. Dobara sunne ke liye 0.',
    confirm_ack: 'Dhanyavaad. Apna khayal rakhiye.',
    snooze_ack: 'Theek hai, {minutes} minute baad phir yaad dilayenge.',
    snooze_used: 'Ab dawai le lijiye. Le li ho to 1 dabaiye.',
    declined_ack: 'Theek hai. Hum {child_name} ko bata denge.',
    doctor_changed_ack: 'Theek hai. Hum {child_name} ko bata denge ki doctor ne dawai badli hai.',
    unwell_ack: 'Apna khayal rakhiye. Hum {child_name} ko abhi bata rahe hain.',
    stop_ack: 'Theek hai. Ab hum aapko phone nahi karenge. Namaste.',
    no_input_goodbye: 'Hum thodi der mein phir phone karenge. Namaste.',
    step_greeting: 'Namaste {person_name}.',
    step_presence: 'Kya aapko awaaz aa rahi hai? "Haan" boliye, ya 1 dabaiye.',
    step_spoken_line: 'Jise aap {spoken_name} kehte hain.',
    step_intro: 'Aapki {meal_phrase} wali {count_word} dawaiyon ka samay ho gaya hai. Ek-ek karke batate hain.',
    step_intro_one: 'Aapki {meal_phrase} wali dawai ka samay ho gaya hai.',
    step_short_intro: 'Aapki {meal_phrase} wali {count_word} dawaiyon ka samay ho gaya hai. Ek-ek karke batate hain.',
    step_short_intro_one: 'Aapki {meal_phrase} wali dawai ka samay ho gaya hai.',
    step_item: '{ordinal} dawai: {strip_name} {strength}. {spoken_line} {amount_text}, {appearance_phrase}, {pack_phrase}, {disambiguator}. {extra_instruction}. Le li ho to "le li" ya "haan" boliye, ya 1 dabaiye. Dobara sunne ke liye "phir se" boliye, ya 0 dabaiye.',
    step_item_one: 'Dawai: {strip_name} {strength}. {spoken_line} {amount_text}, {appearance_phrase}, {pack_phrase}, {disambiguator}. {extra_instruction}. Le li ho to "le li" ya "haan" boliye, ya 1 dabaiye. Dobara sunne ke liye "phir se" boliye, ya 0 dabaiye.',
    step_item_short: '{ordinal} dawai: {strip_name} {strength}. {spoken_line} {amount_text}, {disambiguator}. {extra_instruction}. Le li ho to "le li" ya "haan" boliye, ya 1 dabaiye. Dobara sunne ke liye "phir se" boliye, ya 0 dabaiye.',
    step_item_short_one: 'Dawai: {strip_name} {strength}. {spoken_line} {amount_text}, {disambiguator}. {extra_instruction}. Le li ho to "le li" ya "haan" boliye, ya 1 dabaiye. Dobara sunne ke liye "phir se" boliye, ya 0 dabaiye.',
    step_meals: { breakfast: 'nashte', lunch: 'dopahar ke khane', dinner: 'raat ke khane' },
    step_food_rel: { before: 'se pehle', after: 'ke baad', with: 'ke saath' },
    step_day_part: { morning: 'subah ki', afternoon: 'dopahar ki', evening: 'shaam ki', night: 'raat ki' },
    step_relations: { son: 'aapke bete', daughter: 'aapki beti', grandson: 'aapke pote', granddaughter: 'aapki poti', daughter_in_law: 'aapki bahu', son_in_law: 'aapke damad' },
    step_count_words: ['ek', 'do', 'teen', 'chaar', 'paanch', 'chhah', 'saat', 'aath', 'nau', 'das'],
    step_ack_next: 'Theek hai.',
    step_ack_not_now: 'Koi baat nahi, thodi der mein phir yaad dilayenge.',
    step_ack_silence: 'Koi baat nahi.',
    step_unclear: 'Maaf kijiye, samajh nahi aaya. Le li ho to 1 dabaiye.',
    step_all_done: 'Bahut achha. Sab dawaiyan le li gayi hain. Dhanyavaad.',
    step_all_done_one: 'Bahut achha. Dawai le li gayi hai. Dhanyavaad.',
    step_some_left: 'Dhanyavaad. Baaki dawai ke liye thodi der mein phir phone karenge.',
    step_some_left_one: 'Dhanyavaad. Dawai ke liye thodi der mein phir phone karenge.',
    step_repeat_limit: 'Koi baat nahi, aage badhte hain.',
    step_time_up: 'Samay poora ho gaya. Baaki dawai ke liye thodi der mein phir phone karenge. Dhanyavaad.',
  },
  consent: {
    prompt: 'Namaste {person_name}. Yeh Tasalli ki taraf se phone hai. {relation_phrase} {child_name} aapko dawai ki yaad dilane ke liye phone karwana chahte hain. Yeh call record ki jayegi. Agar aap haan kehna chahte hain, to "haan" boliye ya 1 dabaiye. Agar aap ye phone nahi chahte, to 9 dabaiye, phir hum kabhi phone nahi karenge.',
    unclear: 'Maaf kijiye, samajh nahi aaya. Haan ke liye 1 dabaiye. Phone nahi chahiye to 9 dabaiye.',
    keypad_only: 'Haan ke liye 1 dabaiye. Phone nahi chahiye to 9 dabaiye.',
    yes_ack: 'Dhanyavaad. Ab hum dawai ke samay par phone karenge. Namaste.',
    no_ack: 'Theek hai. Hum {child_name} ko bata denge. Namaste.',
    stop_ack: 'Theek hai. Ab hum aapko kabhi phone nahi karenge. Namaste.',
    no_input_goodbye: 'Hum baad mein phir phone karenge. Namaste.',
  },
  test: {
    prompt: 'Namaste {person_name}. Yeh Tasalli ki test call hai. Dawai ke samay aise hi phone aayega. Sunne ke baad 1 dabaiye.',
    ack: 'Dhanyavaad. Test call poori hui.',
  },
  words: {
    person_suffix: ' ji',
    child_fallback: 'Aapke parivaar',
    dose_unit: { one: 'dawai', many: 'dawaiyan' },
    ordinals: ['Pehli', 'Doosri', 'Teesri', 'Chauthi', 'Paanchvi', 'Chhathi', 'Saatvi', 'Aathvi'],
    list_joiner: ', ',
    list_last_joiner: ' aur ',
    food: { before: 'Khane se pehle', after: 'Khane ke baad', with: 'Khane ke saath', any: '' },
    food_morning: { before: 'Nashte se pehle', after: 'Nashte ke baad', with: 'Nashte ke saath' },
    appearance: '{size} {colour} {shape} {kind}, {marking}',
    two_colour: '{colour}-{colour2}',
    colours: {
      white: 'safed', red: 'laal', pink: 'gulabi', orange: 'narangi', yellow: 'peeli', green: 'hari', blue: 'neeli',
      brown: 'bhoori', black: 'kaali', purple: 'baingani', grey: 'slaty', silver: 'chaandi wali', golden: 'sunehri',
    },
    sizes: { rai: 'bahut chhoti', dal: 'chhoti', matar: 'matar jitni', badam: 'badi', bigger: 'bahut badi' },
    shapes: { round: 'gol', oval: 'lambi-gol', long: 'lambi', square: 'chaukor' },
    kinds: { tablet: 'goli', capsule: 'capsule', syrup: 'syrup', other: 'dawai' },
    markings: { plain: '', line: 'beech mein line', letters: 'us par kuch likha hai', unknown: '' },
    pack: { strip: '{pack_colour} patte se, {print_phrase}', bottle: '{pack_colour} bottle wali, {cap_phrase}', loose: '' },
    cap_phrase: '{cap_colour} dhakkan',
    print_phrase: '{print_colour} likhai',
    disambiguator_number: '{number} number wali',
    disambiguator_printed_name: 'jis patte par {strip_letters} likha hai',
  },
};

export const EN_TEMPLATES: ScriptTemplates = {
  language: 'en',
  status: 'needs native-speaker review',
  reminder: {
    full_intro: 'Hello {person_name}, this is a medicine reminder from {child_name}. It is time for {count} {dose_unit}.',
    full_item: '{ordinal}, {spoken_name}: {amount_text}, {appearance_phrase}, {pack_phrase}, {disambiguator}. {food_phrase}. {extra_instruction}',
    full_outro: 'Please take your medicine, then say "taken" or press 1. Press 0 to hear this again. Press 2 to be reminded in fifteen minutes.',
    short_intro: '{person_name}, time for {names}.',
    short_item: '{spoken_name}, {disambiguator}: {amount_text}, {food_phrase}. {extra_instruction}',
    short_outro: 'When you have taken it, say "taken" or press 1.',
    sunday_line: 'If you opened a new strip, please write {number} on it.',
    unclear: 'Sorry, I did not understand. If you have taken it, say "taken" or press 1.',
    keypad_only: 'If you have taken it, press 1. Press 0 to hear this again.',
    confirm_ack: 'Thank you. Take care.',
    snooze_ack: 'All right, I will remind you again in {minutes} minutes.',
    snooze_used: 'Please take it now. When you have taken it, press 1.',
    declined_ack: 'All right. We will let {child_name} know.',
    doctor_changed_ack: 'All right. We will let {child_name} know that the doctor changed the medicine.',
    unwell_ack: 'Please take care. We are letting {child_name} know now.',
    stop_ack: 'All right. We will not call you again. Goodbye.',
    no_input_goodbye: 'We will call again in a little while. Goodbye.',
    step_greeting: 'Namaste {person_name}.',
    step_presence: 'Can you hear me? Say "yes", or press 1.',
    step_spoken_line: 'You call it {spoken_name}.',
    step_intro: 'It is time for your {count_word} {meal_phrase} medicines. We will go one by one.',
    step_intro_one: 'It is time for your {meal_phrase} medicine.',
    step_short_intro: 'It is time for your {count_word} {meal_phrase} medicines. We will go one by one.',
    step_short_intro_one: 'It is time for your {meal_phrase} medicine.',
    step_item: '{ordinal} medicine: {strip_name} {strength}. {spoken_line} {amount_text}, {appearance_phrase}, {pack_phrase}, {disambiguator}. {extra_instruction}. When you have taken it, say "taken" or press 1.',
    step_item_one: 'Medicine: {strip_name} {strength}. {spoken_line} {amount_text}, {appearance_phrase}, {pack_phrase}, {disambiguator}. {extra_instruction}. When you have taken it, say "taken" or press 1.',
    step_item_short: '{ordinal} medicine: {strip_name} {strength}. {spoken_line} {amount_text}, {disambiguator}. {extra_instruction}. When you have taken it, say "taken" or press 1.',
    step_item_short_one: 'Medicine: {strip_name} {strength}. {spoken_line} {amount_text}, {disambiguator}. {extra_instruction}. When you have taken it, say "taken" or press 1.',
    step_meals: { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' },
    step_food_rel: { before: 'before', after: 'after', with: 'with' },
    step_day_part: { morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'night' },
    step_relations: { son: 'your son', daughter: 'your daughter', grandson: 'your grandson', granddaughter: 'your granddaughter', daughter_in_law: 'your daughter-in-law', son_in_law: 'your son-in-law' },
    step_count_words: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
    step_ack_next: 'All right.',
    step_ack_not_now: 'No problem, we will remind you again in a little while.',
    step_ack_silence: 'No problem.',
    step_unclear: 'Sorry, I did not understand. If you have taken it, press 1.',
    step_all_done: 'Very good. All the medicines have been taken. Thank you.',
    step_all_done_one: 'Very good. The medicine has been taken. Thank you.',
    step_some_left: 'Thank you. We will call again in a little while for the remaining medicine.',
    step_some_left_one: 'Thank you. We will call again in a little while for the medicine.',
  },
  consent: {
    prompt: 'Hello {person_name}. This call may be recorded to improve the service. {child_name} would like to send you medicine reminder calls. To agree, say "yes" or press 1. If you do not want these calls, press 9 and we will never call again.',
    unclear: 'Sorry, I did not understand. Press 1 to agree. Press 9 if you do not want these calls.',
    keypad_only: 'Press 1 to agree. Press 9 if you do not want these calls.',
    yes_ack: 'Thank you. We will call you at medicine time. Goodbye.',
    no_ack: 'All right. We will let {child_name} know. Goodbye.',
    stop_ack: 'All right. We will never call you again. Goodbye.',
    no_input_goodbye: 'We will call again later. Goodbye.',
  },
  test: {
    prompt: 'Hello {person_name}. This is a Tasalli test call. Medicine reminders will sound like this. Press 1 when you have heard it.',
    ack: 'Thank you. The test call is complete.',
  },
  words: {
    person_suffix: '',
    child_fallback: 'your family',
    dose_unit: { one: 'medicine', many: 'medicines' },
    ordinals: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'],
    list_joiner: ', ',
    list_last_joiner: ' and ',
    food: { before: 'Before food', after: 'After food', with: 'With food', any: '' },
    food_morning: { before: 'Before breakfast', after: 'After breakfast', with: 'With breakfast' },
    appearance: '{size} {colour} {shape} {kind}, {marking}',
    two_colour: '{colour} and {colour2}',
    colours: {},
    sizes: { rai: 'tiny', dal: 'small', matar: 'pea-sized', badam: 'large', bigger: 'very large' },
    shapes: { round: 'round', oval: 'oval', long: 'long', square: 'square' },
    kinds: { tablet: 'tablet', capsule: 'capsule', syrup: 'syrup', other: 'medicine' },
    markings: { plain: '', line: 'with a line in the middle', letters: 'with letters on it', unknown: '' },
    pack: { strip: 'from the {pack_colour} strip {print_phrase}', bottle: 'from the {pack_colour} bottle {cap_phrase}', loose: '' },
    cap_phrase: 'with the {cap_colour} cap',
    print_phrase: 'with {print_colour} printing',
    disambiguator_number: 'the one marked {number}',
    disambiguator_printed_name: 'the strip that says {strip_letters}',
  },
};

export const BUILTIN_TEMPLATES: Record<string, ScriptTemplates> = { hi: HI_TEMPLATES, en: EN_TEMPLATES };
