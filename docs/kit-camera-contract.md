# The camera contract — round 3 of the layered-UI program

Frozen for round 3. The kit agent implements exactly this under `examples/demo-kit/src/zoom`
(exported from `@athena/demo-kit/zoom`); the four app agents code against it. Any deviation is
recorded in the kit's report and in each app's KIT-GAPS. Everything pure is node-testable; nothing
under `zoom/` imports `three` or `@react-three/*`.

## 1. Pose and bounds

```ts
export interface CameraPose {
  yaw: number;    // radians, rotation around the vertical axis
  pitch: number;  // radians, tilt; DOM surfaces may use only pitch/zoom/pan
  zoom: number;   // dimensionless scale, 1 = the resting frame
  pan: { x: number; y: number }; // in scene units (DOM: px at zoom 1; WebGL: world units)
}
export interface CameraBounds {
  yaw?: [number, number] | "free";
  pitch?: [number, number];
  zoom: [number, number];
  pan?: { x: [number, number]; y: [number, number] };
}
export const REST_POSE: CameraPose; // yaw 0, pitch 0, zoom 1, pan 0/0
```

## 2. The rig

```ts
export interface CameraRigOptions {
  initial?: CameraPose;              // default REST_POSE
  bounds: CameraBounds;
  drag?: "orbit" | "pan" | "none";   // default "orbit"; shift+drag pans when drag is "orbit"
  wheel?: "zoom" | "pan" | "none";   // default "zoom"; zoom is anchored at the pointer (zoomAt)
  inertia?: number;                  // 0..1 velocity retained per frame, default 0.9; 0 = none
  snap?: readonly CameraPose[] | ((pose: CameraPose) => CameraPose) | null; // applied when idle
  keyboard?: boolean;                // arrows orbit/pan, +/- zoom, Home = reset; default true
  reducedMotion?: "user" | "never";  // "user": flyTo lands on final state, no inertia
  flyToken?: string;                 // CSS token for flyTo duration, e.g. "--tc-dur-5"; default 420 ms
}
export interface CameraRig {
  get(): CameraPose;                                  // live pose, no render
  set(pose: Partial<CameraPose>): void;               // immediate, clamped
  flyTo(pose: Partial<CameraPose>, opts?: { ms?: number; onDone?: () => void }): () => void; // returns cancel
  reset(): void;
  subscribe(cb: (pose: CameraPose, moving: boolean) => void): () => void;
  moving: boolean;                                    // true during drag, inertia or flyTo
  bind: {                                             // spread on the scene's root element
    onPointerDown; onPointerMove; onPointerUp; onPointerCancel; onWheel; onKeyDown;
    tabIndex: 0; style: { touchAction: "none" }; "data-camera": "rig";
  };
}
export function useCameraRig(options: CameraRigOptions): CameraRig;
```

Pure pieces, tested: `clampPose(pose, bounds)`, `zoomAt(pose, factor, anchor: {x,y}, frame: {w,h})`
(zoom keeping the point under the pointer fixed), `stepInertia(pose, velocity, retain, dt)`,
`nearestSnap(pose, snaps)`, `orbitDelta(dx, dy, sensitivity)`, `panDelta(dx, dy, zoom)`.

