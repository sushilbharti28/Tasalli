# Version 1 scope

Pilot target: 50 paying families and one NGO. Launch week of 18 January 2027; go/no-go around 21 February 2027.

## In version 1

1. **Child app (Android):** OTP sign-in, Indian and international numbers. App text in Hindi and English.
2. **Add a person:** yourself (no consent call, OTP-verified number) or a parent. Nickname, full name, number, call language (hi, en, bn, mr, ta, te), time zone, "can they read the name printed on a strip?".
3. **Consent call:** names the child. Parent says "haan" or presses 1 to agree; presses 9 to never be called again. Nothing is scheduled before consent. Unanswered consent calls retry twice.
4. **Add a medicine, step by step:** kind first (tablet, capsule, syrup, something else), then name (autocomplete filtered by kind) + strength + what the parent calls it, then appearance, then how it's kept, then amount and times, then a check screen with a play preview.
5. **Look-alike check:** appearance fields only. If pack or print colour differs, resolved automatically (the call mentions it). Otherwise recommend a number on the strip (parent can't read English) or saying the printed name (parent can read).
6. **Reminder calls:** parent's time zone; doses within 30 minutes grouped; full description on the first call of the day, short afterwards; confirm by phrase or key 1; 2 snooze once (15 min); 0 repeat; 3 doctor changed medicine; 9 stop all calls. Sunday line reminding to number new strips where numbers are used.
7. **Retries and alerts:** 2 retries, 10 minutes apart, then missed. Missed-dose alert by push and WhatsApp. One evening summary.
8. **Today, history, manual "mark as taken", test call to your own phone.**
9. **Plans:** 7-day trial (1 person, 3 calls a day), then ₹299 one parent / ₹499 two parents / ₹4,999 family yearly via Razorpay UPI autopay.
10. **Admin console (founder only):** families, consent and call logs, block list, pause, support notes, pilot metrics.
11. **Safety rails:** see CLAUDE.md.

## Not in version 1

iOS app, helper web link, parent app, drops / inhaler / injection / cream flows (designed), prescription reading, refill tracking, hospital and NGO dashboards, pill box.

## Pilot success criteria

| Measure | Target |
| --- | --- |
| Families who finish setup | 60% or more |
| Doses confirmed by the parent | 80% or more |
| Trial users who pay | 20% or more |
| Paying families still paying in month 3 | 60% or more |
| Calls that fail for technical reasons | Under 2% |
| Calls with wrong medicine details or wrong time | Zero |
