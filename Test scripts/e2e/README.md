# `tools/e2e/` — End-to-end API harness

Black-box, flow-oriented regression harness for the Maal backend.
Runs every endpoint documented in [`../../docs/backend/openapi.json`](../../docs/backend/openapi.json) in the order defined by [`../../docs/backend/test-scenarios.md`](../../docs/backend/test-scenarios.md).

## Quick start

```bash
# 1. Bring up the local stack (Postgres + Redis + API)
pnpm dev

# 2. Start the worker (pnpm dev does not start it)
nx serve worker &

# 3. Set admin credentials matching the seed
export DEFAULT_ADMIN_EMAIL=admin@maal.local
export DEFAULT_ADMIN_PASSWORD='<from `pnpm db:setup` seed log>'
export BCRYPT_PEPPER=dev-bcrypt-pepper

# 4. Run
pnpm test:e2e:local
```

## Commands

| Script | Purpose |
|---|---|
| `pnpm test:e2e:local` | Run all flows against `http://localhost:3000`, default settings. |
| `pnpm test:e2e:local:verbose` | Same, with DEBUG logs on the console. |
| `pnpm test:e2e:local:ci` | Adds `--reset --fixed-phones`. Drops + reseeds DB, uses hardcoded phones. |
| `node tools/e2e/run.mjs --show-dag` | Print the flow execution order and exit. |
| `node tools/e2e/run.mjs --only F-9,F-12` | Run only specific flows. |
| `node tools/e2e/run.mjs --skip F-19` | Skip listed flows. |
| `node tools/e2e/run.mjs --help` | All flags. |

## Logs

Every run writes two files into `tools/e2e/logs/`:

- `run-<timestamp>.json` — JSONL, one structured entry per event. Every HTTP request and response (with sensitive fields redacted) lives here at `DEBUG` level. Use this when post-mortem-debugging a failure later.
- `run-<timestamp>.log` — human-readable mirror, same content. Tail this during a run.

Levels: `DEBUG | INFO | WARN | ERROR` plus semantic `STEP | PASS | FAIL | SKIP | FLOW | BLOCK`.
By default `INFO+` reaches the console; `--verbose` promotes `DEBUG`.

`tools/e2e/logs/` is git-ignored. Oldest files beyond `--max-runs` (default 20) are pruned automatically.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All flows passed, coverage ≥ threshold. |
| 1 | One or more flows FAIL, or coverage below threshold. |
| 2 | Pre-flight check failed (api or worker unreachable, env missing). |
| 3 | Harness crash. |

## File layout

```
tools/e2e/
  run.mjs                          # entry
  orchestrator.mjs                 # DAG runner
  context.mjs                      # shared state across flows
  config.mjs                       # CLI parsing, defaults
  preflight.mjs                    # health/env probes
  coverage.mjs                     # endpoint hit diff
  lib/                             # http, logger, sms-stub, totp, sse, etc.
  flows/
    blocks/                        # B-1..B-7 reusable building blocks
    f01-*.mjs … f26b-*.mjs         # one module per end-to-end flow
    standalone/s01-*.mjs           # orthogonal single-step checks
    negatives/n00-*.mjs            # authz / 401-probe / IR-3 / rate-limit
  logs/                            # git-ignored
```

## How a flow looks

```js
// tools/e2e/flows/f09-agent-cashin.mjs
export default {
  id: 'F-9',
  name: 'Agent onboarding + float top-up + cash-in',
  dependsOn: ['F-7', 'F-1', 'F-17'],
  actors: ['AD1', 'AG1', 'U1'],
  endpoints: [/* ... */],
  async run(ctx) {
    ctx.currentStep = 'onboard';
    await onboardAgent(ctx, { adminLabel: 'AD1', agentLabel: 'AG1', phone: ctx.fixtures.nextPhone('AG1') });
    // ...
  },
};
```

Failure semantics:
- A `throw` inside `run(ctx)` marks the flow `FAIL`.
- Any other flow with that flow in `dependsOn` is automatically `BLOCKED`.
- Independent flows continue.

## Adding a flow

