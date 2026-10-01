# ana -- L1 (code only) -- keyboard and low vision, 150% scaling

Character: ana. Journeys: J2 live-with-her, J3 decide-a-card, J5 workday-main. Lens: Tab path and focus ring,
contrast arithmetic, aria and live regions, reduced motion, 150% sizes. Nothing was launched. Reproductions
are cited with the file that was run (scratchpad scripts, vitest against the real `machine.ts` and
`SIZES`); the numbers are in the tables below.

## Verdicts

| Journey | Verdict | One line |
|---|---|---|
| J2 live-with-her | **L1-conditional** | Show, put away, summon and Esc all have keys; moving and docking her has none, and her resting dim fails contrast. |
| J3 decide-a-card | **L1-conditional** | A/D, Ctrl+Alt+A/D and aria-keyshortcuts exist and the stamp is announced; arrival is announced badly and one arrival path steals focus onto a one-key approve. |
| J5 workday-main | **L1-fail** | Browser mode Tabs into controls that are clipped away, nothing moves keyboard focus into a page, and Main opens larger than a 1080p work area at 125% and 150%. |

Severity below is derived from impact (low 1, med 2, high 3; sum 3-4 low, 5-6 medium, 7-8 high, 9 critical).

## Grounding score (the turn, six canonical sources)

| # | Source | Reaches the turn from this client? | Evidence |
|---|---|---|---|
| 1 | page's own tools | yes, via manifest before each exchange | `src/stores/run.ts:309-329`, `:305-322` `manifest()` at `:139-150` |
| 2 | focused page's origin | yes | `run.ts:283-285` (`origin: focused.origin`), `:113-117` |
| 3 | user's message | yes | `run.ts:283-290` |
| 4 | the project | not from the client (no project field in the request); may be daemon-side, unverified | `run.ts:283-289` |
| 5 | a prior brain fact | not from the client; daemon-side, unverified at L1 | `run.ts:283-289` |
| 6 | gate class of each tool | yes, as `class` on every tool row and a GATED word on the card | `src/companion/model.ts:151-153`, `views.tsx:191` |

Score: **4 of 6 visible from the client, 2 of 6 unverifiable at L1** (the daemon builds the prompt). Addition, named
not counted: `host_state` = up to 12 tab urls and titles plus the page url and title (`run.ts:118-130`), fenced
daemon-side. My lens adds a question the denominator does not ask: the card she must answer does not say which
origin it will act on; the origin is only implied by the params (`model.ts:318-326`, `CardView` has no origin).

## Surface model (affordance to code)

| Affordance | Chain | Keyboard / focus |
|---|---|---|
| Seal button | `views.tsx:57` -> `actions.seal` -> `live.tsx:246` -> `machine.ts:313-332` | Tab stop, ring `companion.css:203-206` (see ana-9 on the mask) |
| Approve / Decline | `views.tsx:215-220` -> `actions.approve` -> `live.tsx:247-248` -> `runtime.ts:96-106` -> `useRun.answer` | Tab stop, ring `companion.css:707-711`; keys A/D `live.tsx:184-189`; chords `hotkeys.rs:24-29,76-93` -> `companion.rs:651` -> `live.tsx:150` |
| Speak | `views.tsx:221-242` | button is pointer-hold (`onPointerDown`); the key equivalent is a held Ctrl+Space (`stores/voice.ts:451-457`), not mentioned on the slip |
| Esc | `live.tsx:179-182` -> `machine.ts:333-347` | enumerated below |
| Ledger tabs | `views.tsx:114-130` | roving tabindex, ArrowUp/Down, `views.tsx:105-112` |
| Composer | `views.tsx:456-461` | input ring `companion.css:1324-1326`; Esc blurs `live.tsx:172-175` |
| Pin, collapse | `views.tsx:377-390` | `aria-pressed` and labels; ring `companion.css:790-792` |
| Origins toggle | `views.tsx:577-584` | `aria-pressed` toggle button |
| Move / dock | `views.tsx:55` `onPointerDown` -> `lib/companion.ts:128-155` | pointer only. No keyboard path anywhere |
| Put away | tray `tray.rs:49-52`, Alt+F4 -> `companion.rs:493-496`; machine `hide` event has no dispatcher | tray or Alt+F4 only |
| Main bar, theme, window buttons | `ModuleBar.tsx:79-114`, `app.tsx:80-102`, `app.tsx:105-143` | `.focus-ring` `app.css:264-271` |
| Browser tab strip, URL, ledger | `browser/view.tsx:46-109` | DOM order: strip, then ledger |
| Presence pill | `ModuleBar.tsx:102-112` -> `athenaShow` | Tab stop, not live |