Consumers: `poseToTransform(pose, opts?: { perspective?: number })` returns a CSS `transform`
string for DOM scenes (`perspective` is applied by the consumer's parent); WebGL scenes read
`rig.get()` in `useFrame` (or on `subscribe`) and set the camera themselves — the kit never
touches three.

## 3. Semantic zoom — camera distance is the level

```ts
export interface SemanticZoomOptions {
  bands: readonly [l1: number, l2: number];          // zoom thresholds: >= l1 → L1, >= l2 → L2
  resolveGroup(pose: CameraPose): string | null;     // which group is under the camera at this pose
  resolveItem(pose: CameraPose, group: string): string | null;
  poseFor(focus: Focus): Partial<CameraPose>;        // where the camera goes for a focus (click/tool path)
  hysteresis?: number;                               // fraction of a band to avoid flapping, default 0.08
}
export function useSemanticZoom(nav: ZoomNav, rig: CameraRig, options: SemanticZoomOptions): {
  level: Level;            // the level the camera implies right now
  driving: "camera" | "nav" | null; // who is currently leading
};
```

Behaviour: when the camera crosses a band by wheel/drag, the hook dispatches `nav.openGroup` /
`nav.openItem` / `nav.up` so tools, Escape, focus and the flight stay the single truth; when the
nav changes for any other reason (click, tool, Escape), the hook calls `rig.flyTo(poseFor(focus))`.
No loops: the hook marks which side is driving and ignores the echo of its own dispatch. Pure,
tested: `levelForZoom(zoom, bands, hysteresis, current)`.

## 4. The echo container (rule 1)

```tsx
export function useEcho(nav: ZoomNav, flight: ReturnType<typeof useLevelFlight>, options: {
  measure(focus: Focus): DOMRect | null;   // where the opened/closed node was, measured before the change
  stages?: (from: Focus, to: Focus) => boolean; // which changes get an echo; default: level changed
}): {
  echo: null | { key: string; from: Focus; to: Focus; origin: { x: number; y: number }; direction: "in" | "out"; onDone(): void };
  liveProps: { "data-arriving": "" | undefined };
};
export function Echo(props: { echo: NonNullable<...>; children: ReactNode; className?: string }): JSX.Element;
// renders children once, inert, aria-hidden, pointer-events none, with CSS vars --echo-ox/--echo-oy set
// from origin, data-direction, and calls echo.onDone() → flight.settle() on animationend/transitionend.
```

The consumer renders the OUTGOING level inside `<Echo>` with plain (id-free) elements, and puts
the camera move on `.echo` through its own tokens. This is the primitive behind rule 1; ids stay
with the live layer (rule 2).

## 5. Also in this round (from the round-2 gap list, only what the bold directions need)

- `presenceStyle` returns a `type` motion accepts; `{ scale: false }` emits no scale key.
- `useOverlayEscape` gains `prefer: "opener" | "origin"`.
- `useLevelFlight`: `fallbackToken` may be a list (summed) and needs no element on first render;
  an unclaimed flight settles itself after one frame.
- `useRoving(ref, { selector, columns? })` for arrow-key rows/grids.

## Deviations

Written by the kit agent after building §1–§5. Nothing in the contract was dropped and no name or
signature the four app agents code against was changed; everything below is an ADDITION or a
spelling the contract left open. Read the three marked **(act on this)** — the rest are notes.

**(act on this) `bind` has a `ref`.** React registers `wheel` on its root as *passive*, so a
`preventDefault` from the `onWheel` in `bind` cannot stop the page scrolling behind the scene.
The rig therefore attaches its own non-passive listener, and `bind.ref` is how it gets the
element. Spread `bind` **after** your own ref (`<div ref={mine} {...rig.bind}>` loses the rig's;
`<div {...rig.bind} ref={mine}>` loses yours) — or compose: `const set = (el) => { mine.current =
el; rig.bind.ref(el); }`. If the rig never sees the element it recovers from the first pointer or
wheel event, one tick late, and `bind.onWheel` handles that first event without preventing the
scroll.

**(act on this) the echo's origin is a FRACTION of the container, 0..1.** `<Echo>` writes it as
a percentage (`--echo-ox: 12.5%`), so `transform-origin: var(--echo-ox) var(--echo-oy)` is the
whole of the CSS. Pass `{ origin: "px" }` to `useEcho` for pixels and the vars come out in `px`;
the CSS line is the same either way. A fraction is the default because it survives a resize
between the measurement and the paint. `useEcho` also takes `container: () => Element | null` —
without it there is nothing to take a fraction *of*, and the fallback is the viewport.

**(act on this) `useSemanticZoom` takes `options.flight`.** The contract asks that a
camera-driven level change "still bump flight and settle when the flyTo/idle completes", and
settling needs the flight object. Pass what `useLevelFlight` returned. Without it the hook still
dispatches and still flies; the move then ends on the surface's own settle or its fallback.

Everything else, briefly:

- `CameraRig.moving` is a **getter**, so `rig.moving` is never stale. It still reads and types as
  `boolean`.
- `subscribe(cb)` calls `cb` **once immediately** with the current pose, so a DOM stage is one
  line. `reset()` **flies** to `initial` rather than cutting to it — a camera that jumps home is
  not a camera.
- `CameraRigOptions` gained `easeToken` (the contract asks for "an ease from `cssEase`" and names
  no token to read it from; default `FLY_EASE`) and `sensitivity` (radians per pixel of drag).
  `reducedMotion` defaults to `"user"`, which is rule 8.
- `stepInertia(pose, velocity, retain, dt)` returns `{ pose, velocity }`; `velocity` is a
  `CameraVelocity` in units per **millisecond**, and `retain` is per **frame** as documented, so
  the decay is raised to `dt / FRAME_MS` and a tab at 30fps coasts the same distance as one at
  120. `nearestSnap` returns `CameraPose | null` (`null` for an empty list). In `CameraBounds`, an
  **absent** `yaw` means the same as `"free"`.
- `poseToTransform` composes `translate(pan·zoom) scale(zoom) rotateX(pitch) rotateY(yaw)`, which
  is exactly what `zoomAt` inverts. The stage must keep `transform-origin: 50% 50%`, and
  `perspective` belongs on its **parent** (the option exists for a surface that has no parent to
  put it on, and shears when it pans).
- `useLevelFlight`'s return gained `claim(flight?) => release` and `fallbackMs`. An unclaimed
  flight self-settles after one frame **only once `claim()` has been called at least once on that
  hook** — otherwise the four apps that end their flights from an `onAnimationComplete` would have
  every echo unmounted a frame after it mounted. `useEcho` arms it for you (`ARMING_FLIGHT`).
  `fallbackToken` now also takes a list, summed, which is the `calc()` answer; `el` also takes a
  getter, which is the "no element on first render" answer.
- `EchoState` carries two fields the contract does not list — `unit` and `fallbackMs` — both for
  `<Echo>`'s own use. `echoStages` never returns true for the same focus twice, whatever `stages`
  says: an echo of a move that did not happen is a flash.
- `Presence` is now a **type alias**, not an interface. That is what makes `animate={presenceOf(…)}`
  compile against motion's `Target` (TypeScript gives an implicit index signature to a type and
  never to an interface) — the round-2 gap logged three times.
- `useRoving`'s `columns: 1` (the default) means a **one-dimensional** collection: both pairs of
  arrows step by one, so a row and a column are the same call. Walls appear when `columns > 1`.
- The pure echo module is `zoom/echo-rule.ts`, not `echo.ts`: `Echo.tsx` sits beside it and
  TypeScript refuses two files differing only in case. Import from `@athena/demo-kit/zoom`; the
  path is only visible to a test.
