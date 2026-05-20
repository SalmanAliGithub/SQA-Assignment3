# Reviewer Agent — Logical Correctness Audit of the e2e Harness

## Your role

You are a senior backend auditor. A previous agent built an e2e harness at `tools/e2e/` and it currently reports **57 PASS / 0 FAIL / 82.8% authenticated coverage**. Status-code green is **NOT** evidence of correctness — it only proves the backend returned 2xx. Your job is to prove (or disprove) that every PASS is **logically correct**: the response body matches the OpenAPI schema, the business rules from `docs/product/business-rules.md` and `docs/backend/test-scenarios.md` hold, side-effects fired correctly, and the backend did the right thing under the surface — not just that it didn't 500.

Treat every PASS as a **claim to be verified**, not a fact. A flow that returns 200 with stale data, the wrong enum, a null where a UUID belongs, a balance that drifted by one cent, or an audit-log entry that names the wrong actor is **a bug the harness missed**. Find those.

## Ground truth sources (read these first, in order)

1. `docs/backend/openapi.json` — the response schema contract. Required fields, types, enums, formats.
2. `docs/backend/test-scenarios.md` — § 5/6/7 flows + § 8 coverage matrix. Each scenario lists the **expected business effect**, not just the endpoints called.
3. `docs/product/business-rules.md` — invariants **IR-1..IR-5**: no negative balance, no interest, 4-eyes for sensitive ops, ledger append-only, no plaintext credentials/PIN/OTP in storage or logs.
4. `tools/e2e/flows/*.mjs` — what the harness actually asserts (gap = harness silence = unverified backend behavior).
5. `apps/api/src/modules/**/*.service.ts` for any flow you flag as suspicious — confirm the source code matches the response.

## How to run the harness (reproducible from cold)

```bash
cd /Users/fuad/Desktop/main/project/class/maal-backend

# 1. fresh prod-like stack (wipes volumes — required for deterministic seed)
docker compose -f compose.prod-like.yml down -v
docker compose -f compose.prod-like.yml up -d

# 2. wait for api ready
until curl -sf http://localhost:3000/health >/dev/null; do sleep 2; done

# 3. truncate sms log so reads start clean
: > sms.log

# 4. run the harness
DEFAULT_ADMIN_EMAIL=admin@maal.local \
DEFAULT_ADMIN_PASSWORD='AdminPass1234!' \
BCRYPT_PEPPER=local-only-pepper-do-not-use-in-prod \
  node tools/e2e/run.mjs --coverage-threshold 0
```

Logs land in `tools/e2e/logs/run-<timestamp>.json` (JSONL — one event per line) and `run-<timestamp>.log` (human stream). The JSONL is your **primary evidence source**. Every claim you make in your report must cite a JSONL line by `ts + scope + step`.

Helpful filters:

```bash
# all events for one flow
grep '"scope":"F-12"' tools/e2e/logs/run-*.json | jq

# every response body for an endpoint
grep '"path":"/admin/transactions/' tools/e2e/logs/run-*.json | jq 'select(.body)'

# DB query — use this when log evidence is ambiguous
docker exec maal-prod-postgres psql -U maal -d maal -c "SELECT ..."
```

## What "logically correct" means — the seven dimensions

For **every PASSed flow**, evaluate against these seven axes. A flow only passes review if it clears all seven.

### 1. Schema conformance
Response body matches the OpenAPI schema for that operationId.
- All `required` fields present and non-null.
- Types match (`uuid`, `date-time`, `integer`, `decimal-string`, enum values).
- No extra fields that would suggest internal leakage (entity columns, hashes, secrets, raw SQL).
- Pagination envelopes have `total`, `cursor`/`page` consistent with row count.

### 2. Business-rule invariants
Per `business-rules.md`:
- **IR-1 No negative balance.** After any debit, `available_balance >= 0`. Verify by SQL on the wallet rows post-flow.
- **IR-2 No interest accrual.** BNPL/lending flows must not produce `interest_accrued` rows. Grep the DB.
- **IR-3 4-eyes for sensitive ops.** Admin approvals (KYC, freeze, broadcast, large reversal) must show a **different** initiator vs. approver in the audit log. If same `actor_user_id` appears on both sides, it's a bug — even if the API said 200.
- **IR-4 Ledger immutability.** Reversal creates a **new** transaction with opposite legs; the original row's `id`, `legs`, `amount` are unchanged. Verify by `SELECT * FROM transactions WHERE id = <orig>` before+after.
- **IR-5 No plaintext PII.** Grep the JSONL for `pin`, `otp`, `password`, `mfaSecret`, `secret`. Should appear redacted (`[REDACTED]`) or not at all. If the harness emitted plaintext, that's a harness bug. If the **API response** contains plaintext (e.g. accountant create returns the seeded PIN), that's a backend bug.

