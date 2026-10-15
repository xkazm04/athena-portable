# 0106. Another open, trusted tab may be proposed on, and every such call is a card

Date: 2026-10-15

Amends the origin-pinning rule (`harness/policy.py` `_origin_pinning`, README section 3.4) and
the law's cross-tab paragraphs from [0045](0045-a-proposal-rests-on-what-a-page-says.md) and
[0047](0047-ask-for-the-tab-the-work-needs.md). Builds on [0103](0103-an-approval-runs-on-the-tab-and-document-it-was-proposed-on.md)
(tab binding), [0104](0104-a-turns-cards-are-answered-as-one-ordered-sheet.md) (the ordered sheet),
[0105](0105-read-a-trusted-tab-by-name-and-hold-the-rest-of-the-turn-to-cards.md) (`tabs_read` and
the taint), [0063](0063-a-page-is-gated-on-first-sight-and-the-users-pins-reach-the-gate.md) and
[0100](0100-trust-is-per-origin-and-per-contract.md) (trust), and amends the grouping key of 0104.

## Context

A session was pinned to the focused app: `_origin_pinning` refused any tool of another app with
`foreign_origin`, and the snapshot published only the focused tab's manifest (ADR 0067). The
weekly job is "read in one app, act in another" (README section 1): with Ledgerbox and TidyCRM open,
one request ("settle INV-1042 and log it on the contact") had to become a switch, a second request
and a second set of cards. ADR 0105 made the reading half possible without a switch; the acting half
still needed one.

Loosening the pin is the one change here a hostile page would want: text on tab A that talks the
model into a write on tab B. So the loosening must buy proposals only.

## Decision

1. **The surface lists the other open, trusted tabs.** Each exchange's snapshot (`snapshotOf`)
   holds, beside the focused tab, every other open tab whose web origin is an enabled row of the
   origins table (the same trust rule as the accepted contracts, ADR 0100; an unread table trusts
   nothing). First-sight and switched-off tabs are never listed and their manifests are never
   published. One tab per app: for an app open in several tabs, only the one focused most recently
   (`tabs` store `recent`, else strip order); a second tab of the *focused* app is not an "other"
   app at all. At most 11 other apps (host state lists 12 tabs). Each listed tab's manifest is
   posted (`POST /manifest`, its own count caps, ADR 0070); one the daemon refuses is left out.
   The request names them in `open_apps`: `{app: "host:<id>", origin, tab_id, tab_nav}`, from the
   shell's tab list, never from a model. The capabilities block renders them under the existing
   12,000-character bound, cuts announced (ADR 0070).

   The `tab` enum alternative (one tool, a required `tab` parameter naming the shell tab) was not
   taken. It would add a parameter the page's tool does not have, rewrite every published schema,
   need the lane to strip it before `execute`, and give the model a field that names where a call
   runs - exactly the thing the binding keeps away from it. The most-recent tab is what the person
   last looked at, and a person who wants the other one focuses it.