## Reachability

- First launch: only `athena` at `welcome`; Main is created hidden (`lib.rs:285-290`). Ana can reach the seal, the
  Open button (Enter anywhere in welcome, `live.tsx:190-191`) and Later. Main, the whole of J5, is `unreachable`
  until "Open your first app"; Esc and "Later" skip it and leave no in-app way to Main (ana-15).
- Docked `tab`: reachable, the whole 28x96 is one button, label "Athena, docked. Press Enter to summon." (`model.ts:356`).
- Hidden: reachable by Ctrl+Shift+Space (`hotkeys.rs:24-26`) or the tray; off the taskbar, so she is **not in Alt+Tab**
  (`companion.rs:421` `skip_taskbar`, an inference about WS_EX_TOOLWINDOW; verify at L2).
- Card chords exist only while `cards > 0` (`companion.rs:626-629`).
- Engine absent: composer disabled with a reason (`views.tsx:462`); not exercised by this lens.

## Wiring audit (declarations vs uses, name reaches a view)

| Group | Reaches a view | Misses |
|---|---|---|
| `CompanionModel` leaves (27 top-level, 8 under `talk`; 34 leaves) | 33 of 34 | `talk.ready` (`model.ts:299` computed, `views.tsx` 0 hits) |
| Machine non-timer events (19) | 16 of 19 have a dispatcher | `expand`, `show`, `hide`: 0 non-test dispatchers (`machine.ts:99,102,103`) |
| Rust event payload fields (10) | 7 of 10 | `athena:summon.cards` (`live.tsx:149` ignores the arg), `athena:snap.to`, `athena:status.visible` (`stores/athena.ts:45` stored, `app.tsx:70-73` never reads) |
| Components | `PushToTalk` 0 importers (`components/PushToTalk.tsx`); its CSS `app.css:926-934` is dead | 1 orphan |
| CSS rules whose class is never produced | `.aw.arrive`, `.aw.drop`, `.aw[data-intro]`, `.wl-sim` (`companion.css:623,633,1195,1221-1237`); `views.tsx:54` puts `arrive` on `.aw-fig`, not `.aw` | 4 dead |

Ratio, model leaves: **33/34**. Events: **16/19**. Payload fields: **7/10**.

## Contrast arithmetic (run: `scratchpad/c.mjs`, WCAG 2.x relative luminance)

Paper (the surface she reads at 150% in sunlight; identical in both themes, `companion.css:40-51`):

| Pair | On paper `#eef3f2` | On paper-2 `#e1e9e8` |
|---|---|---|
| ink `#0a1214` | 16.89 | 15.34 |
| ink-2 `#3e5560` (12-13px labels) | 7.01 | 6.37 |
| stamp `#9d174d` (GATED, counts) | 7.04 | 6.39 |
| agent `#6d28d9` | 6.34 | 5.76 |
| external `#075985` | 6.75 | 6.13 |
| ok `#047857` | 4.89 | **4.45** (no text sits on paper-2) |
| info `#1d4ed8` | 5.98 | 5.43 |

Buttons: white on stamp 7.88; white on teal `#0e7490` 5.36; kbd chips at 0.85 opacity 6.03. Housing: house-ink on
the three gradient stops 6.88 / 8.95 / 9.97; **house-ink-2 on `#123640` 4.35** (used only for a decorative ring and
done pips, not text); human pink on housing 4.87 to 7.06; badge ink on pink 7.15; focus cyan on housing 8.90 to 12.90.
Focus rings: paper-ink on paper 16.89 (>= 3).

Where it fails 4.5 for text or 3 for a control boundary:
- **Resting dim**, `opacity: .55` on the whole figure (`companion.css:160-162`): ink-2 on paper over a white
  wallpaper **2.46**, over mid-grey **3.11**, over black 3.74; house-ink caption over white **2.75**, grey 3.49,
  black 3.39. Fails 4.5 on every wallpaper. Restored on hover and `:focus-within` only.
