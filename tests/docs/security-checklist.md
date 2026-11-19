# Security checklist

| Check | Expected | Automated? |
| --- | --- | --- |
| OTP abuse: >N requests per number/hour; wrong-code attempts | rate limited, code locks after few tries, generic errors | follow-up |
| OTP code reuse / expiry | rejected | follow-up |
| Cross-family access: family A token reads/edits family B person, medicine, call log | 403/404 | follow-up |
| Unsigned / wrongly signed provider webhook (Exotel, Plivo, Twilio, Razorpay, MSG91) | rejected, no state change | follow-up |
| Replayed webhook | no second call or confirmation | scenarios/idempotency.ts |
| Phone numbers in logs | masked except last 4 | scenarios/privacy.ts |
| Secrets in repo | none; run `git grep -nE '(sk_|AKIA|BEGIN PRIVATE|auth_token)'` | manual |
| Data deletion on request | person data removed | follow-up |
| Health data region | Mumbai only | devops review |
