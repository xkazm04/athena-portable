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
