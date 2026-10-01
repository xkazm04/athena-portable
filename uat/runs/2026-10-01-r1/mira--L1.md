# mira - L1 (code only, no browser, app not launched)

Character: Mira, Halden Studio owner. Journeys J1, J2, J3, J5. Findings: `mira.findings.json` (22: 2 critical, 8 high, 7 medium, 2 low, 3 strengths; all `cert_level: L1`, `verdict: uncertain`).
Executed evidence: a throwaway vitest file kept outside the repo (scratchpad), plus a python contrast/arithmetic script and an import-graph script. Repo gate for the desktop app: `pnpm exec vitest run` = 22 files, 206 tests pass. Rust was read, not run.

## Verdicts

| Journey | Verdict | Why in one line |
|---|---|---|
| J1 first launch | L1-conditional | three actions are achievable, no key, but the engine is named with a tick and never probed; Later strands her |
| J2 live with her | L1-conditional | resting footprint and sizes are right; a card to a put-away window steals focus; no put-away control; default spot docks on a nudge |
| J3 decide a card | L1-fail | the card cannot show the recipient or the sentence for the flagship chore; Approve is optimistic and a cross-tab answer is lost silently |
| J5 workday in Main | L1-conditional | tabs, theme and connector honesty are fine; the close button lies; the per-app off switch is not enforced |

### Scored criteria

