# orient-tools

**When** an agent must find its way around an app, **give it `where_am_i`, `app_map` with topics and
`go_to`, put the map in their results, let every read that has a view move the app there, and never let
a landing route override a route already set**, **because** descriptions are cut at 240 chars and every
orientation call is a call not spent on content.

## The three tools

| Tool | Class | Returns |
|---|---|---|
| `where_am_i{}` | READ | `{view, page, layer, title, breadcrumbs[], ids:{...in view}, tools_here[3..6]}`. Description ends "Call first." |
| `app_map{topic?}` | READ | no topic: an index, one line per page (purpose, example hash) plus the topic list. A topic: a page id (route grammar, notes, defaults, tools that fit), `glossary`, `recipes` (the common workflows as tool sequences), `query` (the read router's methods and their params) |
| `go_to{view}` | AUTO | moves the app to a deep link checked by the router's own decoder and the page grammar; an invalid link is refused with its reason; returns the new place as `where_am_i` would |

## Rules

1. **Deep links for everything the agent talks about.** Every page, sub-view and item the agent may
   discuss has a URL (a hash route is simplest). State that exists only in a modal or in unsaved local
   state is not a `go_to` target; the survey lists such gaps.
2. **Show what you read.** Every READ tool that has a view takes `show` (boolean, default true); on
   success it navigates through the app's ordinary router (so breadcrumbs, motion and Esc behave as for
   the person) and returns `view`. `show: false` reads without moving.
3. **No ambient selection.** No tool reads "the current session". Ids are arguments; `where_am_i`
   returns the ids in view so she can pass them.
4. **The landing route never steals navigation.** An intro, a splash or a "last visited" restore must
   not replace a route that is already set, including one set by `go_to` a moment after load. Open the
   app with its target hash, and fix the app if it overrides one.
5. **Client-side routing for moves.** A move that reloads the document re-runs the bridge (the tab
   re-injects on navigation, `tabs.rs:227-235`) and refuses any card proposed on the old document
   (ADR 0103). Hash or history-API routing keeps the document.
6. **Every view the agent needs analytically has a tool, with the page's numbering.** If the person can
   read a fact on a page (a pick's reasons, a line number), a tool returns it, numbered the same way.
7. **`tools_here` names only catalogue tools**, 3 to 6 per place, and is tested for every route.
8. **Each `app_map` answer fits the result budget** (Shadowrunr holds them to `MAP_MAX`, under 1,500).

## Evidence

- Live pilot 2026-10-23, run 1 to run 2: `app_map` was truncated in run 1; topics fixed it
  (cold-orientation $0.40 to $0.25, untruncated). Run 2: review-walkthrough, analyze-sims and
  shape-malakor reached content in 0, 0 and 1 calls; review-walkthrough went from 12 calls to 7 (n=1
  per case).
- The intro stole navigation: `apps/console/src/shell/Shell.tsx` navigated with replace after the agent
  had moved the console; fixed in overlord `f694b9d`. Only a live driver exposed it.
- Character audit 2026-10-24: no tool returned a show's pick reasons, so she used `page_read`, whose
  line numbers were offset by about 12 from the API's.
- Reference implementation: `apps/console/src/app/agent/toolsOrient.ts`, `where.ts`, `appMap.ts`;
  `catalog.test.ts` ("names only catalog tools in tools_here, 3 to 6 per place").

## Registry

`mcp-tools/ambient-selection-is-not-an-argument` (agrees). `mcp-tools/catalog-projection-modes`
describes a self-teaching router and a never-withheld discovery tool; `app_map` is both, and
`where_am_i` is the ambient-selection resolve call made explicit. `agent-addressable-ui` holds that the
fact the build knew should be kept, not reconstructed: publishing the route grammar is that.
