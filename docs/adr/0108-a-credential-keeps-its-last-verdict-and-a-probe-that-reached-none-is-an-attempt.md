# 0108. A credential keeps its last verdict, and a probe that reached none is an attempt

Date: 2026-10-15

Amends the health paragraph of [0021](0021-connectors-are-data-behind-one-vault-and-enter-the-catalog-like-a-page.md)
(README section 4, "Health is three-valued") and moves where the account-switch sentence of
[0062](0062-the-switches-belong-to-the-account-they-were-set-under.md) is kept.

## Context

README section 4 says health is three-valued (`healthy`, `broken`, `unknown`). In the vault it was
two-valued and written by one door only:

- `Vault.probe` sent the sealed access token as it was, without refreshing it. A Gmail grant idle
  for an hour answered 401 and was painted broken, although its refresh token was fine.
- Every `VaultError` the probe met became `broken`: the provider not reached
  (`UrllibTransport`), a 429 and a 503 (any status of 300 or more raised).
- A 401 during a real call flipped the status to `needs_reauth` and left `health` at `healthy`;
  a refresh that failed this time (a 503 from the token endpoint, a timeout) wrote nothing, so the
  Accounts surface said connected and fine while every call failed.
- `health_detail` also carried ADR 0062's "writes are off, the list was emptied" sentence, and the
  first successful "Check now" erased it.

## Decision

1. **Two facts, stored as two.** A *verdict* is the provider's word on the credential: `healthy`
   (the probe was answered 2xx, or the token endpoint gave a token) or `broken` (it refused, or the
   grant is gone). An *attempt* is a check that reached no verdict: the provider not reached, a
   429 or an OAuth 403 naming a quota, a 5xx or 3xx, a refresh that failed this time. The record
   gains `attempt_at` and `attempt_detail`. Only a verdict writes `health`, `health_at` and
   `health_detail`; the next verdict clears the attempt. Health stays three-valued; an attempt is
   never a fourth value.
2. **One classifier.** `connectors/health.py` holds `classify(status, body, exc)` and `record`.
   It imports nothing from the vault: an exception class says whether meeting it is a verdict
   (`NeedsReauth.verdict`) and whether its sentence already names the obstacle
   (`RefreshFailed.worded`, `RateLimited.worded`); any other is the provider not reached.
   `is_quota_refusal` and `refresh_is_terminal` move there with their reason sets; the vault
   imports them.
3. **Every door writes through it.** The probe records a verdict or an attempt. A brokered call
   answered 401 (or a 403 that is not a quota) is `needs_reauth` and a broken verdict with its
   time. A refresh records a healthy verdict when it gets a token, a broken one with
   `needs_reauth` on a terminal answer, and an attempt on anything transient; all under the lock
   and onto the same generation only, as before.
4. **The probe refreshes a stale OAuth token first, by its own path.** It does not go through
   `_fresh_token`, which refuses a record that is switched off or needs reconnecting. Under the
   connector's refresh guard, after its own disconnected check, it calls `_refresh` with
   `live_only=False`, which commits onto a `connected` or `needs_reauth` record of the same
   generation. A probe whose token the provider accepts still returns a `needs_reauth` record to
   connected, switched off or not.
5. **The 0062 sentence is a notice.** `_admit` writes it to `notice`, not `health_detail`. A probe
   never touches it; the next connect replaces it and a disconnect clears it.
6. **The desktop reads both.** `standingOf` shows a healthy verdict with a newer attempt as
   connected, tone warning: "Verified 3 h ago; could not check since 5 min ago: <obstacle>". It
   never says broken for an attempt. The row's note is the record's `notice`.

Not taken: an `unreachable` health value. It would put "could not verify" in the field that means
"verified", so a surface or policy reading `health` alone would have to know which values are
verdicts. Two fields keep the verdict's age honest: "verified 3 h ago" stays true while the
provider is down.

## Consequences

- An offline laptop or a Google 503 no longer paints Gmail red; an expired-but-refreshable grant no
  longer looks broken after "Check now"; a grant lost mid-turn is visible with its time; the
  account-switch sentence survives a probe.
- A successful refresh now writes a healthy verdict (it is the token endpoint accepting the grant),
  so it also clears an attempt left by an earlier failed refresh.
- The record's three new fields are additive. An older build's loader keeps only the names it
  knows, so it reads a newer `connections.json` unchanged; a newer build reads an older file with
  the fields empty. The desktop's `ConnectionView` takes them as optional.
- A test that read the 0062 sentence from `health_detail` reads it from `notice`.

Tests: `tests/connectors/test_health.py` (one test per case, and the guard that a parked record
whose token is accepted reads healthy), `apps/desktop/src/modules/connectors/model.test.ts`.
