# WhatsApp templates (DRAFT, needs founder approval)

These are the only WhatsApp messages Tasalli sends in version 1. They go to the **child**
(the account holder), never to the parent. Both are category **Utility** (transactional,
triggered by the user's own setup), not Marketing.

The code copy lives in `packages/integrations/src/whatsapp/templates.ts`; the text there must
match this file and the text approved with the WhatsApp provider exactly. Change all three
together.

Rules the texts follow:

- Variables are filled from the family's own entries, verbatim (safety rule 1). We never add
  medical advice, a dose, or a judgement about a medicine.
- A variable never starts or ends a message, and no variable may contain a line break
  (WhatsApp rejects both).
- Hindi is in Devanagari. A native speaker should review the Hindi before submission.

No provider is connected yet (founder rule: nothing that costs money). When one is, submit
these two templates under the names below, in `en` and `hi`.

## 1. `missed_dose_alert`

Sent once per missed reminder call group, after the call and its 2 retries were not confirmed.

| Variable | Filled with | Example |
| --- | --- | --- |
| `person_name` | Nickname the child entered | Papa |
| `time` | Due time in the parent's time zone (time zone name added if it differs from the child's) | 9:00 am |
| `medicines` | "What the parent calls it" for each medicine in that call, comma separated | BP wali, Sugar wali |
| `attempts` | Number of calls placed (1 + retries) | 3 |

**English (`en`)**

> Tasalli: {{person_name}} did not confirm the {{time}} medicine reminder ({{medicines}}). We called {{attempts}} times. You may want to check on them.

**Hindi (`hi`)**

> तसल्ली: {{person_name}} ने {{time}} की दवाई की याद वाली कॉल पर पुष्टि नहीं की ({{medicines}})। हमने {{attempts}} बार कॉल किया। एक बार उनसे बात कर लीजिए।

Example (en): *Tasalli: Papa did not confirm the 9:00 am medicine reminder (BP wali, Sugar wali). We called 3 times. You may want to check on them.*

## 2. `evening_summary`

Sent once per parent per day, in the evening of the parent's local day.

| Variable | Filled with | Example |
| --- | --- | --- |
| `person_name` | Nickname the child entered | Papa |
| `date` | The parent's local date | 19 Nov |
| `confirmed` | Reminders confirmed by the parent (or marked taken by the family) | 3 |
| `total` | Reminders due that day (paused days not counted) | 4 |
| `not_confirmed` | Time and name of each one not confirmed, or "none" / "कोई नहीं" | 9:00 pm BP wali |

**English (`en`)**

> Tasalli daily summary for {{person_name}}, {{date}}: {{confirmed}} of {{total}} medicine reminders confirmed. Not confirmed: {{not_confirmed}}. Open the Tasalli app for details.

**Hindi (`hi`)**

> तसल्ली: {{person_name}} का आज का हाल, {{date}}: {{total}} में से {{confirmed}} दवाई की कॉल पर पुष्टि हुई। पुष्टि नहीं हुई: {{not_confirmed}}। पूरी जानकारी तसल्ली ऐप में देखें।

Example (en): *Tasalli daily summary for Papa, 19 Nov: 3 of 4 medicine reminders confirmed. Not confirmed: 9:00 pm BP wali. Open the Tasalli app for details.*

## Founder decisions needed

1. Approve both texts (and the Hindi after native review).
2. Opt-in wording in the app: WhatsApp requires the child to agree to receive these messages.
   Proposed: "Send me missed-dose alerts and a daily summary on WhatsApp" (checkbox, default on).
3. Evening summary time: proposed 8:30 pm in the parent's time zone, or 30 minutes after the last
   dose of the day if that is later. (Owned by the call engine scheduler.)
