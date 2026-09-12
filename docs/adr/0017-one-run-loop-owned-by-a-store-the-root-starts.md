# 0017. One run loop, owned by a store the app root starts; views never talk to the daemon

Date: 2026-09-12

## Status

Accepted. Implements README section 3.2 (how a turn flows) and section 3.5 (the tray-count row and
the automation-seam row); builds on ADR 0010 (the browser lane holds no gated executor), ADR 0012
(one turn is one SSE stream of channel events) and ADR 0013 (module-first window).

## Context

A turn is not a request. It is a conversation with the daemon that can outlive any one screen: the
manifest goes up, `POST /run` streams, the page runs the calls the gate allowed, the gate files a
card, the user answers it — possibly minutes later, possibly from the Approvals module — and the
results ride the next round. Several modules want a piece of that. The Panel renders the
transcript and the card. Origins renders the tool list with its per-origin pins. Approvals will
render the same cards across every origin, and Activity will render what the calls cost.

The first build put all of it inside one view. Two things went wrong and both are in README
section 3.5. A count that lived in one page **froze the moment the user navigated away from it**,
because the thing keeping it true was a component that had unmounted. And the panel had **no
automation seam at all**: phase 2 was verified by attaching to WebView2's remote debugging port
with throwaway scripts, so the most valuable behaviour in the product — the gated round trip — was
the only behaviour no test could hold.

The module-first window of ADR 0013 makes the first problem worse rather than better. Exactly one
module is mounted at a time now. A run loop that lives in a module would be a turn that stops when
the user looks at the record of the last one.

## Decision

**`stores/run.ts` owns the only run loop in the app, and `src/app.tsx` starts it.**

- `startRun()` is called by the app root and by nothing else. A module's view may read the store
  and call `runActions`; it may never start one. This is the module rule README section 3.5 asks
  for, written down: anything that must stay true while the user is looking elsewhere is a store
  the root starts.
- **No view calls the daemon.** `lib/daemon-client.ts` is typed for every route, and the only
  caller is this store. A second caller would be a second conversation, a second manifest and a
  second idea of which card is open.
- **The public surface is the contract between this store and every module view**: the state
  (`status`, `transcript`, `pendingDecision`, `lastError`, `conversationId`, `tools`), the actions
  (`send`, `answer`, `setOverride`, `forgetOrigin`, `clear`) and `startRun` / `resetRunForTests`.
  Views are written against those names, so the loop and the screens can be built in parallel.
- **The loop's outside edges are injectable** (`RunDeps`: `fetch`, the endpoint, the focused page,
  the tabs, the origin's pins, `bridgeCall`, the activity write, the clock). That is the
  automation seam: `stores/run.test.ts` drives a manifest, a stream, a host call, a card and an
  answer against an in-process fake daemon serving recorded SSE fixtures, with no Tauri, no
  socket, no browser and no Python.
- **The user's per-origin pins are applied to the manifest, not to the call.** `decide()` in
  `@athena/bridge/gate` says an override may tighten a class to `GATED` and may never loosen one;
  a tightening is sent as `reversible: false` on that tool's manifest flags, so the *daemon's*
  catalog holds the tightened class and the daemon files the card. The panel therefore never has
  to second-guess a call the daemon allowed, which would have been a second gate (README
  invariant 3).
- **A `tool.call` the same stream also answered is a call the page must not run.** The gate emits
  `tool.call` for every op it saw and a `tool.result` only for the ones that did not leave this
  process — a cancelled one carries the reason, `pending_approval` for a card it just filed. So
  the calls the surface runs are exactly the unanswered ones. That is the wire's own way of saying
  "the page runs this one" (ADR 0010), and it needs no second list.

## Consequences

- The Panel, Origins, Approvals and Activity modules can be written by four people against one
  store, and none of them can open a second conversation with the daemon.
- A card survives a module switch, a tab switch and a scroll, because nothing that holds it is
  mounted. It does not survive a window close: the approval row does, in the daemon's brain, and
  the inbox is that table rather than a copy of it.
- `runActions.clear()` empties the transcript and drops the card **from this panel only**. Only
  the daemon may resolve an approval row, so the row stays in the inbox. Clearing a view is not an
  answer, and a panel that pretended otherwise would show a user a decline that never happened.
- An approved `execute` runs only on the page whose manifest the daemon accepted it under. When
  the focused tab has moved, nothing runs and the transcript names the page to open. A call
  executed on the wrong page is not a smaller mistake than a call not executed.
- One store means one `MAX_ROUNDS` ceiling and one per-origin call budget for the whole app, which
  is the only way either number can mean anything.
- The cost of the injectable edges is a `RunDeps` record that has to be kept honest: a new thing
  the loop reaches for is a new field, and a test that forgets one gets the live store. The
  alternative — mocking the module graph — is the thing the first build did with WebView2 scripts,
  and it is why this ADR exists.
