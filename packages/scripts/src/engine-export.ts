import type { BlockWord, CallScript } from './types';

/**
 * Converts a CallScript into the file format the call engine reads
 * (services/call-engine/src/scripts/templates.ts, "Script template format").
 * Generated files live in packages/scripts/engine/<lang>.yaml; point the engine's
 * SCRIPTS_DIR at that folder. Never edit them by hand: run `pnpm --filter @tasalli/scripts build:engine`.
 *
 * What the engine format cannot express (documented in README, "Call engine format"):
 *  - gendered/oblique word forms (hi, mr): the masculine form is exported as the single word;
 *    the full forms go in the extra key `words_gendered` for a later engine change.
 *  - singular intro: exported as `full_intro_one`; the engine should use it when count is 1.
 */

const pick = (w: BlockWord): string => (typeof w === 'string' ? w : w.m ?? w.n ?? w.f ?? w.obl ?? '');
const mapWords = (rec: Record<string, BlockWord>) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, pick(v)]));
const gendered = (rec: Record<string, BlockWord>) =>
  Object.fromEntries(Object.entries(rec).filter(([, v]) => typeof v !== 'string'));

/** Engine cleanup drops empty pieces, so optional [..] brackets are removed and |form hints dropped. */
const flat = (t: string) => t.replace(/[[\]]/g, '').replace(/\{([a-z_0-9]+)\|[a-z]+\}/g, '{$1}');
const rename = (t: string, pairs: Record<string, string>) =>
  Object.entries(pairs).reduce((s, [a, b]) => s.split(`{${a}}`).join(`{${b}}`), t);
const tailAfter = (full: string, base: string): string => {
  const f = flat(full), b = flat(base);
  return f.startsWith(b) ? f.slice(b.length).replace(/^[\s,;]+/, '') : f;
};

/** Lines for the one-medicine-at-a-time flow; optional keys in the engine format. */
const stepLines = (r: NonNullable<CallScript['reminder_steps']>) => ({
  step_intro: r.intro_many, step_intro_one: r.intro_one, step_short_intro: r.short_intro_many,
  step_item: flat(r.item), step_item_one: flat(r.item_one), step_item_short: flat(r.item_short),
  step_time_of_day: r.time_of_day, step_ack_next: r.ack_next, step_ack_not_now: r.ack_not_now, step_ack_silence: r.ack_silence, step_unclear: r.unclear,
  step_all_done: r.all_done, step_all_done_one: r.all_done_one, step_some_left: r.some_left, step_some_left_one: r.some_left_one,
});

export function toEngineTemplates(s: CallScript): Record<string, unknown> {
  const t = s.templates, b = s.building, w = s.blocks;
  const kindTablet = w.kinds.tablet;
  const appearance = rename(flat(b.appearance.tablet), { colour_primary: 'colour' }).replace(kindTablet, '{kind}');
  const capsuleNoun = w.kinds.capsule;
  const twoColour = rename(flat(b.appearance.capsule_two_colour), { colour_primary: 'colour', colour_secondary: 'colour2' })
    .replace(/,?\s*\{size\}\s*$/, '').replace(capsuleNoun, '').replace(/\s+/g, ' ').trim();
  const strip = rename(flat(b.pack.strip), {}) ;
  const bottle = flat(b.pack.bottle_with_cap); // ends in {cap_phrase}; the engine drops it when no cap colour was entered
  const intro = (count: string) => `${t.reminder_full.greeting} ${count}`;
  const review = 'needs native-speaker review';
  const status = s.meta.review_status === 'approved' ? 'approved' : review;
  return {
    language: s.meta.language,
    status,
    reminder: {
      full_intro: intro(t.reminder_full.count_many),
      full_intro_one: intro(t.reminder_full.count_one),
      full_item: flat(t.reminder_full.item),
      full_outro: `${t.reminder_full.ask} ${t.reminder_full.more_options}`,
      short_intro: t.reminder_short.group_greeting,
      short_item: flat(t.reminder_short.group_item),
      short_outro: t.reminder_short.ask,
      short_single: flat(t.reminder_short.single),
      sunday_line: t.sunday.new_strip,
      unclear: t.unclear.first,
      keypad_only: t.unclear.keypad,
      confirm_ack: t.reply_ack.confirmed,
      snooze_ack: t.reply_ack.snoozed,
      snooze_used: t.reply_ack.snooze_used_up,
      declined_ack: s.engine_extra.declined_ack,
      not_taken_ack: t.reply_ack.not_taken,
      doctor_changed_ack: t.reply_ack.doctor_changed,
      unwell_ack: t.reply_ack.unwell,
      stop_ack: t.reply_ack.stop,
      no_input_goodbye: t.unclear.final,
      ...(s.reminder_steps ? stepLines(s.reminder_steps) : {}),
    },
    consent: {
      prompt: t.consent.ask,
      unclear: t.consent.unclear,
      keypad_only: t.consent.unclear,
      yes_ack: t.consent.agreed,
      no_ack: t.consent.declined,
      stop_ack: t.consent.stopped,
      no_input_goodbye: t.consent.no_answer_goodbye,
    },
    test: { prompt: t.test_call.intro, ack: t.reply_ack.goodbye },
    words: {
      person_suffix: '',
      child_fallback: s.engine_extra.child_fallback,
      dose_unit: { one: '', many: '' },
      ordinals: w.ordinals.slice(0, 8),
      list_joiner: ', ',
      list_last_joiner: s.engine_extra.list_and,
      food: w.food,
      appearance,
      two_colour: twoColour,
      colours: mapWords(w.colours),
      sizes: mapWords(w.sizes),
      shapes: mapWords(w.shapes),
      kinds: w.kinds,
      markings: mapWords(w.markings),
      pack: { strip, bottle, loose: b.pack.loose },
      cap_phrase: flat(b.pack.cap_phrase),
      print_phrase: tailAfter(b.pack.strip_with_print, b.pack.strip),
      disambiguator_number: b.disambiguator.number,
      disambiguator_printed_name: rename(b.disambiguator.printed_name, { strip_name_spelled: 'strip_letters' }),
    },
    words_gendered: {
      colours: gendered(w.colours), shapes: gendered(w.shapes), sizes: gendered(w.sizes),
    },
    phrases: {
      negation_words: [...new Set([...s.replies.negative, ...s.replies.consent_no].filter((p) => !p.includes(' ')))],
      reminder: {
        confirm: s.replies.confirm, decline: s.replies.negative, snooze: s.replies.snooze,
        repeat: s.replies.repeat, doctor_changed: s.replies.doctor_changed, unwell: s.replies.unwell,
        stop: s.replies.stop,
      },
      consent: { confirm: s.replies.consent_yes, decline: s.replies.consent_no, stop: s.replies.stop, repeat: s.replies.repeat },
    },
  };
}
