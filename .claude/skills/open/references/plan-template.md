# Exposure plan template (`<app>/.athena/open-plan.md`)

`/open survey` writes this file into the app's repository; `/open build` reads it and ticks it off;
`/open verify` appends its results under "Verification". Every claim carries its evidence as
`file:line` in the app, or as the Athena source that sets the rule. Copy the headings verbatim so a
later run can find its place.

```markdown
---
app: <athena:app slug, [a-z0-9_-]>
app_name: <what Athena shows a person>
kind: web | tauri | tauri-with-http-backend | spa-with-api
surveyed: <YYYY-MM-DD> by open@<version>
athena_rules_read_at: <athena-portable commit the caps below were read from>
status: surveyed | building | built | verified-L1 | verified-L2 | verified-L3
---

# <App> exposed to Athena

## 1. What the app is, and the surface chosen
- What the app does and who uses it, in two sentences.
- How its UI is reached from an Athena tab: <dev server URL / static dist served on localhost / hosted URL>,
  the origin it runs under, and why (standard: surface-selection).
- Where its data lives and how the frontend reaches it: <HTTP/RPC daemon, REST API, Tauri `invoke`,
  local storage, IndexedDB>. If the frontend reaches its data only through Tauri `invoke`, say so here:
  that UI cannot work in her tab as it is (surface-selection, "Tauri").
- The chosen surface (WebMCP in the page / connector spec / both) and the rejected ones, with the reason.

## 2. Pages, routes and deep links
| Page id | Route grammar | Example deep link | Purpose | Ids in view |
|---|---|---|---|---|
- Router: <hash / history / none>, file:line. Does a landing or intro route override a route that is
  already set? (lesson 1.0.0: the intro stole navigation). Fix needed: yes/no.
- Routes with no deep link (modal-only state, unsaved local state): list them; they cannot be
  `go_to` targets until they have one.

## 3. Read and write surface
| Operation | Kind (RPC / REST / store / invoke) | Read or write | Reversible? | Reaches outside the app? | Source |
|---|---|---|---|---|---|
- The largest realistic answer for each read (rows, chars), and which ones need paging.
- Ids: which are globally unique and which are only unique inside a container (lesson: bare run ids).

## 4. What the orient tools would say
- `where_am_i` on three representative pages: the JSON it would return (view, page, title,
  breadcrumbs, ids in view, tools_here).
- `app_map{}` index: one line per page plus the topic list; the topics (`glossary`, `recipes`, a page
  id each, and `query` if there is an allowlisted read tool).

## 5. Proposed catalogue
| Tool | Class (READ / AUTO / GATED) | Why this class | Params (arrays with maxItems) | Largest answer estimate | Description (<=240) |
|---|---|---|---|---|---|
- Totals: N tools (R READ, A AUTO, G GATED).
- Capability footprint estimate: <chars> of the 5,000-char per-app budget (12,000-char block shared with
  Athena's core entries and the shell's hands), computed with the renderer port in
  `techniques/capability-footprint.md`.
- Result budget: every read answers in <=1,500 chars at realistic size; the paged reads and their page size.
- Writes: which are edit-by-digest, which replace whole, what the card will show the human.
- Deliberately out of reach (and why): <publishing, payments, messages to people, credentials, ...>.

## 6. Trust and pairing steps
1. Start the app's backend with its Origin allowlist admitting <origin> (file:line of the allowlist).
2. Open <url> in an Athena tab.
3. Register the origin (Apps, "Address of the app to register").
4. Switch the app's own opt-in on (<where the toggle is>, storage key `<app>.athena.drive`).
5. Re-trust the origin (Origins: Disable, then Enable) so the contracts listed now are the accepted ones.
6. Check: a read runs without a card, a write files one.

## 7. Risks
| Risk | Likelihood | What it would cost | Mitigation |
|---|---|---|---|

## 8. Build checklist
- [ ] meta tags (`athena:app`, `athena:app-name`, `athena:app-version`)
- [ ] opt-in toggle, default off, abort unregisters every tool; catalogue in its own chunk
- [ ] orient tools (`where_am_i`, `app_map` with topics, `go_to`)
- [ ] read tools with `show`, bounded lists, paging, the result guard
- [ ] write tools (GATED), edits by find/replace against a base digest
- [ ] catalogue tests: names, classes, descriptions <=240, closed schemas, `maxItems`, footprint <=5,000,
      result size <=1,500 at realistic fixture size
- [ ] Origin allowlist on the app's backend; no token in the page
- [ ] pairing guide (`docs/athena.md` or the app's equivalent)
- [ ] the per-app harness config for `/open verify`

## 9. Verification
<appended by /open verify: one row per run>
| Date | Level | Result | Cost | Report |
|---|---|---|---|---|

## Skill improvement log
<one dated line per observation that would change a future /open run on this app>
```
