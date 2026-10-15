# 0103. An approval runs on the tab and the document it was proposed on

Date: 2026-10-15

Amends [0067](0067-one-snapshot-of-the-tab-per-exchange.md) (one snapshot per exchange) for the
`execute` an answer releases, and extends [0066](0066-a-gated-host-proposal-carries-a-capture-of-its-tab.md)'s
rule for which card carries a capture to the tab binding. The gate's classes do not change.

## Context

An `execute` carried no tab and no document. `onPage` dispatched it to whatever tab was focused at
the moment of the answer and only compared app ids, so with two tabs of the same app (UAT r1,
uat-2) a card filed on tab A and approved while tab B was focused ran on B: same app, wrong
invoice list, wrong row behind a ref. A reload of A between the card and the approval also still
executed, against a document whose refs and state were not the ones the card showed.

## Decision

1. **The shell counts documents.** `tabs_list` (and `tabs:changed`) carry `nav`, a per-tab count
   of top-level navigations the webview started, reloads included (`Tabs::navigated`, called only
   from the webview's navigation handler, so a `tabs_navigate` command is counted once). It is the
   "same document" signal: the bridge nonce lives for the tab's whole life and cannot say it, and a
   URL cannot tell a reload from staying put. Same-document changes (`pushState`, a fragment) do
   not count, which is right: the document and its refs survive them.
2. **The surface sets the binding, never a model.** Every `POST /run` sends `tab_id` and `tab_nav`
   from the exchange's snapshot. The daemon reads them as non-negative integers or not at all
   (`routes.tab_from`) into `TurnContext.tab_id/tab_nav`.
3. **The gate files it on its own page's cards only.** `GateHook` passes the binding to
   `Approvals.create` for a card whose origin is the session's host origin, exactly the cards that
   get the capture. A connector's, core's or another app's card stays unbound. The binding is read
   after the class decided there is a card: destination binding, not a class change.
4. **The row is the source.** `companion_approval` gains nullable `tab_id` and `tab_nav` (added on
   open to an older brain, like `consumed_at`); `ApprovalRow`, `ApprovalGrant`, `DecisionRequested`
   (and its TS mirror), the `GET /decisions` row, `Execute` and its wire form carry them. The
   `execute` takes them off the row, not off the answering request.
5. **The panel runs it there or nowhere.** `onPage` sends a bound row to the bound tab by its id,
   focused or not (`bridge_call`/`hands_call` already take a tab id). A bound tab that is gone, or
   whose `nav` moved, refuses before any dispatch with `unknown_ref` (what the card pointed into no
   longer exists; no new reason was added). `answer` runs the same check before it posts an
   approve, so the grant is not spent on a call that cannot run: the card stays, says "Not run: the
   tab this was proposed on reloaded or moved to another page since. Decline it and ask again.",
   and a decline still goes through. A row a tab reports no `nav` for cannot prove it is the same
   document and is refused when it carries one.
6. **The card shows the tab** beside its app line: the tab's title when it is the app's only tab,
   else "tab N of host - title" in strip order, "(it has reloaded since)" when `nav` moved, and a
   "Go to that tab" button (`tabs_focus`) when the tab is open and not focused. Ref descriptions
   are asked of the bound tab.
7. **Unbound rows behave as before**: an old approval, a connector's, core's, or a turn whose
   surface sent no tab runs on the focused tab with the app-id check.

## Consequences

- With two tabs of one app, an approval lands on the tab the user saw the card about, and a
  reload voids it without spending it. The cost: after a reload, a pending card for that tab can
  only be declined and asked again.
- Approving no longer requires focusing the tab; the call runs in a background tab of the same
  app. The gate, the origin pin and single use are unchanged.
- Voice and MCP turns send no tab and file unbound cards, as before.