1. First launch, no key, at most 3 actions: **conditional pass**. Enter (Open your first app), type the address (the empty ledger's field is autofocused), Enter = 3. No key anywhere. But the placeholder is `invoicing.example.test`, and the engine tick is not a probe (mira-9). Action 4 is clicking her seal to ask anything.
2. At rest at most 100x100 and no focus: **pass with two exceptions**. seal 92x92 (drawn 76), tab 28x96. She takes focus at launch (lib.rs:215) and when a card arrives while she is put away (mira-2).
3. Waiting card with action, recipient, rationale, exact parameters, one key without Main: **fail**. Action, rationale, parameters yes. Recipient no (mira-1). One key only with her focused (A/D); the focus-free answer is a three-key chord nowhere in the UI (mira-8).
4. Declining as easy as approving and recorded: **pass** (mira-22), with the caveat that both answers share the optimistic-loss path (mira-4).
5. Nothing under 12px, both themes: **pass** (mira-21). Floor is exactly 12px; lowest measured pair 4.87:1.
6. Net time saved at least 25 of 45 min: **conditional**, estimate 28 (range 15 to 35), low confidence (see end).

## 1. Surface model (control -> handler -> store/IPC -> Rust/daemon)

First launch / welcome
- `athena.tsx:26-37` starts tabs, tools, daemon, settings, origins, voice -> `Live` `live.tsx:206` -> `connect()` waits for `settings.hydrated` `live.tsx:97-112` -> `init{onboarded}` -> `machine.ts:205-217` mode welcome -> `views.tsx:325-360` Welcome.
- Open your first app (click or Enter): `actions.open` `live.tsx:253` -> `machine.ts:407-412` effect `onboard` -> `runtime.ts:386` -> `settings.setOnboarded(true)` `settings.ts:100-104` -> `store_set` -> `store.rs:937-944` -> `companion::after_onboarded` `companion.rs:668-688` raises Main, applies layout, docks her `main.right`.
- Later / Esc: `machine.ts:413-416`, `machine.ts:333-336`. Sets mode auto only. No onboard effect.
- Engine line: `views.tsx:336-341` prints `model.welcome.engine` = `engineLabel(settings.engine)` `live.tsx:281`. Not a probe.
- Main hidden at first launch: `lib.rs:286` `.visible(!first_launch)`; Main's first view: Browser lead field `browser/view.tsx:310-347` (`register` writes origin enabled then `tabs_create`, `browser/index.ts:48-56`).

Resting, drag, dock, put away
- Drag: `views.tsx:55` `onPointerDown` -> `actions.drag` -> `lib/companion.ts:136-171` (4px threshold, click swallow) -> `startDragging` -> Rust `Moved` `companion.rs:498-525` -> 180ms quiet -> `settle_drop` `companion.rs:531-557` -> `classify` `companion.rs:253-283` -> `athena:snap` -> `live.tsx:148` `snap{docked}`.
- Tab dock: `machine.ts:158-160` home form -> `athena_set_size("tab")` `companion.rs:463-466`.
- Put away: tray "Put Athena away" `tray.rs:134,144` -> `companion::hide` `companion.rs:597`; Alt+F4 on her window `companion.rs:493-497`. The page's `hide` event has no dispatcher.
- Bring back: tray left click `tray.rs:154-163`, tray "Show Athena", `Ctrl+Shift+Space` `hotkeys.rs:23-25,55-56`, the pill in Main `app.tsx:78` -> `athenaShow`. All land in `companion::show` `companion.rs:581-593` (show + set_focus + `athena:summon`).
- Main close: `app.tsx:129-137` -> `win.close()` -> `lib.rs:303-305` `handle.exit(0)`.

A decision
- Card source: `/run` SSE -> `run.ts:251-253` `decision.requested` -> `cards` -> `live.tsx:127` `rt.cardsChanged` -> `runtime.ts:424-438` (asks `isVisible`) -> `machine.ts:222-252`.
- Draw: `model.ts:327-337` `cardView` -> `views.tsx:171-264` Slip.
- Answer: button `views.tsx:215-218` / key `live.tsx:184-189` / chord `hotkeys.rs:57-60` -> `companion::chord` -> `athena:chord` -> `live.tsx:150` -> `machine.ts:278-300` effect `answer` -> `runtime.ts:392-402` -> `run.ts:370-395` -> `api.ts:205` `POST /decisions/<id>` -> `routes.py:574-614` -> `browser_lane.answer_decision` `browser_lane.py:262-301`.
- Chords registered only while cards > 0: `live.tsx:289-292` `athena_report` -> `companion.rs:613-629` -> `hotkeys.rs:66-81`; tray dot `tray.rs:172-182`.

Main (J5)
- Bar and pill `app.tsx:71-98`, `ModuleBar.tsx:211-266`; pill text `stores/athena.ts:196-200` fed by `athena:status` `companion.rs:634-648`. Theme `app.tsx:86-94` -> `settings.setTheme` `settings.ts:83-88`; the other window follows `store:changed` `settings.ts:131-133`. Connectors `modules/connectors/model.ts:100-140`. Layout `layout.rs:114-140`.

## 2. Reachability for Mira (Claude Code present, Codex absent, first launch)

| Surface | Reachable? | Condition |
|---|---|---|
| welcome | yes | store has no `onboarded` |
| Main / Browser / Connectors / Setup | **unreachable** until Open your first app, or tray "Show Main window" | built hidden `lib.rs:286`; Later does not show it (mira-10) |
| companion `hear` and the Speak button | **unreachable** (disabled) | no voice backend on this host (accepted gap); button shows permanently dim |
| slip | only once a gated turn files a card | needs engine + registered page + a turn |
| Browser apps ledger | only with zero tabs open | page webview covers it (mira-17) |
| per-app Switch off | reachable but not effective | mira-11 |
| engine probe states (not found / not signed in) | **unreachable** | no probe route (mira-9); priya's arm is likewise unreachable at L1 |
| a card from an app other than the focused tab | answerable only when that tab is focused | daemon `foreign_origin` (mira-4) |
| `tab` (docked) | yes by dragging within 32px of an edge | note the default rest spot is inside that band (mira-12) |

## 3. Wiring audit (values computed for a surface -> do they reach a view)

- CompanionModel: 27 top-level fields, 27 used in `views.tsx`; 39 leaf fields once talk/record/origins are expanded, **38 used, 1 dead** (`talk.ready`, `model.ts:279`, 0 hits in `views.tsx`).
- DecisionRequested wire fields: 11 declared (`events.ts:80-92`), **4 drawn** (id as aria-label, action, rationale, params). `origin`, `expires_at`, `decision_kind`, `surface`, `capture_id` never reach a view (mira-16, mira-1).
- Rust events: 10 emitted, 10 have a TS listener. Payload fields ignored: `Snap.to` and `Summon.cards`.
- Companion commands: 5/5 have TS wrappers; `athena_hide` has no page-side trigger (the `hide` event has no dispatcher).
- Daemon read `DaemonApi.decisions()`: **0 callers** (mira-5).
- Origin trust row (`enabled`, `overrides`): shown on 2 surfaces, **enforced by 0** consumers (mira-11).
- Components: 15 files, **5 with no importer** (EmptyState, Facts, PageSection, PushToTalk, Table). Of 400 `export`s in non-test source, 166 have no use outside their own file; most are types and test seams, so I do not count that number as a finding.
- Engine probe: Python `probe_all` exists, 0 routes expose it, Setup receives `probes: null` (mira-9).
- Summary ratios: model leaves 38/39, card wire fields 4/11, Rust events 10/10 (2 payload fields unused), companion commands 4/5 live from the page, components 10/15, enforced origin trust 0/2 fields, daemon inbox read 0/1.

## 4. Grounding audit of the turn (six canonical sources, uat/rubric.md)

| Source | Present? | Where |
|---|---|---|
| 1 the page's own tools | yes, lane-wide not page-scoped | `run.ts:320-335` publishes the manifest; `catalog.render_capabilities` `catalog.py:388-438` lists every entry in the lane, pinned afterwards by policy rule 3 |
| 2 the focused page's origin | yes | `run.ts:119-128` host_state (url, title, up to 12 tabs), session keyed by origin `routes.py:429-449`, fenced |
| 3 the user's message | yes | `run.ts:364-367` |
| 4 the project | **no from this surface** | `TurnBody.project_id` exists `api.ts:169`, `run.ts` never sends it and `settings.activeProjectId` is never read by the run loop |
| 5 a prior fact from the brain | yes | `wiring.py:258` recall, composed with fences `prompt.py:271-291` |
| 6 the gate class of each tool | yes | capabilities block groups GATED/READ/AUTO |

Score 5/6. Additions the turn carries beyond the six: pending-decisions lines (`routes.py:557-568`), last turn's tool results (fenced, capped 1,600), the host-state delta.

## 5. Walk, in character

### J1 first launch

Step 1, launch. She sees one 488x432 welcome window, no Main. Will she try the right thing? Yes: one primary button, Enter is bound (`live.tsx:190`). Does she connect control to effect? Yes. Progress afterwards: Main appears and the seal docks beside it (`after_onboarded`). Fine.
Step 2, "Engine: Claude Code. She never asks for a key" with a tick. She believes it. It is the stored default (mira-9). For me it is true; for a peer without the CLI it would be a lie until the first turn fails.
Step 3, Main on Browser, empty ledger, address field focused, placeholder `invoicing.example.test`. She types `localhost:3001` (`url.ts` keeps `localhost:3001` as a host+port). Register and open writes the origin enabled and opens the tab. 3 actions. No key.
Step 4, to ask anything she must click the seal to open the ledger and type in the Talk composer. Composer enabled only when the daemon is ready and a page is open `model.ts:543-548`.
Failure branch: Later. Main stays hidden, onboarded stays false, and her window has no way to open Main (mira-10).
Scaling: Main is created 1440x900 with no clamp (mira-14); at 125% on a 1080p laptop it is taller than the work area.

### J2 live with her

Enumeration of the seven states (every `ATHENA_STATES` entry, size from `SIZES`, executed in T4):
- seal 92x92: clean. No focus, 45s dim to 55% `machine.ts:34,471-479`.
- tab 28x96: clean as a rest form; unlabelled; hides the seal until clicked (peek 6s).
- tape 440x92: working; not a rest form; it grows leftwards from the seal. Clean.
- hear 440x92: unreachable here (no voice backend).
- slip 488x316: has the content gaps of J3; opens over the corner at once when visible (mira-3).
- welcome 488x432: engine tick (mira-9), Later (mira-10).
- ledger 488x656: fits 824 logical height at 125%, 688 at 150% with 32px to spare; clean on arithmetic, untested live.

Enumeration of snap kinds: main.right (follows Main, `follow()` clamps y into Main's rect), main.left (same), main.corner (seal parked 16px inside Main's bottom-right corner, over the native page webview: allowed because she is a sibling window), screen.left, screen.right (tab), free. Gaps: the default rest spot is inside the screen.right band (executed: gap 24 <= 32, mira-12); no hide control (mira-13); a tab with a card grows to the slip unless put away (T3).
Focus: at rest none. Launch calls `companion::show` and takes focus once (`lib.rs:215`). A card to a visible window does not take focus (set_size only), a card to a put-away window does (mira-2). Main close quits everything (mira-6).

### J3 decide a card

I executed the flagship chase shape. ledgerbox: `draft_reminder` is WRITE, reversible, so AUTO and silent; `send_reminder` takes only `{id}` and is the single GATED step. The card therefore reads: GATED chip, `host:ledgerbox.send_reminder`, the model's one-clause rationale, `id: inv_...`. No recipient, no sentence, no screenshot. I would have to open the invoice in the page to read the draft.
One card: press A with her focused or Ctrl+Alt+A from anywhere. Stamp for 1.5s, slip tears off, next card. The answer goes to the daemon at once.
Two cards: count shows "2 waiting", the second is "and 1 more" in the ledger, after the stamp the next slip unrolls (settle).
Hidden: tray-hidden + card = ring/dot, but see mira-2: focus is taken and the slip opens.
Wrong tab in front: the answer is refused foreign_origin, the card is gone, and nothing on the seal says so (T5, T7, mira-4).
Navigated away: `run.ts:194-199` also refuses an execute on a page whose app id differs; that is a good guard, and it also turns an approved send into a quiet failure.
Voice: no stamp, accepted gap.
Long parameter: scrolls, not keyboard reachable (mira-19).

### J5 workday in Main

Tabs: strip with +, URL field, tab chips, close. Page offers "N tools" pill (`view.tsx:380-403`); hands is not stated there (mira-17). Theme: bar toggle and Setup both write one row; both windows follow `store:changed`; the companion is a fixed physical object, same in both themes by design. Connectors: standing words are derived from the daemon record at render, honest by construction. 900x600: not verifiable at L1 (L2). Close: mira-6.
Origins: the Switch off control is not enforced (mira-11). That is the finding I would escalate first, because it is the one that changes what I believe the product does.

## 6. Time saved

Manual 45 min for "every invoice over 30 days". ledgerbox seeds 37 of them. Designed experience: one sentence to Athena (10s), the turn drafts per invoice through the page's AUTO tools in at most 8 continuation rounds (`run.ts:36,340-358`), roughly 3 to 8 min of waiting I spend elsewhere. Then 37 send cards. Each answer is at least 1.5s of stamp plus a read. Reading only the card (blind to the sentence): 37 x about 6s = under 4 min. Reading each draft in the page: 37 x about 25s = about 15 min. Support-inbox half: a second origin needs its own turn on its own tab, and the real send is the Gmail connector (accepted gap, not scored).
Estimate: 45 - 17 = **28 min saved, range 15 to 35, confidence low-medium** (the L2 stopwatch run would settle it). It passes criterion 6 only if she can trust the card enough to skip reading each draft, which mira-1 says she cannot yet.

## 7. In my own words

I would try it, and in the first minute I would like it. Three actions, no key, and she settles beside my window as a small square that does not grab me. That is the right shape for someone who lives in six tabs.

Then I get to the part I actually pay for, and it lets me down. I told you what I need: show me the invoice and the sentence you will send, I sign. The card gives me `send_reminder`, `id: inv_0042` and a sentence the model wrote about itself. Who is it going to? I do not know without opening the books and finding the draft. For one invoice that is annoying. For thirty-seven it is the whole job again. I have been burned by a half-written mail to a client; I will not sign what I cannot read, so I would open every draft, and then the tool saves me ten minutes, not thirty.

What actually frustrated me, in order. The close button says "Athena stays" and then the whole thing quits, with my waiting cards gone and nothing to bring them back. I switched an app off and found out that "off" is only a word on the screen. I approved a card from the wrong tab and it just vanished; the stamp said approved. And when she is tucked away and a card turns up, she jumps to the front and takes the keyboard while I am typing, which is exactly the thing I told you I hate.

Missing for my job: the recipient and the message on the card, which app it is for, an approve-the-rest that I can look at as a list, and a way to put her away from her own window. I also did not find out the global keys until I read the code.

Would I tell a peer? Not yet. I would say it is the first agent that understands that my tabs are the job, and the gate idea is right, but wait until the card shows what it sends and "off" means off. If those two are fixed I would tell two people the same day.
