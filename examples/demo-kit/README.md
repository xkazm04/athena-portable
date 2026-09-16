# `@athena/demo-kit`

The shared scaffold for the three example host apps (`ledgerbox`, `hirelane`, `tidycrm`; ADR
0017). They ship **without** Athena: each registers its capabilities on `document.modelContext`
(WebMCP) so an agent beside the page can read them through `packages/athena-bridge`. One scaffold
means the apps differ in domain, not plumbing, and one seed registry means they are one studio.

## No build step

The package ships **TypeScript source**. Each app sets `transpilePackages: ["@athena/demo-kit"]` in
`next.config.ts` and Next compiles the kit alongside the app. There is no `dist/` and an edit to a
kit file hot-reloads in a running app. `pnpm --filter @athena/demo-kit typecheck` runs
`tsc --noEmit` over the source and the kit's own `node --test` suite as a standalone gate.

## Import paths

| Path | Side | Exports |
|---|---|---|
| `@athena/demo-kit/db` | server | `openDb`, `defaultDbFile`, `getMeta`, `setMeta`, types `Db`, `OpenDbOptions`, `SqlValue`, `SqlParams` |
| `@athena/demo-kit/activity` | server | `createActivityTable`, `ACTIVITY_SCHEMA`, `logActivity`, `listActivity`, `getActivity`, `undoActivity`, types `ActivityEntry`, `NewActivity`, `Actor` |
| `@athena/demo-kit/activity/ui` | client | `ActivityLog`, `relativeTime` |
| `@athena/demo-kit/webmcp` | client | `useWebMCPTool`, `annotationsFor`, `useZoomTools`, `bounded`, `boundedPage`, `PAGE`, `ensureModelContext`, `detectModelContext`, and the types |
| `@athena/demo-kit/ui` | client | `AppShell`, `DataTable`, `DetailPane`, `EmptyState`, `ToastProvider`, `useToast`, `ThemeVariantSwitcher`, `useThemeVariant` |
| `@athena/demo-kit/ui/demo-kit.css` | css | the `--dk-*` themed stylesheet; `@import` it once from the app's globals.css |
| `@athena/demo-kit/zoom` | client | the model: `useZoomNav`, `useStaticNav`, `navReducer`, `initialNavState`, `HOME`, `nodeId`, `sameFocus`, `escapeLeavesLevel`, `escapeAbortsFlight`, `MODAL_SELECTOR`, types `ZoomNav`, `Focus`, `Level`, `NavState`, `NavAction`, `EscapeEvent` |
| | | the formula: `useLevelFlight` (+ `advanceFlight`, `settleFlight`, `isMoving`, `initialFlight`, `FLIGHT_FALLBACK_MS`, `ARMING_FLIGHT`), `emphasis`, `presenceOf`, `presenceStyle`, `PRESENCE_DEPTH`, `useSharedIdentity`, `sharedIdentity`, `UNCLAIMED`, `useTokens`, `cssMs`, `cssEase`, `parseMs`, `parseEase`, `parseBezier`, `readTokens`, `styleOf`, `tokenValue`, `secs`, `useOverlayEscape`, `escapeClosesOverlay`, `focusReturnTarget`, `isOpener`, `useRoving`, `rovingIndex`, `isRovingKey`, `ROVING_KEYS`, types `LevelFlight`, `FlightState`, `Presence`, `PresenceOpacity`, `SharedIdentity`, `TokenValue`, `StyleSource`, `OverlayEscape`, `FocusPreference`, `Roving`, `RovingOptions` |
| | | the camera (round 3): `useCameraRig`, `REST_POSE`, `clampPose`, `zoomAt`, `stepInertia`, `nearestSnap`, `orbitDelta`, `panDelta`, `poseToTransform`, `mergePose`, `lerpPose`, `samePose`, `poseDistance`, `angleDelta`, `isNegligible`, `easeFromCss`, `FLY_MS`, `FLY_EASE`, `FRAME_MS`, `NEGLIGIBLE`, `ORBIT_SENSITIVITY`, `SNAP_WEIGHTS`, `ZERO_VELOCITY`, `WHEEL_SENSITIVITY`, `KEY_ORBIT`, `KEY_PAN`, `KEY_ZOOM`, `SNAP_IDLE_MS`, types `CameraPose`, `CameraBounds`, `CameraVelocity`, `CameraFrame`, `CameraRig`, `CameraRigOptions`, `CameraBind` |
| | | semantic zoom: `useSemanticZoom`, `levelForZoom`, `bandProgress`, `SEMANTIC_HYSTERESIS`, types `SemanticZoom`, `SemanticZoomOptions`, `SemanticNav` |
| | | the echo (rule 1): `useEcho`, `echoStages`, `echoOrigin`, `echoOriginVars`, `echoDirection`, `echoKey`, `levelChanged`, types `EchoState`, `EchoOptions`, `EchoHandle`, `EchoDirection`, `EchoOriginUnit`, `RectLike` |
| `@athena/demo-kit/zoom/echo` | client | `Echo`, `ECHO_GRACE_MS`, type `EchoProps` — the component alone, on its own entry so the `zoom` barrel stays a `.ts` module that `node --test` can load |
| `@athena/demo-kit/seed` | any | `Rng`, `rngFor`, and the shared world: `STUDIO`, `COMPANIES`, `companyByName`, `companyByDomain`, `companyDomain`, `KESTREL_APPLICANT`, `PINEGROVE_ALIAS`, `QUIET_CLIENT` |
| `@athena/demo-kit` | any | types + pure functions only (`classifyTool`, `parametersToJsonSchema`, `registryName`) |

