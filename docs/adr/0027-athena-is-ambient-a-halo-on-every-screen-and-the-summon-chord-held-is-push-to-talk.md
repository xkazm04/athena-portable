# 0027. Athena is ambient: a halo on every screen, and the summon chord held is push-to-talk

Date: 2026-10-07

Relaxes one sentence of [0026](0026-athena-is-her-own-window-and-main-is-the-workhorse.md):
*"Push-to-talk stays a held key in her window."* Everything else in 0026 stays, and the global
key this record adds is the one [0020](0020-push-to-talk-is-a-held-key-in-the-chrome-and-a-spoken-turn-lands-in-the-panel.md)
foresaw: it "registers the same `press`/`release` pair and nothing else changes".

## Context

0026 made Athena her own small window beside Main. The owner's next step was to make her feel
part of the PC rather than one more window: the screen's edges light up while she speaks, a key
held anywhere lets you talk to her with the same light showing that she hears you, and her
window is kept for what needs a click: a decision card, or a machine with no voice.

What the code had when this was written:

- Push-to-talk worked only while her window had the keyboard (a `keydown` listener in
  `stores/voice.ts`). The summon chord was global, but `hotkeys.rs` threw away key-up events,
  even though `global-hotkey` 0.8 reports them on Windows (it polls the main key every 50 ms).
- The voice socket, the microphone, the player and the run all live in the `athena` webview, and
  the daemon has no broadcast channel. Anything else that wants to show the voice state has to
  be fed from that webview.
- Nothing measured audio level anywhere.
- Transparent, topmost, off-taskbar windows were already shipping (her own window).
  `set_ignore_cursor_events` and the `WS_EX_*` styles needed no new dependency.

## Decision

1. **The halo is one overlay window per monitor.** Labels are `halo-<i>`; the page is
   `halo.html`, written in plain TS. Each overlay covers the monitor's full bounds, is
   transparent, undecorated, topmost, off the taskbar, cannot take focus, and is click-through:
   `set_ignore_cursor_events` plus `WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE |
   WS_EX_TOOLWINDOW`. It paints only a bloom at the screen edges and a faint two-line caption.
   - Rejected: four edge-strip windows (four webviews to keep in sync per screen, and corners to
     stitch).
   - Rejected: a native GDI/Direct2D painter (every visual tweak becomes a Rust rebuild).
2. **One producer, one shape.** The `athena` window reduces its stores to a `HaloSignal`
   (`lib/halo-signal.ts`: phase, level, cards, caption) and sends it with the `athena_halo`
   command. Rust sends it on as `halo:signal` to the `halo-*` labels only, through `ui_emit_to`;
   pages never get it. The overlays hold no socket and no store, and their capability is
   listen-only.
3. **Phase precedence:** listening > speaking > thinking > gate > idle. A waiting card shows as a
   pink breathing edge in any gap between turns, so a decision is never hidden by a quiet screen.
4. **Hues are the house palette, one per state:**
   - speaking: cyan, with depth following her voice level;
   - listening: pale cyan, rippling with the microphone level;
   - thinking: violet, moving slowly along the edge;
   - gate: `--role-human` pink.
   Rejected: a multi-hue aurora, and light anchored to the seal's corner.
5. **The summon chord, held, is push-to-talk.**
   - Tapping `Ctrl+Shift+Space` (released before 250 ms) summons her window, as before, but the
     summon now fires on release instead of on press.
   - Holding it past 250 ms sends `athena:ptt {down:true}` to her window, which calls the voice
     store's `press()`; releasing sends `{down:false}`, which calls `release()`. The same pair
     0020 named.
   - A voice turn started this way runs with her window hidden.
   - Rejected: a lone modifier through `WH_KEYBOARD_LL`, which is a keyboard hook security tools
     flag. Rejected: a global `Ctrl+Space`, which every IDE uses for completion.
6. **Her window is the fallback, not the stage.**
   - It shows, quietly, when a card is waiting (unchanged from 0026), when it is summoned, and
     when the chord is held with no voice backend, so the person sees why nothing is listening.
   - In a development build with no backend, holding the chord runs a *rehearsal*: the real
     microphone level while held, then a scripted thinking-then-speaking reply. The halo can be
     tuned without a provider key.
7. **Rest costs nothing.** At idle with no cards waiting, the overlays are hidden 4.5 s later (time for the last caption to fade).
   While visible, they animate only `transform`, `opacity` and `background-position`. Level
   frames are capped at 30 Hz and sent only while listening or speaking. Reduced motion gives a
   static glow.

## Consequences

- A tap on the summon chord now acts on release instead of on press: about one key-press of
  added latency.
- The first ~250 ms of a held chord are not recorded, because capture starts at the threshold.
- Release is seen only when Space comes up (the crate watches the main key only). Letting go of
  Ctrl first does not end the turn.
- Hiding her window during a voice turn depends on WebView2 not throttling capture or playback
  in a hidden window. This is verified by hand. If it does throttle, the fallback is to park the
  window off-screen at 1x1 instead of hiding it.
- A full-screen transparent WebView2 per monitor has a compositing cost while it is shown. Hiding
  at rest keeps that cost to the moments she is active.
- Monitors are counted once, at startup. A monitor plugged in later gets no halo until restart.
- New surface: one command (`athena_halo`), two events (`halo:signal`, `athena:ptt`), one
  capability (`halo.json`), one page (`halo.html`).