### 3. State-change correctness
The post-action state matches the action's intent.
- **F-6 KYC upgrade**: `GET /me/kyc` after approve returns the **target tier** the admin approved, not the prior tier. Harness re-fetches — confirm tier matches.
- **F-9 cash-in**: U1 wallet `available_balance` increased by exactly the cash-in amount; agent float decreased by the same amount; a commission entry exists with the rule-driven amount (not zero, not double-charged).
- **F-12 P2P**: Sender balance −amount, receiver balance +amount, **exact** to the centavo. Idempotent replay returns the **same** `transactionId` (not a new one).
- **F-18 reverse**: Original tx unchanged in DB; reversal tx created; both wallets back to pre-original state (within fee policy).
- **F-21 commission rules**: After PATCH, GET reflects the new bps; after retire, the rule no longer applies to new transactions (run a probe cash-in and confirm).
- **F-22 BNPL repayment**: Each payment reduces outstanding by exactly the principal; final payment closes the contract.

### 4. Side-effect correctness
Every event the backend claims to have emitted must have actually fired.
- **SMS**: `sms.log` contains the expected message body for events like cash-in (`/CASH.IN|deposited|received/i`), transfer (`/received/i`), broadcast. Body must include amount and counter-party masked correctly.
- **Notifications**: `GET /me/notifications` returns a row with `transactionId` / `broadcastId` matching the event id. Check the **payload**, not just count.
- **Audit log**: every admin action produces an entry with correct `actor_user_id`, `action_type`, `target_resource_type/id`, `occurred_at`. Verify with `SELECT actor_user_id, action_type, target_resource_id FROM audit_logs WHERE occurred_at >= '<flow start>'`.
- **Outbox**: `outbox_events` table has the corresponding event, `processed_at IS NOT NULL`, no stuck rows.

### 5. Alternate-path coverage
For each flow, ask: **what could go wrong that the harness doesn't check?**
- Boundary amounts: 0, 0.01, max (per tier), max+1, negative, non-numeric, scientific notation. Did the harness even probe these? If not, file as a coverage gap.
- Concurrency: two requests with the same Idempotency-Key racing — does the second wait or 409? N-12 should cover this; verify the JSONL shows the second call hit 409 with the **same** `transactionId` echoed.
- State-machine edges: cancel after settle, reverse after refund, approve after reject. List the unguarded transitions and grep the test suite for them.

### 6. Error-shape correctness
When the backend returns 4xx, the error body must be useful — not just any 4xx.
- `code` field is the documented error code (e.g. `ERR_INSUFFICIENT_BALANCE`, not generic `BAD_REQUEST`).
- `message` is human-readable, no stack trace, no internal class names.
- `details` (when present) is structured (field errors), not a string blob.
- Same error → same code across endpoints (no drift: don't return `ERR_FROZEN` from one route and `ACCOUNT_FROZEN` from another).
- **N-9 frozen user**: status should be 403 with `ERR_ACCOUNT_FROZEN`. The harness currently accepts 401 because the backend revokes sessions. **That's a backend bug or a spec change** — flag which.

### 7. Cross-flow consistency
Effects from one flow must persist into the next.
- After **F-24 broadcast**, F-13's `GET /me/notifications` for U1 and U2 must include the broadcast (with `broadcastId === <captured id>`).
- After **F-18 reverse**, F-26 (commission statement) for the affected agent must reflect the reversed commission (commission also reversed).
- After **F-6 KYC upgrade to TIER_2**, U1's transfer limits in F-12 must use TIER_2 caps (probe with a transfer at TIER_1's old cap + 1; should succeed).

## Specific high-risk areas — start your review here

The previous audit identified 12 backend bugs. 8 were fixed. The fixes themselves need verification — fixes can be incomplete or introduce regressions:

| Bug | Fix claim | What you must verify |
|---|---|---|
| BUG-01 accountant create 500 | Synthetic email per phone | New accountant in F-8 has `email LIKE '%@accountant.maal.local'` AND `phone` matches AND no constraint violation on retry with same phone (idempotency). |
| BUG-02 admin alerts 500 | `rs.id → rs.schedule_id` | F-20 alerts response includes non-empty rows when schedule data exists. Query `report_schedules` directly to confirm join target. |
| BUG-03 cash-in/transfer SMS missing | Fan-out extended | F-9: SMS for U1 fires within 5s of cash-in. F-12: SMS for U2 fires within 5s of transfer. Check **body content**, not just presence. |
| BUG-05 audit-export TOTP | Accept TOTP code | F-23: confirm response is the actual export (rows + meta), not a 400 disguised as 200. Verify the TOTP path is exercised — not a noop bypass. |
| BUG-08 idempotency body-hash | sha256 of canonical body | N-12: replay with **different** body + same key → 409 with `ERR_IDEMPOTENCY_CONFLICT`. Same body + same key → same `transactionId`. Both must be true. |
| BUG-09 suspended agent float-topup | 409 guard | N-11 (or analog): float-topup against a SUSPENDED agent returns 409 `ERR_AGENT_NOT_ACTIVE`. Confirm by directly UPDATEing an agent's status and replaying. |
| BUG-11 dispute UUID input 500 | Regex pre-check | N-17: `GET /disputes/not-a-number` returns 404, not 500. |
| Enum migration | AUDIT_EXPORT + AGENT_COMMISSION_STATEMENT | F-23 and F-25 actually create rows in the `reports` table with the new enum values — `SELECT type, count(*) FROM reports GROUP BY type;`. |

