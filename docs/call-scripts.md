# Call scripts (DRAFT, needs native-speaker and doctor review)

Scripts are templates in `packages/scripts/<language>.yaml`. Variables in `{curly}` come from the family's own entries and are spoken verbatim. The call never adds medical advice.

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
