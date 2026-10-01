# 0026. Athena is her own window, and Main is the workhorse beside her

Date: 2026-09-30

Supersedes the *one window* half of [0013](0013-module-first-window.md) and the *chrome-only* half
of [0020](0020-push-to-talk-is-a-held-key-in-the-chrome-and-a-spoken-turn-lands-in-the-panel.md).
Everything else in both stays.

## Context

The shell is one full-rectangle window (0013): a 36px module bar, one module at full width, the
browser as one module among four. Two design contests were run against it (the `athena-brand-landing`
and `athena-windows` contests, then a three-seat reveal). The owner's verdict on the first was that
every variant "struggle[s] to leave concept of web app design, it just degraded components into
practices older desktop apps use", and the vision that replaced it was: **full app size for browsing
the web and setup, and for communication with Athena a plugin with standalone life, like old Winamp
plugins.** The owner then chose *The Countersign* from the reveal: Athena as a small housing with a
round seal, paper for work, a slip for a decision, a stamp to sign it.

The impact analysis given before the contest named four costs; this record answers each:

1. *0013 is superseded.* It chose one privileged webview so the app-wide stores live in one React
   tree. Two webviews are two JS contexts.
2. *Transparent windows on Windows.* Transparent pixels still take clicks; a drawn silhouette is not
   a hit-test.
3. *The Browser module's page area is a native child webview.* Nothing of Athena can be drawn inside
   it, so she has to be a sibling window on top.
4. *Skins cost maintenance.* Light theme and accessibility are harder on non-standard shapes.

## Decision

### Two windows, one product

| | `main` | `athena` |
|---|---|---|
| What | the chrome webview and one page webview per tab (0013, unchanged) | one privileged webview, `athena.html` |
| Modules | **Browser, Connectors, Setup** | none: a surface of named states (below) |
| Shape | a rectangle, 900x600 minimum | a transparent, frameless window whose rectangle hugs its drawing |
| Lives | while the user works in it | over Main **and over other applications**; off the taskbar; tray-owned |

The Athena module leaves Main. The conversation, the decision cards, the record and the voice key
live in her window. Main keeps a one-line **status pill** ("Athena is resting" / "1 waiting" / the
step she is on) that summons her.

### Named states, and Rust owns the sizes

The page never sends a size; it sends a *name*. The table is Rust's (`companion.rs`), because a size
the page can choose is a size a foreign page's script could ask for through a bug:

| name | w x h | when |
|---|---|---|
| `seal` | 92x92 | rest |
| `tape` | 440x92 | working |
| `hear` | 440x92 | listening, no card |
| `slip` | 488x316 | a card waits |
| `welcome` | 488x432 | first launch |
| `ledger` | 488x656 | expanded: Talk, Record, Origins |
| `tab` | 28x96 | docked to a screen edge |

**The seal is the anchor of every resize.** Its screen rectangle stays fixed; the window grows out
of it (8px shadow margin on every side except `tab`). `side` is the window edge the seal sits on
(`left`: seal top-left at window (8, 8); `right`: seal's right edge at window.right - 8) and `valign`
is the edge it sits on vertically (`down`: seal at the top; `up`: seal at the bottom). **Rust
chooses the orientation**: it prefers the side the user snapped toward, flips when the rectangle
would leave the monitor's work area, and slides the smallest distance if neither fits, then tells
the page with `athena:orient`. Growing is sent immediately, shrinking 380ms after the paper has torn
away (the page's timing, not Rust's); nothing is ever sent on hover.

### The IPC contract (every name below is also in `build.rs` and a capability)

Commands, all `rename_all = "snake_case"`, granted to the `athena` window and, where marked, to `chrome`:

| command | from | does |
|---|---|---|
| `athena_set_size {name, side, valign}` | athena | validates `name` against the table, resizes around the seal, emits `athena:orient` if the orientation changed |
| `athena_show {}` / `athena_hide {}` | athena, chrome | show/hide the window. Hide stops drawing, not listening: daemon events still arrive |
| `athena_pin {on}` | athena | always-on-top |
| `athena_report {state, cards, line}` | athena | what she is doing, for the tray dot, the chords and Main's status pill |

Events (`ui_emit` now reaches **every privileged label**, `chrome` and `athena`, and still never a
page webview, because `daemon:status` carries the token):

| event | to | payload |
|---|---|---|
| `athena:orient` | athena | `{side, valign}` |
| `athena:snap` | athena | `{to, docked}`; `to` is `main.right \| main.left \| main.corner \| screen.left \| screen.right \| free`, `docked` is `left`, `right` or `null` |
| `athena:summon` | athena | `{cards}`: the tray, `Ctrl+Shift+Space` or the status pill; with `cards > 0` she opens at `slip` with focus on Approve |
| `athena:chord` | athena | `{kind: "approve" \| "decline"}` |
| `athena:status` | chrome | `{state, cards, line, visible}` |
| `store:changed` | both | `{table, key}`: settings, origins and connectors re-read, so the theme and the engine cannot disagree across windows |

**Snapping is Rust's, from native drag.** The page calls `startDragging` (after a 4px pointer move,
swallowing the trailing click, because a drag region can swallow the click in WebView2). Rust watches
`Moved`, treats 180ms of quiet as a drop, and decides `snap`: near Main's edge or corner, near a
screen edge (then the window becomes a `tab`), or free. A `main.*` snap follows Main when it moves or
resizes. Dragging a tab away from the edge is `free` and the page grows a seal.