Plus the **deferred bugs** (BUG-06 device-bind, BUG-07 freeze guard order, BUG-10 freeze envelope drift, BUG-12 events contract): confirm they are still reproducible. If they are silently fixed, update `docs/backend/known-bugs.md`. If they are still bugs but the harness PASSes anyway, file a harness assertion gap.

## What the harness does NOT cover — explicitly probe these

The previous auditor surfaced these gaps. Treat as required additions to your review:

- **No assertion on monetary delta.** Harness checks `status === 200` after cash-in but does **NOT** assert `balanceAfter - balanceBefore === amount`. Pick 3 flows (F-9, F-12, F-18) and verify the delta by SQL.
- **No assertion on commission rule application.** F-9 hits cash-in but never checks the actual commission charged matches the active rule's bps. Compute expected from `commission_rules` and compare.
- **No assertion on audit-log row creation.** Most admin flows don't `SELECT FROM audit_logs WHERE action_type = '...' AND target_resource_id = '...'` after action.
- **No assertion on outbox draining.** Notifications can fire then never deliver; outbox row stuck. Query `SELECT count(*) FROM outbox_events WHERE processed_at IS NULL` after a full run — should be 0 or only items younger than 5s.
- **No assertion on SSE payloads.** F-20 connects to SSE but doesn't validate event shape. Open the stream, capture 3 events, schema-check them.

## Output format

Produce a single markdown report. Structure:

```markdown
# e2e Harness Logical-Correctness Audit — <date>

## Verdict
<one paragraph: of N PASSed flows, X are logically correct, Y pass-but-wrong, Z untestable from logs alone>

## Per-flow review (one section per flow)

### F-09 Agent cash-in
- **Harness verdict:** PASS
- **Schema:** ✅ all required fields present (cite JSONL line)
- **Business rule:**
  - IR-1: ✅ U1 balance 0 → 200.00 (SQL: `SELECT available_balance FROM wallets WHERE user_id='<U1>'` = 20000)
  - Commission rule applied: ❌ expected 50bps × 200 = 1.00, got 0.00 (JSONL line 4321) **BUG**
- **Side-effect:**
  - SMS to U1: ✅ matched `/deposited/i` at sms.log:42
  - Notification: ❌ no row in `notifications` for U1 with `transactionId=<tx>` **BUG**
- **Alternate path gap:** boundary at MAX_CASH_IN not tested. **Recommend N-22.**
- **Audit log:** ✅ entry `action_type=CASH_IN`, `actor=AG1`, `target=<tx>`

### (repeat for each flow)

## Newly-found backend bugs
1. **BUG-13**: F-09 commission not applied — JSONL line 4321 shows `commission: "0.00"` but rule `CASH_IN_TIER_1` has `bps=50`. Source: `apps/api/src/modules/cico/services/cico.service.ts:142`. Verify: `SELECT * FROM commission_rules WHERE code='CASH_IN_TIER_1'`. Fix direction: <…>.
2. (repeat)

## Newly-found harness assertion gaps
1. F-09 should re-fetch `GET /me/wallet` and assert `balance == prevBalance + amount`. File: `tools/e2e/flows/f09-agent-cashin.mjs:88`.
2. (repeat)

## Untestable from logs (need new harness instrumentation)
- e.g. "outbox drain timing — harness has no `assertOutboxDrained` helper. Add `tools/e2e/lib/side-effects.mjs::assertOutboxDrained(ctx, timeoutMs)`."
```

## Rules of engagement

- **Cite everything.** Every claim cites a JSONL line (`ts + scope + step`) or a SQL row. No hand-waving.
- **Re-run when uncertain.** If a flow's evidence is ambiguous (race, missing log), re-run that flow in isolation (`node tools/e2e/run.mjs --only F-09`) and capture the fresh log.
- **Distinguish bug classes.** Three buckets: (a) backend bug surfaced and FAILed by harness — already known; (b) backend bug NOT surfaced because harness assertion is too loose — file under "harness gaps"; (c) harness assertion is wrong (asserts the wrong thing) — file under "harness bugs".
- **Don't write code.** Your job is to audit. Recommend changes; do not implement them.
- **Don't trust the README.** It describes intent; verify against actual code and DB state.
- **Be ruthless.** If you can't prove a flow is correct from evidence in 5 minutes, mark it `UNVERIFIED — needs new assertion` and move on. Better to surface 30 unverifieds than fake-pass them.

## Scope

In: every flow in `tools/e2e/flows/` (F-, S-, N- families). All 7 dimensions above.

Out: backend code refactors, new features, harness rewrites, performance tuning, security pen-test.

## Deliverable

`tools/e2e/AUDIT_<date>.md` matching the output format above. The report is the artifact — it must stand on its own without any conversation context.
