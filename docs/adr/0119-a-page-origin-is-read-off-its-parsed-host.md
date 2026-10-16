# 0119. A page origin is read off its parsed host: https with a host, or http on localhost

Date: 2026-10-16

Amends [0065](0065-a-page-that-names-no-app-is-catalogued-under-its-web-origin.md), whose
parenthetical "an origin the daemon would accept (`https`, or `http://localhost`)" described a
prefix test.

## Context

`HostManifest.validate` admitted a page's `page_origin` when the string started with `https://`
or with `http://localhost`, and the desktop's `registrable` (`apps/desktop/src/lib/manifest.ts`)
copied the same two prefixes to decide which tabs it offers a manifest for. A prefix of the
string is not a host. It admitted `http://localhost.evil.example` and `http://localhostile.net`
(remote pages over plain http, which a network attacker can rewrite in transit, the one class
the rule exists to refuse), `https://` with no host at all, and `http://localhost:99999`, which
no browser can open. It refused `http://127.0.0.1:3001`, the same machine as
`http://localhost:3001` under its other spelling; this record keeps that refusal.

## Decision

1. **Parse, then judge the host.** A page may register when its origin parses, its port (if any)
   is a port, and it is `https` with a non-empty host, or `http` whose host is exactly one of
   `LOOPBACK_PAGE_HOSTS`: `localhost` alone. `page_origin_admitted` in
   `src/athena/contracts/manifest.py` is the rule; `HostManifest.validate` applies it.
2. **Only `localhost`; `127.0.0.1` and `[::1]` stay refused.** This record tightens the rule and
   widens nothing: `127.0.0.1` was refused before it, and admitting it would let one more origin
   register tools, which is the owner's call, not a sweep's. It reaches the same local server and
   the shell already allows both spellings for its own UI (`daemon.rs`), so the case for it is
   real; adding it, or IPv6 loopback, is one entry on each side and one row moved in the table.
3. **One table, both sides.** `LOOPBACK_PAGE_HOSTS` is spelled in `manifest.py` and
   `manifest.ts`, and `tests/contracts/test_manifest.py` holds the TypeScript list to the Python
   one. The accept/refuse table (`PAGE_ORIGINS_ADMITTED`, `PAGE_ORIGINS_REFUSED`) lives in that
   contract test, and `apps/desktop/src/lib/manifest.test.ts` reads the two tuples out of it and
   holds `registrable` to every row, so the shell never offers what the daemon refuses.

## Consequences

- A remote plain-http page whose host merely begins with `localhost` can no longer register
  tools or pin an app. No manifest in `examples/` or the tests was refused by the change; they
  are served on `http://localhost:300x` or `https://<host>`.
- A page served on `http://127.0.0.1:<port>` is still refused, as before, and the table says so
  in a row of its own.
- A browser hands the shell normalised origins, so the two parsers (Python's `urlsplit`, the
  browser's `URL`) only meet strings they agree on. A hand-typed non-normal spelling such as
  `http://127.1` is refused by the daemon even where the browser would normalise it.