1. Create `flows/fNN-name.mjs` exporting `{ id, name, dependsOn, actors, endpoints, run(ctx) }`.
2. Import it in `flows/_registry.mjs` and add to the returned list.
3. Use `ctx.http`, `ctx.actors`, `ctx.fixtures`, `ctx.assert`, `ctx.sms`, `ctx.log` — never instantiate your own clients.
4. Use `ctx.currentStep = '<short-name>'` before each logical step. Log lines and assertions auto-prefix with the step name.

## Idempotency

Endpoints requiring `Idempotency-Key` (cash-in, transfers, BNPL accept, etc.) get an auto-generated UUID per request by default. Pass `{ idempotencyKey: '<uuid>' }` to control it, or `{ idempotencyKey: false }` to omit it entirely — required to test the "missing header" negative.

## Stub SMS

The API is configured with `SMS_PROVIDER=stub`. OTPs land in `./sms.log` (JSONL). The harness's `ctx.sms` keeps a byte-offset cursor per phone number, so concurrent OTPs in a fan-out (e.g. F-24 broadcast) don't collide.

## Admin MFA

F-7 walks the real `/admin/auth/login → mfa/enroll → mfa/verify → password/change` sequence using `otplib`. The TOTP secret is cached on `ctx.actors.AD1.mfaSecret` for B-5 (returning login) reused by every subsequent admin flow.

`--admin-fast-token` skips F-7 and uses the HMAC token from `scripts/dev.sh admin-token`. The shortcut bypasses session rows and is only for debugging — F-7 always runs by default.

## Coverage report

After every run the harness diffs `ctx.hits[]` against `openapi.json` and prints `HIT / MISS` counts. Threshold defaults to 90 % — bump via `--coverage-threshold 95`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Pre-flight FAILED` | API not running. Run `pnpm dev`. |
| All OTP steps hang | Worker not running. Run `nx serve worker`. |
| F-7 fails immediately | `DEFAULT_ADMIN_PASSWORD` not set or doesn't match the seed. Run `pnpm db:setup` with the same value, or `--admin-fast-token`. |
| Re-run hits `PHONE_EXISTS` | Default behaviour namespaces phones by run-id. If you used `--fixed-phones`, follow with `--reset`. |
| `Coverage X% below threshold` | A new endpoint was added without a flow covering it — extend `flows/` or lower `--coverage-threshold`. |
| Many flows FAIL on a fresh run | Real backend bugs surfaced by the harness. Don't soften `allowStatus` to suppress them — file as separate bug tickets. After tightening (2026-05-11), the harness intentionally fails on 500s and unjustified 4xx instead of swallowing them. |

## Coverage semantics (changed 2026-05-11)

Coverage now counts an endpoint as covered only when it has been hit with `status < 400` by an **authenticated** actor (or when a public endpoint returns 2xx for any caller). N-0's unauthenticated 401/403 probes no longer inflate the metric — they are reported separately as "security probe hits".

Realistic coverage on a fresh stack with the audited backend bugs unresolved is ~80–85 %. Once the backend bugs are fixed, the number climbs back toward 100 %. Set `--coverage-threshold 0` to disable the gate during remediation.

## Known backend bugs surfaced by the audit (2026-05-11)

The harness now FAILs (instead of WARNing) on these. None are harness bugs:

1. `POST /admin/accountants` → 500 (cascades to F-8, N-5, N-6)
2. `GET /admin/disputes` → 500
3. `GET /admin/dashboard/alerts` → 500
4. `POST /me/agent/commissions/export` → 500
5. `GET /disputes/{unknown}` → 500 instead of 404
6. `POST /transfers` same idempotency-key + different body → 2xx (should be 409)
7. `POST /admin/agents/{id}/float-topup` on SUSPENDED agent → 200 (should 409)
8. `POST /admin/users/{id}/freeze` without `mfaCode` → 400 (should 401 MFA_REQUIRED)
9. `POST /admin/audit-logs/export` → 403 for ADMIN role (RBAC over-restriction)
10. `POST /internal/events` rejects benign payload with `400`
11. Frozen-user `POST /transfers` → 422 INSUFFICIENT_BALANCE instead of 403 ACCOUNT_FROZEN (guard ordering)
