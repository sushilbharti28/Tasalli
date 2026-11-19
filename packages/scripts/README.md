# @tasalli/scripts

Call script templates (hi, en, bn, mr, ta, te), reply phrase lists, a reference composer and classifier, and the app strings (`app-strings/en.json`, `hi.json`).

Every script is **NEEDS NATIVE-SPEAKER REVIEW** (`meta.review_status`, first line of each file) until the founder sets it to `approved` with `approved_by` and `approved_on`. `isApproved()` is the gate for real calls. No medical claims anywhere: `test/no-claims.test.ts` scans scripts, app strings and `docs/content`.

## Files

| File | What |
| --- | --- |
| `<lang>.yaml` | Source of truth for a language (rich format: gender forms, optional segments). All six have identical keys (tested). |
| `engine/<lang>.yaml` | GENERATED in the call engine's format. Do not edit. `pnpm --filter @tasalli/scripts build:engine` |
| `src/compose.ts`, `classify.ts` | Reference composer and reply classifier (negative lists first, "no" beats "yes") |
| `app-strings/*.json` | i18next strings, same keys as `apps/mobile/src/i18n/en.ts` plus `legal.notMedicalAdvice` |

## Call engine format (what changes for the engine)

The engine reads `SCRIPTS_DIR/<lang>.yaml` in its own format (`services/call-engine/src/scripts/templates.ts`). Point **`SCRIPTS_DIR` at `packages/scripts/engine`**. The generated files pass the engine's required keys and placeholder allow-list (tested in `test/engine-export.test.ts`), and carry `phrases:` (reminder and consent lists plus `negation_words`) in the shape `loader.ts` merges.

What the engine format cannot express, and what the call-engine agent should change (none blocks a Hindi/English call):

1. **Singular intro.** `full_intro` says "{count} ..." for many. The export also writes `full_intro_one` (one medicine). Engine: use it when count is 1; `words.dose_unit` is exported empty because the count line already contains the unit.
2. **Gender agreement (hi, mr).** `words.colours/shapes/sizes` hold the masculine form only. The full forms are in the extra key `words_gendered` (`m`, `f`, `obl`). Hindi tablet = feminine ("पीली गोली"); strip = oblique; bottle = feminine; cap = masculine. Engine: pick the form by noun. Until then Hindi colour words can be wrong in gender for some colours (yellow, green, blue, brown, black).
3. **`short_single`.** Single-medicine short calls read better as one sentence; exported as `short_single`. Engine may use it instead of intro + item + outro.
4. **`not_taken_ack`.** The reply "not taken" before the snooze is used up should say "take it, then press 1 or press 2 for a reminder" (`not_taken_ack`). `declined_ack` is the final "we will tell {child_name}" line.
5. **Keypad prompts.** `consent.keypad_only` reuses the unclear line (it names keys 1 and 9). `test.prompt` has no key instruction; the engine's gather for test calls should accept any key.
6. **Count numerals.** Engine passes `{count}` as a digit; the source files use words ("चार"). Digits are read correctly by Polly Hindi; if a voice misreads, add `counts` support.
7. **Voices.** The engine maps `hi` and `en` to `Polly.Aditi`. bn, mr, ta, te need a voice per language (Twilio/Polly/Google). Not decided here; the founder should hear each language before approval.
8. Phrase lists are exported in Devanagari/Bengali/Tamil/Telugu script and romanised; speech engines return either. Matching ignores case, punctuation, nukta and chandrabindu.

## Source format

`{name}` inserts a family-entered or script value verbatim. `{name|f}` picks a gender form. `[ ... ]` is dropped when a value inside is empty. See comments at the top of `en.yaml`. Templates never contain doses or numbers other than keypad keys (tested).

## Reply order (safety rule 4)

stop, doctor_changed, unwell, repeat, snooze, **negative**, then confirm last. Empty or unmatched speech is unclear, never a confirmation. Words for "ran out" or "finished" are in `negative` on purpose.

## Review process

Native speakers read their `<lang>.yaml` aloud, then edit it. After edits run `pnpm --filter @tasalli/scripts test` and `build:engine`; commit both. The founder flips `review_status`.
