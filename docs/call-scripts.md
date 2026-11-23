# Call scripts (DRAFT, needs native-speaker and doctor review)

Scripts are templates in `packages/scripts/<language>.yaml`. Variables in `{curly}` come from the family's own entries and are spoken verbatim. The call never adds medical advice.

## Reminder call, one medicine at a time (v1.6, 24 Nov 2026; the lines in use)

Hindi only for now. The call speaks Devanagari from `packages/scripts/hi.yaml` (`reminder_steps`); this is the same text in Roman Hindi for review. `[pause]` is the longer pause before the question.

1. Opening (its "haan" / 1 is also the check that the parent can hear the call):
   > Namaste {person_name} ji. Hum Tasalli app se bol rahe hain. Aapko {meal_phrase} wali {count_word} dawaiyon ki yaad dilane ke liye phone kiya hai. Dawaiyon ke baare mein sunne ke liye, "haan" boliye, ya 1 dabaiye.
2. After "haan": the choices, once.
   > Theek hai. Hum ek-ek karke dawai batate hain. Har dawai lene ke baad, "haan" boliye, ya 1 dabaiye. Dawai ka rang-roop sunna ho, ya dobara sunna ho, to "phir se" boliye, ya 0 dabaiye. Abhi nahi leni ho, to "nahi" boliye, ya 2 dabaiye.
3. Each medicine. A medicine the parent knows gets the name only: "Aapki pehli dawai, 1 goli Telma 40 mg ki hai. Ise aap BP wali kehte hain. [pause] Dawai lene ke baad, "haan" boliye, ya 1 dabaiye." The look and pack below are added when they matter (new or changed in the last 7 days, looks like another of the parent's medicines, number/printed-name label, or the parent cannot read the strip) and whenever the parent says "phir se" / 0:
   > Aapki pehli dawai, 1 goli Telma 40 mg ki hai. Ise aap BP wali kehte hain. Yeh ek chhoti si safed rang ki gol aakar ki goli hai. Iske beech mein ek line hai. Iska patta laal rang ka hai. [pause] Dawai lene ke baad, "haan" boliye, ya 1 dabaiye.
   >
   > Aapki doosri dawai, 1 capsule Glycomet 500 ki hai. Ise aap sugar wali kehte hain. Yeh capsule dekhne mein aadha peela aur aadha safed hai. Iska patta chaandi ke rang ka hai. [pause] Dawai lene ke baad, "haan" boliye, ya 1 dabaiye.
   >
   > Aapki teesri dawai, 1 chammach (5 ml) Cremaffin ki hai. Ise aap pet wali dawai kehte hain. Iski bottle bhoore rang ki hai. Iska dhakkan laal rang ka hai. [pause] Dawai lene ke baad, "haan" boliye, ya 1 dabaiye.
4. Replies: "haan" / 1: "Theek hai." and the next medicine. "nahi" / 2: "Koi baat nahi, thodi der mein phir yaad dilayenge." Silence: "Hum phir se batate hain." and the medicine again (once). Unclear: "Maaf kijiye, samajh nahi aaya. Dawai lene ke baad, "haan" boliye, ya 1 dabaiye. Dobara sunna ho, to "phir se" boliye, ya 0 dabaiye."
5. No usable answer (heard 3 times, or unclear twice): "Maaf kijiye, kisi wajah se is dawai ka jawab darj nahi ho paaya. Hum agli dawai par chalte hain. Chinta mat kijiye, is dawai ke liye hum aapko phir phone karenge." (The last sentence only when a call follows.)
6. Endings: "Bahut achha, aapne saari dawaiyan le li hain. Dhanyavaad, namaste." / "Chinta mat kijiye, baaki dawai ke liye hum thodi der mein phir phone karenge. Dhanyavaad, namaste." / when no call follows: "Dhanyavaad, namaste."

Sizes are three: bahut chhoti si, chhoti si, badi si. "Le li" is never asked for; a clear "le li" still confirms.

The sections below are the earlier drafts, kept for the other languages.

## Consent call (Hindi example, shown in Hindi and English)

> Namaste {person_name} ji. {child_name} aapko dawai ki yaad dilane ke liye phone karwana chahte hain. Agar aap haan kehna chahte hain, to "haan" boliye ya 1 dabaiye. Agar aap ye phone nahi chahte, to 9 dabaiye, phir hum kabhi phone nahi karenge.
>
> (Namaste {person_name} ji. {child_name} wants to send you medicine reminder calls. To agree, say "haan" or press 1. If you don't want these calls, press 9 and we will never call again.)

## Reminder call, first of the day (full)

> Namaste {person_name} ji, {child_name} ki taraf se dawai ka samay. Abhi {count} {dose_unit} leni hain.
> {for each medicine}: {ordinal}, {spoken_name}: {amount_text}, {appearance_phrase}, {pack_phrase}{disambiguator}. {food_phrase}. {extra_instruction}
> Dawai le lein, phir boliye "le li", ya 1 dabaiye. Dobara sunne ke liye 0. Pandrah minute baad yaad dilane ke liye 2.

## Reminder call, later in the day (short)

> {person_name} ji, {spoken_name} ka samay. {amount_text}, {food_phrase}. Le li to "le li" boliye ya 1 dabaiye.

## Building blocks

| Field | Example (hi) |
| --- | --- |
| appearance_phrase | chhoti safed gol goli, beech mein line |
| pack_phrase | laal patte se / bhoore bottle wali, orange dhakkan |
| disambiguator (number) | , 1 number wali |
| disambiguator (printed name) | , jis patte par A-M-L-O-D-A-C likha hai |
| food_phrase | nashte ke baad / khane se pehle |
| Sunday line | Nayi patti kholi ho to us par {number} likh dijiye. |

## Replies

| Reply | Keys | Phrases (hi, starting list; grow from the manual calling week) |
| --- | --- | --- |
| Confirm | 1 | le li, le liya, haan, haan le li, kha li, ho gaya |
| Snooze | 2 | baad mein, thodi der mein |
| Repeat | 0 | phir se, dobara, samajh nahi aaya |
| Doctor changed medicine | 3 | doctor ne badli |
| Stop | 9 | band karo, mat karo phone |
| Not taken (checked first) | none | nahi, nahi li, abhi nahi |

Unclear speech: ask once more, then "1 dabaiye". Never treat silence or unclear speech as confirmation.