`db` and `activity` import `server-only`: importing them from a `"use client"` file is a build
error, on purpose. Share row shapes through the app's own `lib/types.ts`.

## The shared world (`seed/companies.ts`)

The three apps are Halden Studio's books, pipeline and contact list. `STUDIO` names the studio,
its domain, its owner and the inbox its mail goes out from. `COMPANIES` is the studio's fifteen
clients, each with a `domain` on `.example` (the key that joins the apps) and one billing
`contact` whose name, title and email are the same string in every app that shows them. The named
people and aliases (`KESTREL_APPLICANT`, `PINEGROVE_ALIAS`, `QUIET_CLIENT`) are the threads the
four-act demo pulls on; the file's comment says which act uses which. A seed reads these; it never
generates its own version of them.

## The WebMCP layer

`useWebMCPTool` registers one capability with the page's own `reversible` / `sideEffects` claim.
The claim is carried two ways: as the standard annotations (`readOnlyHint`, `consequentialHint`)
a native browser preserves, and as an `athena` block for a consumer that reads it. The class is
derived by the consumer (`packages/athena-bridge/gate.js`, `flagsOf` then `classify`), and
`classifyTool` here states the same rule so an app can test its own manifest:
`reversible && side_effects !== "external"` is AUTO, everything else GATED, unknown is GATED.

`bounded` / `boundedPage` are the one truncation shape: `{ showing, of, items }` plus a
`(showing N of M)` footer. Every list a tool returns goes through them.

`zoom` is the three-level navigation model (L0 population, L1 group, L2 item) the shipped
directions share; `useZoomTools` offers it to an agent as `read_view` / `open_group` / `open_item`
/ `zoom_out` so those verbs mean the same thing on every surface.

## Camera and semantic zoom

Round 3 added the missing half of the formula: a **camera**. Round 1 and 2 gave the kit the
navigation MODEL and the clock; what every app still wrote by hand was the thing that makes a
level change read as a move — a pose, a wheel that closes in on what is under the pointer, and
the outgoing level carrying that move while the arriving one holds still.

`docs/kit-camera-contract.md` is the contract. Three pieces:

