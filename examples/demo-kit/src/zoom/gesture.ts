/**
 * The rig's pointer, as a pure gesture machine. `docs/kit-camera-contract.md` §2, "The pointer".
 *
 * `useCameraRig` used to capture the pointer on every press and pan from the first move. A
 * captured pointer retargets the click that follows to the capturing element, so every DOM
 * control drawn inside a camera scene lost its mouse click (atlas KIT-GAPS R5-A1, four reports).
 * The rules that fix it are the direct-manipulation ones, and each is a line below:
 *
 *   · A PRESS IS A CLICK until it travels `DRAG_SLOP` screen pixels from where it went down.
 *     Nothing is captured and nothing moves before that, so the child under the pointer gets its
 *     own `click`. The distance is measured on the SCREEN, before `panDelta` divides by the zoom:
 *     at zoom 4 a 3 px wobble is still a click, not a 0.75 world-unit pan.
 *   · CAPTURE AT THE THRESHOLD. The move that crosses the slop captures the pointer and then pans
 *     by the whole distance from the press origin, so the scene does not lag the hand by 4 px.
 *   · EAT THE TRAILING CLICK. A drag that ends over a node must not open it: the click the
 *     platform synthesises after a drag is swallowed, once. The swallow is cleared by the next
 *     press and by `expire` (the hook sends it after the up's task), so a drag that produced no
 *     click at all, a touch pan, never eats the click of a later, ordinary press.
 *   · RELEASE IN EVERY EXIT PATH. Up releases what it captured; a cancel or a lost capture ends
 *     the whole gesture, releases what is still held, and leaves no pointer behind.
 *
 * `gestureStep(state, input, opts)` returns the next state and the EFFECTS for the hook to carry
 * out. The hook owns the element, the pose and the clocks; this module owns every decision.
 * Type-imports-only, like every pure module in the kit, so `node --test` loads it as it is.
 * `test/gesture.test.ts` pins it.
 */

/** Screen pixels a press travels before it is a drag. Below it, the press is a click. */
export const DRAG_SLOP = 4;

export interface GesturePoint {
  x: number;
  y: number;
}

/** One pointer that is down: where it is, and whether the rig holds its capture. */
export interface GesturePointer extends GesturePoint {
  id: number;
  captured: boolean;
}

export interface GestureState {
  /** `idle`: nothing down. `press`: down, under the slop. `drag`: one pointer moving the camera. `pinch`: two or more. */
  phase: "idle" | "press" | "drag" | "pinch";
  /** Every pointer the rig is tracking, in the order they went down. */
  pointers: readonly GesturePointer[];
  /** Where the press went down: the slop is measured from here, and so is the catch-up delta. */
  origin: GesturePoint;
  /** The last point a drag delta was measured from, and when. */
  last: GesturePoint;
  lastAt: number;
  /** The previous two-pointer measurement, while pinching. */
  pinch: { dist: number; mid: GesturePoint } | null;
  /** This gesture became a drag or a pinch, so its trailing click belongs to the camera. */
  dragged: boolean;
  /** The next click on the scene is the trailing click of a drag; swallow it. */
  swallow: boolean;
  /** A gesture is driving the camera. Inertia, after an up, is the hook's own. */
  moving: boolean;
}

export type GestureInput =
  | { type: "down"; id: number; x: number; y: number; t: number }
  | { type: "move"; id: number; x: number; y: number; t: number }
  | { type: "up"; id: number; t: number }
  | { type: "cancel"; id: number }
  | { type: "lostcapture"; id: number }
  | { type: "click" }
  /** The up's task is over; a trailing click that has not come is not coming. */
  | { type: "expire" };

export type GestureEffect =
  /** A first press: stop inertia, cancel a flight, clear the idle snap. A grab stops the camera. */
  | { type: "halt" }
  | { type: "capture"; id: number }
  | { type: "release"; id: number }
  /** One pointer moved the camera by this many SCREEN pixels over `dt` ms. */
  | { type: "drag"; dx: number; dy: number; dt: number }
  /** Two pointers: zoom by `factor` about `mid`, and pan by `pan` screen pixels. */
  | { type: "pinch"; factor: number; mid: GesturePoint; pan: GesturePoint }
  | { type: "moving"; value: boolean }
  /** The last pointer of a drag came up: hand the velocity to inertia. */
  | { type: "coast" }
  /** The gesture ended without a drag (a click), or was cancelled: settle, schedule the snap. */
  | { type: "settle" }
  /** Stop this click: it is the trailing click of a drag. */
  | { type: "swallowClick" };

export interface GestureOptions {
  /** The rig's `drag` option. `"none"` makes the pointer inert, as it always was. */
  drag: "orbit" | "pan" | "none";
  /** Default `DRAG_SLOP`. */
  slop?: number;
}

export interface GestureStep {
  state: GestureState;
  effects: GestureEffect[];
}

const ORIGIN: GesturePoint = { x: 0, y: 0 };

export const initialGesture = (): GestureState => ({
  phase: "idle",
  pointers: [],
  origin: ORIGIN,
  last: ORIGIN,
  lastAt: 0,
  pinch: null,
  dragged: false,
  swallow: false,
  moving: false,
});

/** Did this step swallow the click it was given? */
export const swallowsClick = (step: GestureStep): boolean =>
  step.effects.some((effect) => effect.type === "swallowClick");

const measure = (a: GesturePoint, b: GesturePoint) => ({
  dist: Math.hypot(a.x - b.x, a.y - b.y),
  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
});

const pairOf = (pointers: readonly GesturePointer[]) => {
  const [a, b] = pointers;
  return a && b ? measure(a, b) : null;
};