- Disabled Approve (during the stamp, `companion.css:703-706`): white on 45% stamp **2.60**; disabled Speak ink-2 **2.08**.
  Exempt from SC 1.4.3 but this is the 1.5s during which she is told it was recorded.
- Input and ghost-button boundary `rgba(10,18,20,.2)` on white / paper: **1.55 / 1.54** (`companion.css:1313`, `:1532`),
  below the 3:1 a control boundary needs (SC 1.4.11).

Main, both themes (`app.css:29-127`): every text token pair passes 4.5 on background, card and raised in both themes
(dark `--muted-foreground` 10.09 / 8.95 / 7.43; light 7.73 / 8.51 / 8.98). Exceptions: light `--status-success`
**4.42** and light `--status-neutral` 4.58 (ok) on `--recessed`; light `--accent` `#0891b2` is 3.17-3.68 everywhere
(no CSS reads `var(--accent)`, 0 uses); dark `--muted` is 4.59 / **4.07** / **3.38** on bg / card / raised but is only
used as a border (`app.css:831`), so fine. Focus ring light `#0e7490`: 4.61 on bg, 4.32 on recessed (>= 3). Card
borders 1.34 to 2.20, decorative.

Type: the floor is exactly 12px (`companion.css:60`; grep over every stylesheet finds no size below 12px / 0.75rem).

## Reduced motion (criterion 5), executed by reading both blocks

Companion block `companion.css:1421-1439` sets duration 1ms and **iteration-count 1** on `.aw *`, kills
`.aw-paper.enter` (`:1429`), freezes `.wave b`, and replaces the pulsing rim with a static ring (`:1436`). The
earlier token block `:96-103` shortens the tokenised durations. Branches: unroll (killed), tear (1ms, ends
transparent, fill `both`), ring-breathe 7s / dot-attn / rim-attn / dot-next / stamp-breathe / feed / wv (all one
1ms iteration, rest at their base style), thump and stamp-down (1ms). **Clean in all 7 forms.** The JS timers
(900ms tear, 1500ms settle, `machine.ts:40-42`) are sequencing, not motion. Main block `app.css:1144-1149` sets only
duration, not iteration-count; the only infinite animation is `ptt-pulse` (`app.css:928,933`), whose component is an
orphan, so it is not reachable today.

## Esc matrix (criterion 6), run in vitest against the real reducer (`scratchpad/ana.test.ts`)

| Form | Esc result | Destructive? |
|---|---|---|
| seal | unchanged | no |
| tape | unchanged | no |
| hear | unchanged | no |
| slip (card waiting) | -> seal, `snoozed=true`, card still waiting, announced | no |
| slip while stamping | ignored (`machine.ts:338`) | no |
| welcome | -> seal, `onboarded` NOT set, Main stays hidden | no, but strands (ana-15) |
| ledger | -> auto (seal, or slip if a card waits) | no |
| tab | unchanged (peek closes if open) | no |
| text field focused | blurs the field only (`live.tsx:172-175`) | no |

Every branch is defined and non-destructive. Clean.

## 150% scaling of the named sizes (run: `scratchpad/ana.test.ts`, taskbar 48 logical px)

Sizes are logical (`companion.rs:52-60`), the webview content is CSS px, so scaling does not change the ratio of
content to window; what changes is the logical work area. The overflow cases, all from the run:

| Screen | Scale | Logical work h | Over |
|---|---|---|---|
| 1366x768 | 125% | 566 | ledger 656 |
| 1366x768 | 150% | 464 | ledger 656 |
| 1366x768 | 175% | 391 | welcome 432, ledger 656 |
| 1280x720 | 125% / 150% | 528 / 432 | ledger |
| 1600x900 | 150% | 552 | ledger |
| 1920x1080 | 150% | 672 | none (ledger fits by 16px) |
| 1920x1200 | 175% | 638 | ledger |
| 2560x1440, 3840x2160 at 150% | | 912 / 1392 | none |

seal 92, tape/hear 92 tall, slip 316 and tab 96 fit everywhere computed. When nothing fits, `place` slides the window to
`work.y` and the bottom is lost (`companion.rs:171-174`), so the composer is off-screen. Main is the larger problem:
`inner_size(1440, 900)`, `min_inner_size(900, 600)`, `.center()` (`lib.rs:283-287`) exceed a 1920x1080 work area at 125%
(1536x816) by 84px and at 150% (1280x672) by 160px wide and 228px tall.

