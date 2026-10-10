# 0065. A page that names no app is catalogued under its web origin

Date: 2026-10-10

Implements README section 3.4 tier 2 on the shell side and closes two findings of the
page-operation-via-webmcp full council round 1 (robustness-1, robustness-3) and its two
must-addresses (a page that registers no tools gives a character nothing to act with; the tier-2
hands are reachable from no character). Builds on ADR 0063 (a page is gated on first sight) and
ADR 0025 (the screenshot is a hand).

## Context

The shell keyed a tab by the `athena:app` slug the page published, and a tab that published none
had no key at all. Three things followed. `manifestBodyOf` returned `null`, so the page was never
registered and the nine hands (`hands_list`, `hands_call`, both granted and registered) had no
caller. `gatedListsOf` and `disabledOriginsOf` skipped the tab, so a null-app page was neither
first sight nor switchable off (robustness-1). And `gatedListsOf` read the catalog-form row
`host:<app>` from the page's own claim, so a page at an unregistered origin inherited another
app's trust by publishing its slug (robustness-3: an enabled `host:ledger` row and a lone tab at
`https://evil.test` claiming `ledger` left first sight empty).

## Decision

**One function gives a tab's catalog id** (`catalogIdOf` in `lib/manifest.ts`), and every place the
shell keys a tab uses it: the manifest, `focused().appId` and the foreign-origin check in both
loops, `gatedListsOf`, `disabledOriginsOf`, and the companion's tool rows.

**The id is the published `athena:app`, else one derived from the web origin.** The derived form
is `web_<scheme>_s<host>[_c<port>]`, with `.` written `_d`, a literal `_` written `_u`, and any
other character outside `a-z0-9-` written `_x<hex>_`. `https://ledger.test` is
`web_https_sledger_dtest`; `http://localhost:3000` is `web_http_slocalhost_c3000`. It is a slug
`HostManifest.validate` accepts, and it is injective, because `_` only ever begins an escape.

**A page cannot claim it.** The prefix `web_` is reserved: a published `athena:app` that starts
with it is treated as no id at all, and the page is catalogued under its own origin. A page can
therefore never publish its way into another origin's derived id. (A real app whose slug begins
`web_` must pick another; that is the price of a form nothing else can spell.)

**Robustness-3 rule.** A catalog-form row (`host:<app>`) applies to a tab only when that app is the
tab's own derived id; a row keyed by the tab's web origin always applies. A page cannot inherit a
row by claiming a slug. A published app is therefore first sight until its web origin has a row.
Pins in catalog-form rows are still sent whole, since a pin only tightens.

**Robustness-1.** A tab with no published app is keyed by its derived id in both lists. A switched
off web origin also switches off its derived id, with or without a tab open, because the id is
spelled from the origin alone.

**The hands are published for every tab with an origin.** The shell fetches `hands_list` once at
start (it is static). The manifest is the page's tools followed by the hands, for a page that
registered none, published no app, or could not be read. A manifest is offered only for an origin
the daemon would accept (`https`, or `http://localhost`). Outside the shell the list is empty and
nothing changes.

**A tool named like a hand keeps the page's tool.** The hand with that name is not appended, and a
call to that name goes to the page through `bridge_call`. Any other hand name the page did not
register goes to `hands_call`, in the run loop and the voice loop alike, and its result is recorded
at tier 2.

**A gated hand's card has no screenshot yet.** ADR 0025's panel half (a capture before every gated
proposal, on tier-1 cards too) is part 2. Until then a card for a hand, like one for a page tool,
carries no picture. The catalog still stamps hands tier 1 in its own listing; the shell's result
rows say tier 2, and the panel shows neither yet.

## Consequences

- Every page the user opens has something to act with, gated on first sight by ADR 0063.
- A page's trust follows its web origin, not its claim. Trusting a page by a catalog-form row is
  only possible for a derived id.
- A published app id is unchanged for a page whose origin has a row; its manifest, pins and
  switches keep their keys.
- A fourth key form exists in `origins` rows (`host:web_...`); `disabledOriginsOf` writes it.