- **`useCameraRig(options)`** — the pose (`yaw`, `pitch`, `zoom`, `pan`), the inputs (drag,
  shift-drag, two-finger pinch, wheel anchored at the pointer, arrows, `+`/`-`, `Home`), inertia,
  snap-when-idle, and `flyTo` on a token-read duration. **It never re-renders its host.** The
  pose lives in a ref; `subscribe` is how a surface hears about it, and `rig.moving` is a getter
  so it is never stale.
- **`useSemanticZoom(nav, rig, options)`** — camera distance IS the level. Cross a band and the
  hook dispatches `nav.openGroup` / `openItem` / `up`, so a wheel and a click and an agent tool
  all go through the one model. When the nav moves for any other reason it flies the camera to
  `poseFor(focus)`. A `driving` ref stops the two from echoing each other.
- **`useEcho(nav, flight, …)` + `<Echo>`** — rule 1, at last, as a primitive.

### A DOM scene

```tsx
import { poseToTransform, useCameraRig } from "@athena/demo-kit/zoom";

const rig = useCameraRig({ bounds: { zoom: [0.6, 12] }, drag: "pan", flyToken: "--dk-dur-move" });
useEffect(() => rig.subscribe((p) => { stage.current!.style.transform = poseToTransform(p); }), [rig]);

<section {...rig.bind} ref={setScene}>      {/* takes pointer, wheel, keys */}
  <div className="stage" ref={stage}>…</div> {/* transform-origin: 50% 50% */}
</section>
```

One element carries the transform, written straight onto `style` — sixty frames a second through
React state is the motion-cost score round 1 paid for. `transform-origin` must stay at the centre:
`zoomAt` solves for a pan that keeps the point under the pointer fixed, and it solves it about the
middle of the box. `perspective` belongs on the PARENT of the stage, not on the stage itself.

### A WebGL scene

```tsx
import { useCameraRig, type CameraPose } from "@athena/demo-kit/zoom";
// in the app, not the kit:
import { useFrame } from "@react-three/fiber";

const rig = useCameraRig({ bounds: { zoom: [1, 40] }, drag: "orbit", snap: FACES });
useFrame(({ camera }) => {
  const p = rig.get();                       // no allocation, no render
  camera.position.setFromSphericalCoords(RADIUS / p.zoom, Math.PI / 2 - p.pitch, p.yaw);
  camera.lookAt(p.pan.x, p.pan.y, 0);
});
```

`rig.get()` in the render loop, and the app decides what four numbers mean in its own world —
orbit radius, dolly, an orthographic frustum. **The kit never imports `three` or `@react-three/*`,
and nothing under `zoom/` ever will.** That is the only reason one camera can serve a swimlane, a
kanban, a cube and a map: the two consumers of a pose are `poseToTransform` and the app's own
`useFrame`, and neither of them is in the other's build.

Rule 9 still applies on the WebGL side: subscribe to `rig` and invalidate on change rather than
running a permanent loop, and a settled scene draws zero frames.

### The echo

```tsx
const flight = useLevelFlight(nav, { fallbackToken: "--dk-dur-move", el: () => scene.current });
const { echo, liveProps } = useEcho(nav, flight, {
  container: () => scene.current,
  measure: (of) => document.querySelector(`[data-group="${of.group}"]`)?.getBoundingClientRect() ?? null,
});
…
{echo ? <Echo key={echo.key} echo={echo} className="echo">{/* id-free copy */}</Echo> : null}
```

`<Echo>` is inert, `aria-hidden`, takes no pointer, renders its children once, and sets
`--echo-ox` / `--echo-oy` (the measured middle of the node being left, **as a percentage of the
container** by default; `{ origin: "px" }` for pixels) plus `data-direction="in" | "out"`. The
move itself is the surface's own CSS, in its own tokens. The echo settles the flight on its
`animationend` / `transitionend`, with a timeout at the flight's own budget so a missing
`@keyframes` cannot strand a move forever — and a change that gets NO echo settles itself within
a frame instead of pretending to move.

