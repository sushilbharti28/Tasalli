# PR review checklist (QA)

1. Fetch branch, run the package tests and lint. Record the result.
2. Tests exist and touch every safety rule the PR touches.
3. Safety rules (CLAUDE.md):
   - Dose never computed or suggested; text repeats family entry verbatim.
   - Look-alike check compares appearance fields only, never composition.
   - No schedule/call unless person is `consented`; key 9 or stop phrase blocks the number across accounts.
   - Speech checks negatives first; unclear is not a confirmation; keypad fallback.
   - Caps: 6 calls/number/day across accounts, 4 people/account.
   - Webhooks idempotent (dedupe key); signature verified before processing.
   - Times stored in parent's zone, converted at the edges.
   - No secrets in repo; env var names only; phone numbers masked (last 4).
   - Health data in India region; delete on request.
4. Contracts untouched unless the PR is a contracts PR.
5. Comment with verdict, test result, findings with file:line. Never merge.