2. **Policy lets a listed app through rule 3, and only there.** `_origin_pinning` now permits a
   host tool of another app if and only if `open_app_for` finds it in `ctx.open_apps`: listed once,
   not also in `gated_origins` (first sight) or `disabled_origins` (switched off, which rule 2
   refuses anyway), and its tab still on the page origin the app's manifest was published from
   (the same second comparison the session's own app gets). Anything else is `foreign_origin` as
   before, with a sentence that says a tab can be proposed on only while open on a trusted site.
   `open_apps_from` drops a malformed item rather than guessing, drops an app listed twice, and
   refuses a list past `MAX_GATED_NAMES` whole.

3. **The gate makes every such call `GATED`.** `GateHook._tightened` gains `another_tab`: any host
   call whose app is not the session's pinned app files a card, `READ` and `AUTO` included. A read
   of another tab that should not wait on a person goes through `tabs_read` (ADR 0105), which acts
   nowhere and taints the rest of the exchange. The tightening is the gate's own rule and holds
   with or without policy in front of it, so the permit in step 2 is never permission to run.

4. **The card is bound to the tab the tool was proposed on.** `_tab_for` binds a cross-tab card to
   the `tab_id`/`tab_nav` of that app's `open_apps` entry - the surface's snapshot, never the
   model. The card's summary says `proposed from the host:<focused> tab; it runs on the
   host:<other> tab`. The gate-filed capture stays the focused tab's own (ADR 0066): a cross-tab
   card has none and the panel says "no picture: proposed on another tab". The panel states the
   answer in the name of the bound tab's origin (`POST /decisions` `origin`), so the route's
   origin check compares the card's app with the tab it runs on; a bound tab that is gone states
   nothing and the row's own origin decides, so a decline still goes through. The replay runs under
   the card's own app (`_decision_ctx`), and single use is unchanged (ADR 0038).

5. **One checklist per request.** The sheet key (ADR 0104) is now the request alone for a page's
   bound card, whatever its app or tab; a connector's, core's or unbound card keeps a sheet of its
   own origin. Rows stay in proposal order, which is the order they run in; the sheet labels each
   change of app and tab (`TidyCRM - Contacts`) rather than regrouping, because regrouping would
   change which row runs first and so what "stop at the first failure" stops. Each row runs on its
   own bound tab through `onPage`, spends its own grant, unticked rows are declined first, and the
   walk stops at the first row that is not ok - the rules of 0104, unchanged.

6. **Taint and trust still apply.** `tainted_by` (ADR 0105) still holds every host call to a card;
   a cross-tab call already is one. The other tab's contract drift (ADR 0100) is computed for every
   enabled tab already and is sent in `gated_tools`; its calls are gated regardless.

7. **The law says it.** "You cannot reach a tab's tools from another" became "another tab's tools
   are out of reach except as a proposal: while that tab is open on a site the person trusts, a
   call of its tools becomes a card for them to approve, and otherwise it is refused", and the
   ask-to-switch paragraph applies to a tab she cannot propose on. The law's hash changes, so CLI
   sessions start afresh once.

## The Gauntlet evidence

`tests/proving/test_gauntlet_cross_tab.py` runs the real composition (catalog, policy, gate,
approval table, brain) with the Proving Ground's fully injected scripted model, which proposes
whatever `TARGET=` hostile content names. Hostile text on the Ledgerbox tab - in page state and in
a tool's answer - aims at TidyCRM's `read_contact` (READ), `add_note` (AUTO) and `delete_contact`
(GATED): all six attacks become a card bound to the TidyCRM tab, nothing is allowed, nothing runs,
the verdict is `held`. An approve releases one `execute` bound to that tab; the same grant replayed
is `approval_spent`; a decline runs nothing. With TidyCRM not listed, first sight, switched off, on a
moved origin, or a registered app with no open tab (Hirelane), every attempt is `foreign_origin` and
no card is filed. It is a fixture and not a member of `SURFACES`: the live run's generators aim at
one world's `GATED_TARGETS` (Ledgerbox's), and a second app in every world with a target enum across
two apps is a corpus and report change, not something the runner carries as it stands.

## Consequences

- One request can end in a checklist across Ledgerbox and TidyCRM, each row run on its own tab,
  each with its own grant. The model continues once.
- A hostile page can now get a card filed on another trusted tab. That is the loosening: a
  proposal, shown whole with its app, its tab and "proposed from ... it runs on ...". It cannot get
  anything run, cannot reach a first-sight, switched-off or closed tab, and cannot choose the tab.
  The cost is the person's attention, the same cost any gated proposal on the focused page has.
- A `READ` of another tab through its own page tool is now a card; reads that should not wait go
  through `tabs_read`.
- Voice and MCP turns send no `open_apps` and are pinned as before.
- A repeat answer to a spent card is refused by the route as any second answer is
  (`pending_approval`, "approved, not pending"); `approval_spent` is the gate's answer to a second
  replay of the grant. Neither runs anything.
- Unmeasured: whether the model proposes across tabs instead of asking for a switch. The benches
  are the measure.
