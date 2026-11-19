# Quality gates

Nothing reaches a real parent until every gate passes on staging.

| Gate | What must be true | Checked by |
| --- | --- | --- |
| Right call, right time | Every dose rings at the parent's local time, including for a child abroad; no call before consent or after key 9 | Automated tests, QA |
| Never twice | A repeated provider webhook never creates a second call or confirmation | Automated tests |
| Words match the data | The spoken script matches the family's entries verbatim, in all 6 languages | Script tests, native speaker per language |
| "Nahi li" is never a yes | Negative phrases never count as confirmation; unclear speech falls back to the keypad | Speech test set |
| Speech accuracy | 90%+ of confirm phrases recognised on phone-quality audio | Speech test set, 20+ speakers |
| Real networks | Jio, Airtel, Vi, BSNL, a keypad phone and a landline, in a small town | Founder, real phones |
| Caps and opt-out | Max ~6 calls a number a day; key 9 blocks across all accounts at once | Automated tests |
| Retries and alerts | 2 retries, then missed, then exactly one alert | Automated tests |
| Privacy | No cross-family data access; unsigned webhooks rejected; no secrets in repo; phone numbers masked in logs | QA security review |
| Load | 10,000 calls a day through the scheduler without delay | Load test |
| Payments | Trial, UPI autopay, failed payment, cancel | Integration tests, founder test payment |
| Store ready | Passes Play pre-launch checks; no medical claims | Founder, devops |