## Walk (in character)

**J2.** Rest: the seal is a labelled button, "Athena. Resting. Nothing is waiting on you. Press Enter to open the
ledger." (`model.ts:365`). I can summon with Ctrl+Shift+Space and put her away with Alt+F4 in her window (non-destructive,
`companion.rs:493-496`). I cannot move or dock her; the drag is a pointer gesture (`lib/companion.ts:128-155`). At rest she
dims to 55% after 45s (`machine.ts:34`), which is below 3:1 on any wallpaper for the 12px caption. Where she sits at 150%:
her seal is anchored bottom-right (`companion.rs:436`), the slip fits, the ledger does not on small laptops.

**J3.** Card arrives (visible): slip unrolls, ring pulses 10s then holds (static under reduced motion), `say` announces
"A decision is waiting on you. Press A to approve, D to decline." through `role="status"` (`views.tsx:87`), but that region
is re-created on every sentence (`key=say-n`), the sentence carries no action, recipient or parameters, and the window has
no focus. A/D only work once she is focused (`live.tsx:194`); Ctrl+Alt+A/D work from anywhere. Card arrives (hidden): the
reducer's own test shows `hidden -> cards(hidden) -> summon` ends at `form=slip, snoozed=false, focus:approve`, because Rust's
`show()` always calls `set_focus` and emits `athena:summon` (`companion.rs:589-591`). That contradicts ADR 0026 ("does not open
the slip over the user's work") and it puts focus on Approve with a bare `a` as the approve key. Answer: A, D, click or chord;
the stamp is announced once ("Approved. Stamped and sent to the record."), the slip tears at 900ms, settles at 1.5s; focus
is lost when the Approve button is disabled and when the slip unmounts.

**J5.** Main: bar items, pill, theme toggle, window buttons all have `.focus-ring`; the ring's top 4px is clipped on the
full-height bar buttons. Browser with a tab open: the chrome webview is the 76px band, but the registration ledger and its
inputs sit after the strip in DOM order and stay focusable (ana-11). Nothing moves keyboard focus into the page webview
(ana-12). Theme toggle labelled "Switch to light theme"; the Athena window stays dark housing and light paper by design.
Closing Main quits the app and its label says "Athena stays", which is false (ana-13).

## Time saved (designed experience, this Character)

Manual 50 min per weekly pass; the Character file's target is 20. From the code as designed I credit **about 12
minutes per pass, confidence 0.35**: the decision card (the repetitive part) is answerable by keys and by chord, which is
worth roughly 8 minutes; the rest of the saving depends on reaching and operating the real app pages by keyboard, which this
build does not demonstrably support. If ana-12 and ana-11 clear at L2 the credit rises toward 25.

## In my own voice

I would not adopt it yet, and I would watch it closely before I told a peer. The thing I came for is the card, and the card
is mostly right: the action in a box, GATED as a word, a 15px body, 17px title, dark ink on paper at 16.9 to 1, and a focus
ring that is a real two-pixel line with a white halo, not a guess. A and D answer it, there is a chord for when I am in
another window, and Escape never does anything I would regret. I checked every branch of that and I could not break it.

But "looks right" is not "tells me". When a card arrives she says one flat sentence in a region that is rebuilt every time,
in a window that does not have focus, and the sentence does not name the action or the recipient. I would be approving a
chord I cannot see the reason for. When she was hidden she does the opposite and grabs focus and sits it on Approve, where
the letter A is the key. If I am typing an email in another window when that happens, a stray "a" or "d" answers a gated
action. The product says it will not open the slip over my work. The code says it will.

Then there is the rest of my day. I cannot move her; there is no key for it. At rest she dims until her words are
two-and-a-half to one against a bright window, exactly when I am looking past her in sunlight. Main opens at 1440 by 900,
which on my 1080p laptop at 150% is bigger than the screen, so the bar with the window buttons may be where I cannot see it.
In the Browser, Tab walks me out of the strip into controls that are not drawn, and nothing walks me into the page. I would
tell a peer it is a careful, honest card with a keyboard that stops at the card.

## What is missing for my job

A key to dock, undock and put her away. A live announcement that names the action, the app and the first parameter. Focus
that returns somewhere sensible after the slip tears. A way into the page from the keyboard. A fixed Main size that fits a
work area at 150%. A high-contrast rule. A dim that never drops below 4.5.