## The formula in the kit

`docs/layered-ui-formula.md` §1 is the nine rules that survived round 1. Round 1 also ended with
all three apps asking for the same five primitives, each having built its own — so this is where
each rule now lives. A rule marked *app-side* is one the kit cannot hold: it is about what a
surface draws, and the kit deliberately ships no chrome.

| Rule (§1) | In the kit |
|---|---|
| 1. The level you leave carries the camera; the level you arrive at carries the continuity | **Both halves are now primitives.** `useLevelFlight` says *when* (`from` / `to` / `moving` on the frame the level changes); `useEcho` + `<Echo>` are the *what* — the inert, id-free outgoing copy, the origin measured before the change, the direction, and which changes get one. `useCameraRig` is the camera itself and `poseToTransform` puts it on a DOM stage. What the move LOOKS like is still app-side, through `--echo-ox` / `--echo-oy` and `[data-direction]`; `template/app/globals.css` is the shape. |
| 2. One claimant per shared id | `useSharedIdentity(id, owns)` / `sharedIdentity` — `layoutId` only when it owns, and a `key` that flips with ownership so motion re-reads the id (it reads `layoutId` only at mount). |
| 3. Box, then ink | App-side. Staging is a design decision about what the surface is made of; the kit gives it the clock (`useTokens`), the completion signal (`settle`), and — round 3 — `liveProps`' `[data-arriving]` on the layer that is arriving, which is the selector the second beat waits on. |
| 4. One clock per level change, in one module | `useTokens` / `cssMs` / `cssEase` / `parseMs` / `parseBezier` / `secs` — JS reads the `--*` tokens and never types a millisecond. |
| 5. An overlay owns its own Escape and returns focus to its opener | `useOverlayEscape` — `onKeyDown` for the dialog root (Escape → `preventDefault` + close, which is what keeps the kit's window rule out, see `zoom/escape.ts` rule 1) and focus back to the opener, or to `returnFocusTo()`, on unmount. `prefer: "origin"` flips the two for a pane that grew out of a card. Arrow keys within a level are `useRoving(ref, { selector, columns? })`. |
| 6. A move in flight is abortable | `escapeAbortsFlight` + `nav.abort()` + `nav.setMoving` — the nav's own listener aborts to the focus the move left instead of stepping up out of a level nobody arrived at. `useLevelFlight` keeps `setMoving` current, so an app that uses it gets this for nothing. |
| 7. Presence comes from the model | `emphasis` (the model's answer) and `presenceOf` / `presenceStyle` (the one mapping to opacity and scale: `opacity = e`, `scale = 1 − (1 − e)·0.06`). |
| 8. Reduced motion lands on the final state at frame zero | App-side, but cheap: an unreadable or zero token reads as `0`, which is the final state — never a `0.01ms` animation. |
| 9. What is no longer seen stops costing | App-side, and now cheaper to obey: the kit is renderer-free by design (no `three` import anywhere under `zoom/`), and `useCameraRig` renders nothing at all — the pose is a ref, inertia stops the moment a frame would move nothing visible (`isNegligible`), and `subscribe` is what a renderer invalidates on. A settled scene draws zero frames. |

Everything that can be wrong is pure and pinned under `node --test`: `flight.ts`, `presence.ts`,
`identity.ts`, `tokens.ts`, `overlay.ts`, `escape.ts`, `state.ts`, and round 3's `camera.ts`,
`semantic.ts`, `echo-rule.ts`, `roving.ts`. A pure module imports only TYPES across files —
node's ESM resolver wants a file extension on a value import, and the kit would rather have the
rule pinned than the import shared. The hooks are thin wrappers, and
`template/components/Levels.tsx` is a skeleton that uses all of them, camera included.

## Signatures

```ts
openDb(appId: string, opts: { file?: string; seed: (db: Db) => void }): Db
// Db: { appId, file, raw, exec, all<T>(sql, params?), get<T>(sql, params?),
//       run(sql, params?): { changes, lastInsertRowid }, withTx<T>(fn), close() }

logActivity(db, { actor: "user"|"athena"|"system", action, target, summary,
                  reversible?, undo?, ts? }): ActivityEntry
listActivity(db, limit = 50): ActivityEntry[]
undoActivity(db, id, applyUndo: (db, entry) => void): { ok, reason?, entry? }

useWebMCPTool({ name, description, parameters?, reversible, sideEffects, handler, deps?, available? })
annotationsFor({ reversible, sideEffects }): WebMCPAnnotations
classifyTool({ reversible, side_effects }): "AUTO" | "GATED"
bounded(items, cap): { showing, of, items, footer }

useLevelFlight(nav, opts?: { fallbackToken?: string; fallbackMs?: number; el?: Element | null })
  : { from: Focus; to: Focus; moving: boolean; flight: number; settle(flight?: number): void }
presenceStyle(e: number, opts?: { depth?: number; floor?: number }): { opacity, scale }
presenceOf(focus, group, item = null, opts?): { opacity, scale }
useSharedIdentity(id: string, owns: boolean): { layoutId: string | undefined; key: string }
useTokens(names: readonly string[], el?): Record<name, { raw: string; ms: number; ease: string }>
cssMs(name, el?, fallback = 0): number        // "260ms" | "0.26s" -> 260
cssEase(name, el?, fallback = ""): string
useOverlayEscape({ onClose, returnFocusTo?, prefer? }): { onKeyDown }
escapeAbortsFlight(event, moving: boolean, level: number): boolean   // ask AFTER escapeLeavesLevel
useRoving(ref, { selector: string; columns?: number | (() => number) }): { onKeyDown }

useCameraRig({ bounds, initial?, drag?, wheel?, inertia?, snap?, keyboard?, reducedMotion?,
               flyToken?, easeToken?, sensitivity? })
  : { get(), set(partial), flyTo(partial, { ms?, onDone?, onCancel? }): cancel, reset(), subscribe(cb),
      moving, bind }
poseToTransform(pose, { perspective? }): string
zoomAt(pose, factor, anchor: {x,y}, frame: {w,h}): CameraPose   // anchor is frame-relative px
useSemanticZoom(nav, rig, { bands, resolveGroup, resolveItem, poseFor, hysteresis?, flight? })
  : { level, driving }
levelForZoom(zoom, bands, hysteresis = 0.08, current: Level = 0): Level
useEcho(nav, flight, { measure, stages?, container?, origin? })
  : { echo, liveProps }
<Echo echo={echo} className?>{children}</Echo>
```

## Template

`template/` is a working copy of the scaffold. It is deliberately not a workspace package. See
`template/README.md` for the copy-and-rename checklist.

## Gotchas

1. **`node:sqlite` rows have a null prototype.** Passing one straight to a client component throws
   *"Only plain objects ... can be passed to Client Components"*. The kit's `all`/`get` already copy
   every row into a real object; if you reach for `db.raw.prepare(...)` yourself, copy it too.
2. **Turbopack traces dynamic filesystem paths.** `path.resolve(process.cwd(), someVar)` makes the
   build pull the entire project into the server bundle. Keep paths statically scoped, as
   `defaultDbFile` does with `join(process.cwd(), "data", ...)`.
3. **`next dev` writes `AGENTS.md` / `CLAUDE.md`** into the app directory unless
   `agentRules: false` is set in `next.config.ts`. The template sets it.
4. **Node prints `ExperimentalWarning: SQLite is an experimental feature`** on every build and boot.
   Expected on Node 24; not an error.
5. **The database is resolved from `process.cwd()/data`.** A test that wants a fresh seed changes
   directory to a scratch folder before importing `lib/db`; the journey runner boots each app in a
   scratch cwd for the same reason.