/** End the whole gesture: release what is still held (except `lost`, already gone), keep no pointer. */
const abort = (state: GestureState, lost: number | null): GestureStep => {
  const effects: GestureEffect[] = [];
  for (const p of state.pointers) {
    if (p.captured && p.id !== lost) effects.push({ type: "release", id: p.id });
  }
  if (state.moving) effects.push({ type: "moving", value: false });
  effects.push({ type: "settle" });
  return { state: { ...initialGesture() }, effects };
};

export function gestureStep(state: GestureState, input: GestureInput, opts: GestureOptions): GestureStep {
  const none: GestureStep = { state, effects: [] };

  switch (input.type) {
    case "click":
      return state.swallow
        ? { state: { ...state, swallow: false }, effects: [{ type: "swallowClick" }] }
        : none;

    case "expire":
      return state.swallow ? { state: { ...state, swallow: false }, effects: [] } : none;

    case "down": {
      const at = { x: input.x, y: input.y };
      const known = state.pointers.some((p) => p.id === input.id);
      // A first press. A pointer we still hold under this id lost its up somewhere outside the
      // scene; it is stale, and this press starts fresh rather than pinching with a ghost.
      if (state.pointers.length === 0 || known) {
        if (opts.drag === "none") return { state: { ...state, swallow: false }, effects: [] };
        const effects: GestureEffect[] = [];
        if (known) {
          for (const p of state.pointers) if (p.captured) effects.push({ type: "release", id: p.id });
          if (state.moving) effects.push({ type: "moving", value: false });
        }
        effects.push({ type: "halt" });
        return {
          state: {
            ...initialGesture(),
            phase: "press",
            pointers: [{ id: input.id, ...at, captured: false }],
            origin: at,
            last: at,
            lastAt: input.t,
          },
          effects,
        };
      }
      // A second (or third) finger: a pinch, and every finger in it is the camera's.
      const effects: GestureEffect[] = [];
      const pointers = [...state.pointers, { id: input.id, ...at, captured: false }].map((p) => {
        if (p.captured) return p;
        effects.push({ type: "capture", id: p.id });
        return { ...p, captured: true };
      });
      if (!state.moving) effects.push({ type: "moving", value: true });
      return {
        state: {
          ...state,
          phase: "pinch",
          pointers,
          pinch: pairOf(pointers),
          dragged: true,
          swallow: false,
          moving: true,
        },
        effects,
      };
    }

    case "move": {
      const index = state.pointers.findIndex((p) => p.id === input.id);
      const self = state.pointers[index];
      if (!self) return none;
      const at = { x: input.x, y: input.y };
      const pointers = state.pointers.map((p, i) => (i === index ? { ...p, ...at } : p));

      if (pointers.length >= 2) {
        // Two pointers: zoom AND pan, from the same midpoint. A pinch that only zoomed would
        // slide the scene out from under the fingers holding it.
        const now = pairOf(pointers);
        if (!now) return none;
        const base = state.pinch ?? now;
        const factor = base.dist > 0 && now.dist > 0 ? now.dist / base.dist : 1;
        return {
          state: { ...state, pointers, pinch: now, last: { ...now.mid }, lastAt: input.t },
          effects: [
            {
              type: "pinch",
              factor,
              mid: now.mid,
              pan: { x: now.mid.x - base.mid.x, y: now.mid.y - base.mid.y },
            },
          ],
        };
      }

      if (opts.drag === "none") return { state: { ...state, pointers }, effects: [] };

      if (state.phase === "press") {
        const travel = Math.hypot(at.x - state.origin.x, at.y - state.origin.y);
        if (travel < (opts.slop ?? DRAG_SLOP)) return { state: { ...state, pointers }, effects: [] };
        // The threshold: capture now, then catch up the whole distance from the press origin.
        return {
          state: {
            ...state,
            phase: "drag",
            pointers: pointers.map((p) => (p.id === input.id ? { ...p, captured: true } : p)),
            last: at,
            lastAt: input.t,
            dragged: true,
            moving: true,
          },
          effects: [
            { type: "capture", id: input.id },
            {
              type: "drag",
              dx: at.x - state.origin.x,
              dy: at.y - state.origin.y,
              dt: input.t - state.lastAt,
            },
            ...(state.moving ? [] : [{ type: "moving", value: true } as const]),
          ],
        };
      }

      return {
        state: { ...state, pointers, last: at, lastAt: input.t },
        effects: [
          { type: "drag", dx: at.x - state.last.x, dy: at.y - state.last.y, dt: input.t - state.lastAt },
        ],
      };
    }

    case "up": {
      const self = state.pointers.find((p) => p.id === input.id);
      if (!self) return none;
      const effects: GestureEffect[] = self.captured ? [{ type: "release", id: input.id }] : [];
      const rest = state.pointers.filter((p) => p.id !== input.id);
      const [first] = rest;
      if (first) {
        // One finger lifted out of a pinch: the other keeps dragging from where IT is, not from
        // where the midpoint was, which would jump the scene.
        return {
          state: {
            ...state,
            phase: rest.length >= 2 ? "pinch" : "drag",
            pointers: rest,
            pinch: pairOf(rest),
            last: { x: first.x, y: first.y },
            lastAt: input.t,
          },
          effects,
        };
      }
      if (state.dragged) {
        effects.push({ type: "coast" });
        return { state: { ...initialGesture(), swallow: true }, effects };
      }
      // A click: nothing was captured, nothing moved, and the child's own click fires.
      effects.push({ type: "settle" });
      return { state: initialGesture(), effects };
    }

    case "cancel":
      return state.pointers.some((p) => p.id === input.id) ? abort(state, null) : none;

    case "lostcapture":
      // Our own release after an up fires this too, for a pointer we already let go: a no-op.
      return state.pointers.some((p) => p.id === input.id && p.captured) ? abort(state, input.id) : none;
  }
}