### Who runs which store

The day-zero rule of 0013 stands: a store a *view* starts stops being true. What changes is that the
app root is now two roots.

| store | `chrome` | `athena` | why |
|---|---|---|---|
| shell (module, theme), connectors | yes | no | Main's |
| tabs, tools, daemon, settings, origins | yes | yes | mirrors of Rust events or of the daemon; two mirrors cannot disagree |
| run, voice | no | **yes** | the turn, the cards and the microphone have one owner |

`store:changed` is what keeps the two settings mirrors honest. The page tools a turn needs
(`bridge_call` on the focused tab) are commands the `athena` window is granted.

### Hide means put away, not mute

A card arriving while she is hidden brings her back as her quiet home form (`seal`, or `tab` when
docked) with a pink ring and a count, and **does not open the slip over the user's work**. The tray
icon carries the dot. The window is hidden with `hide()`, never destroyed, so the run loop and the
SSE stream keep running (see Risks).

### Keyboard, voice, mouse (the card, without Main)

With her window focused: `A` approve, `D` decline, `Esc` puts the slip away (it stays waiting),
`Esc` again from the ledger closes it. **Global chords, registered only while `cards > 0`:**
`Ctrl+Alt+A`, `Ctrl+Alt+D`. Always: `Ctrl+Shift+Space` (show / summon). This is the one place 0020's
"not an OS-global shortcut" is relaxed, and only for the moment a person is being asked something.
Push-to-talk stays a held key in her window.

### First launch

`settings.onboarded` is false: only `athena` is shown, at `welcome`; `main` is created hidden.
"Open your first app" sets `onboarded`, shows Main on the Browser module and lets her settle on
Main's right edge as a seal.

### Identity

The Countersign's `tokens.css` becomes the app's token sheet for both windows, on the personas
teal palette. **Teal is the machine's world; paper and one pink ink are the human's.** The pink is
`--role-human` and nothing else in the product is that pink. The housing and the paper are physical
objects and do not change with the theme (they read on a light or a dark wallpaper); Main does.

## Consequences

- `layout.rs` keeps its arithmetic for `main` and gains a sibling `companion.rs` with its own pure,
  tested arithmetic (placement around the seal, orientation, snapping). Adding a state is a row in
  one table plus its drawing.
- `MODULE_ENTRIES` is `[browser, connectors, setup]`. The panel's model and fixtures move with the
  conversation into the Athena surface and keep their tests.
- `ui_emit`'s guarantee is restated, not weakened: privileged labels only.
- A second webview is a second memory and startup cost.

## Risks (each is measured or named in the commit that lands it)

- **A hidden WebView2 may throttle timers.** The SSE stream and the run loop must survive a hide;
  the smoke run checks a turn streams while hidden.
- **Transparent windows take clicks across their transparent margin.** The design answers it by
  construction (rectangle hugs drawing, 8px margin, no state relies on click-through).
- **The drop shadow is a CSS filter on an integrated GPU.** Measure before shipping; the fallback is
  an opaque 1px ring.
- **A window cannot be drawn inside a child webview.** This is why she is a sibling window, and why
  the page area of Browser stays someone else's.
- **What the real window (WebView2, debug build, fresh store) has shown.** First launch shows only
  the 488x432 `welcome` window, transparent and frameless, with Main hidden. "Open your first app"
  shows Main and docks her to its right edge (her window starts exactly at Main's right edge).
  Driving `athena_set_size` through the real IPC grew her around the seal: `tape` and `slip` keep the
  seal's right and bottom edges fixed, `ledger` flipped downward because it would have left the work
  area, an unknown state name is refused, and hide then show round-trips. Main's pill read "Athena is
  resting" from `athena:status`, so the cross-window event path works.
- **Not yet shown in the real window:** a real native drag to a snap and to a screen-edge tab; the
  global chords firing; the tray dot; a turn streaming while she is hidden; 125% and 150% display
  scaling; the drop-shadow cost on an integrated GPU. A freshly shown Main was not raised above a
  topmost fullscreen window (Windows foreground rules); `companion::raise` uses the topmost toggle and
  that is not enough against a window that is itself topmost, which is acceptable: she is the one that
  floats over other applications.
