# Porting a depth

README section 3.5; ADR 0087, 0089, 0090. How a module's view becomes a depth scene, and the bar
the result is held to. Read `fathom.md` (the plan) and `parity.md` (what must survive) first.

## What you are doing

A depth is one of Apps, Chores, Accounts, Voice, Mind. Today each is a module: a model, fixtures, a
pure view and an index that knows the stores. You write a **scene** for it: the same behaviour, drawn
for the stage. **The module's model, selector, fixtures and tests stay**; you replace its view. The
old view keeps working (the bridge in `console/scenes.tsx` draws it) until your scene is in.

Reference scenes, written to this bar: `src/scenes/surface/` (a model, a view, fixtures, an index)
and `src/scenes/waking/` (a view over a module's own model, driven by that module's hook).

## The steps

1. **Extract the hook.** In the module's `index.ts(x)`, turn the body of `Live` into an exported hook
   (`useXModel()`) that returns the model, and make `Live` render the old view with it. See
   `useSetupModel` in `modules/setup/index.ts`. Do not copy a selector; share it. If an action
   behaves differently in the console (it selects a module, it opens a Browser tab and selects the
   Browser), take the difference as an option on the hook (`afterFinish` is the example), because a
   Rust `browser` selection shows a page under a scene (ADR 0088).
2. **Write the scene** in `src/scenes/<name>/`: `view.tsx` (a pure function of
   `{ model, path, go }`; it may hold its own UI state such as what is hovered, never a fetch or a
   store), `<name>.css`, `fixtures.ts` (the module's own fixtures reused, plus the open states the
   old `initialOpenFor` expressed as paths), `index.tsx` exporting `entry: DepthScene`
   (`src/scenes/types.ts`) with `Live` (the hook, the view, `props.go`), `preview(fixture, props)`
   (a fixture, no store), `useLabeller` and `previewLabeller` for crumb names.
3. **Register it:** one line in `DEPTH_SCENES` in `console/scenes.tsx`. `PORTED` follows by itself.
4. **Preview it:** it renders at `preview.html?scene=<root>&fixture=<id>&at=%23/<root>/<item>`
   with no Tauri. Look at it, at 1920x1080, 1280x800 and (loosely) 390x844, in both themes.
5. **Gate it:** a `scripts/perf-<root>.drive.mjs` that performs the scene's one fixed path (hover,
   open an item, step through it, rise), a `perf:<root>` line in `package.json`, and the run
   passing (`pnpm perf:<root>`). Add the line to `perf:all`.
6. **Prove the parity rows:** every row of your depth in `parity.md` ends `proved: <test or hand
   check>`. A row you could not carry says `changed:` or `dropped:` and why, in the owner's words,
   and is raised, never hidden.
7. **Record it:** one CHANGELOG line (what, section, ADR, tests), an ADR only for a choice a later
   reader could question, and one commit: `feat(desktop): <what changed, as a sentence>`, a body
   naming the design section, the tests added and what was verified by hand.

## The levels

`depth/model.ts` fixes the grammar. Apps: `apps/<app>`, then `page` or `tool/<name>`. Chores:
`chores/<chore>`, then `run/<turn>`. Accounts: `accounts/<account>`, then `allowlist`. Voice:
`voice/studio` or `voice/settings`. Mind: `mind/engine|brain|look|data|mic`. A scene is told its
`path` and draws the level it names: the root is the field (an overview), the item is a composed
scene of its own, the sub-level is detail. Every level shows the way back (the stage does: Rise,
the breadcrumb, Escape), and an unknown id is the scene's to say (a not-found state), never a crash.

## The bar

- **The item under attention takes the dominant space.** A hovered or focused item's name is
  display type in the centre of the frame, not a caption under it (see the surface's marquee).
- **Art per item, drawn for it.** SVG in the app's tokens (never a literal colour, see
  `art/glyphs.tsx` for the family), labelled stylised wherever it could pass for the product.
  Stock icons alone are the anti-pattern. Put shared art in `src/art/`.
- **Capabilities are legible.** Nothing a person could do in the old module is missing, hidden
  behind hover only, or readable only by colour. Every control has a name, a focus ring and a
  keyboard path. Confirm-before-act stays: two presses to forget or disconnect, the writes gate,
  the records notice that cannot be dismissed, the gated badge. Honest copy stays verbatim.
- **Type.** Nothing under 12px at any width; reading text at 14px or more.
- **Colour.** Tokens and mixes of them (`color-mix`) only. Both themes must render from tokens.
- **Motion** (ADR 0089). `transform`, `rotate` and `opacity` only; no animated `filter`, no
  animated gradient, no layout property; **no script per frame** (the shared clock in
  `lib/motion.ts` is for the rare thing that must; most things are CSS). A settled scene asks the
  browser for no frames. `[data-motion="calm"]` turns every animation off and leaves the final
  state. Long lists use `content-visibility: auto` with `contain-intrinsic-size`.
- **Weight.** The depth is a lazy chunk where the console can make it one; no new dependency
  without a reason written in the ADR.
- **Quality.** Strict TypeScript, no `any`, comments that say why, a module docstring whose first
  lines name the design section it implements. No machine paths in committed files.

## The gate (run before claiming anything works)

```
pnpm typecheck && pnpm lint && pnpm test       # from apps/desktop
pnpm perf:all                                  # the budgets; every scene's own line
cargo check && cargo clippy --all-targets      # from apps/desktop/src-tauri, only if Rust changed
```

Report the output faithfully. A budget that is missed means the scene changes, not the budget.

## Shell notes

The Bash tool on this machine rejects long commands that mix heredocs, quotes and an apostrophe;
write files with the Write and Edit tools, and keep shell commands short.
