# 0067. One snapshot of the focused tab per exchange

Date: 2026-10-11

Implements README section 3.3 (a page's tools enter the catalog through a manifest, and the gate
tightens first-sight apps and pins) and section 3.5 (a released call runs where the gate classified
it). Part 3 of the page-operation-via-webmcp rework after ADRs 0063, 0065 and 0066, closing the
round-2 council's robustness-1 and robustness-5.

## Context

ADR 0063 put the first-sight and pinned lists on every request, and ADR 0065 keyed a tab with no
app id by its derived `web_...` id. Both read the live `useTools` store, and they read it at
different moments. `exchange()` published the manifest once; `consume()` then awaited the capture
(up to 8 seconds) and read `gated()` afterwards, and every continuation read it again. A refresh of
the tab's tool list lands in that window, and a hostile page can start refreshes at will: `tools.ts`
writes a blank entry with `appId: null` at the start of each one. The manifest then named the app
`ledger` while `gated_origins` named `host:web_https_sx_dtest`, so the daemon's session ran under an
app the request had not named as first sight, and a page's own tool flagged AUTO ran with no card.
The reverse order (an unread tab at publish, its list there by the request) left the AUTO hands
running with no first-sight card. Routing had the same shape: a released call was sent to the hand
or to the page by the tab's list at call time, not the list the gate classified, so a page could
swap the executor of a call the gate had allowed (robustness-5).

## Decision

**The exchange reads the tab once.** `stores/run.ts` exports `Snapshot` and `snapshotOf(origins,
tabs, byTab)`: the focused tab's id, origin and catalog id, the manifest body, `disabled_origins`,
`gated_origins`, `gated_tools`, and the tool list the manifest was built from. A new typed message
(`send`), a card's answer (which republishes), a voice `press` and a voice `say` each take one
snapshot, and everything that exchange sends or routes comes from it: the manifest, the lists on the
first request and on every continuation, and the routing of the calls it releases. `tools.ts` is
untouched and `gatedListsOf` keeps its fail-closed rule exactly.

**Routing is by the snapshot's list.** `RunDeps.call` and `VoiceDeps.call` take the snapshot's tools
as a fourth argument and `callOnPage` routes by them. They apply only when the call lands on the tab
the snapshot was taken of; another tab was never classified and is read live.

**Voice frames.** Only `start` and `text` carry the lists, so those are the only voice frames that
read the snapshot; a `tool_result` frame carries none, and the snapshot stays until the next press
or utterance.

**A surface may omit `snapshot`.** The loops then read `focused`, `manifest`, `disabledOrigins` and
`gated` once, at the start of the exchange. The shell wires `snapshot`.

## Consequences

- The manifest's app and `gated_origins` cannot disagree inside an exchange, in either order, so a
  first-sight app stays first sight. Tests change `byTab` between the publish and the request, in
  both orders and across a continuation, and turn the council's pure-function probe into a test.
- A tab refreshed during a long exchange is seen by the next exchange, not this one. For one
  exchange the daemon may hold a slightly older catalog than the page, which is the safe direction:
  nothing the snapshot did not classify is released.
- Routing no longer follows a page that unregisters or re-registers a hand-named tool mid-exchange.
- Not closed here: the daemon still reads an absent list as empty (robustness-2, ADR 0063), and a
  call for a tab other than the snapshot's is routed live.
