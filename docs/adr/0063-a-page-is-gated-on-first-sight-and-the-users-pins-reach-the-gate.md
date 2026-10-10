# 0063. A page is GATED on first sight, and the user's pins reach the gate

Date: 2026-10-10

Brings the code up to README section 3.3 and to what ADR 0025 already assumes ("README section
3.3's first-sight override still makes it `GATED` on an origin the user has not trusted"). Builds
on ADR 0004 (the class is derived from the flags) and ADR 0011 (the shell says the per-turn lists,
the daemon keeps none). Found by the page-operation-via-webmcp council-lite round 1 (run 722eed51,
craft: "The code says a page cannot argue itself out of GATED, yet the page's own flags decide
AUTO").

## Context

A page's tools reach the catalog with flags the page wrote. `gate.js` maps `readOnlyHint: true`
to `reversible: true, side_effects: "none"`, `HostTool.default_class` derives `AUTO` from that,
and the gate let `AUTO` through with no card, so the page ran the call. A page that stamps
`readOnlyHint` on a delete, or a prompt injection that steers a turn into such a tool, acted in the
user's signed-in session with nobody asked.

README section 3.3 says otherwise in two places: generic hands are `GATED` on first sight for every
new origin, and a surface may tighten a class per origin but never loosen one. The code had
neither. The origins table had only two meaningful states (`enabled: false` was sent as
`disabled_origins`; everything else was believed), so an origin the user had never registered was
as trusted as one they had. And the per-tool pins the Browser module shows as "N pinned" were never
sent anywhere, so a user's own tightening enforced nothing.

## Decision

**An origin has three states, read off the shell's origins table.**

- No row: first sight. Every host tool of that app is `GATED`, whatever its flags say.
- A row with `enabled: true`: the user registered or trusted it. Its classes are the ones the
  flags imply (ADR 0004), tightened by the user's `GATED` pins.
- A row with `enabled: false`: switched off, refused `foreign_origin`, exactly as before.

**The surface says both lists on every request.** `stores/run.ts` `gatedListsOf` maps the table
onto the open tabs by the rule `disabledOriginsOf` already uses (a web origin becomes the
`host:<app_id>` a tab on it published; a key already in catalog form is read as it is) and returns
`gated_origins` (the first-sight apps) and `gated_tools` (`host.<app_id>.<tool>` pinned `GATED` on
an enabled row). Every `POST /run` body and both voice turn frames carry them. A record the table
does not list (`known`) is no row. The surface fails closed: a table that has not loaded, or could
not be read, makes every open tab's app a first sight. A pin of `AUTO` or `READ` is never sent.

**The daemon keeps none of it.** `routes.py` parses the two fields the way it parses
`disabled_origins` (a list of non-empty strings, stripped and capped at `MAX_GATED_NAMES`; anything
else is empty), and they ride on `TurnContext` as `gated_origins` and `gated_tools`, so two
concurrent turns never see each other's lists. The voice gateway carries them from the frame to
the turn as it carries `disabled_origins`.

**The gate tightens; the catalog is unchanged.** `GateHook.before_tool_call` treats a host entry
whose origin is in `gated_origins`, or whose name is in `gated_tools`, as `GATED`: the validator
still runs first, then a card is filed and the call is cancelled `pending_approval`. Core and
connector entries are not a page's to describe and are untouched. The class the catalog derives
stays what it was, because it is a fact about the manifest; first sight and pins are facts about
this user and this turn. The replay of an approved card (ADR 0038) is unchanged: the card is the
permission, proved against its parameters and spent once.

## Consequences

The residual trust assumptions, stated so a later reader does not have to discover them:

- **Once the user registers an origin, its flags are believed.** A registered page that stamps
  `readOnlyHint` on a delete still runs it with no card. Honest flags are the host author's duty,
  and registering is the user's statement of trust in them. A pin to `GATED` is the user's way to
  take that trust back for one tool.
- **The tightening rides on the surface's request.** A caller that sends no list — the MCP server,
  the proving harness, a malformed body — gets the classes the flags imply. The shell is the one
  surface with an origins table, and it always sends both lists.
- **`POST /manifest` still has no origin allow-list.** Any page can publish tools; first-sight
  `GATED` is what makes that harmless, because an unregistered page's tools can only file cards.

Other effects:

- The capability block the model reads is rendered by the catalog and still lists a first-sight
  tool under the class its flags imply. The model learns otherwise from the `pending_approval`
  refusal. Rendering the tightened class needs a change in `core/`, which this decision does not
  make.
- The panel's tool list (`companion/tools.ts`) still shows the flag-derived class for a first-sight
  tool. The gate is right and the display is not yet; that is a surface change for later.
- A first-sight app costs the user one card per call until they register it. That is the point.

## Alternatives that lost

- **Tighten in the catalog.** The catalog would have to hold per-user, per-turn state, and two
  turns with different tables would race on one shared registry (the reason ADR 0011 put
  `disabled_origins` on the context).
- **Keep the origins table in the daemon.** It lives in the shell's SQLite and both windows write
  it (ADR 0026); a copy in the daemon is a second record that can drift.
- **Distrust the page's flags everywhere.** Every page tool would be `GATED` forever and ADR 0004's
  `AUTO` would mean nothing; README section 3.3 asks for tightening, not for abolishing the class.
- **Fix it in `gate.js`.** The page side of the bridge cannot know what the user trusts, and its
  mapping is pinned by `tests/test_refusal_parity.py`.
