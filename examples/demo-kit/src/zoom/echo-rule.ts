/**
 * The echo's three decisions, without a DOM to make them in.
 * `docs/kit-camera-contract.md` §4, the pure half.
 *
 * Rule 1 is the headline rule of the whole formula — *the level you leave carries the camera;
 * the level you arrive at carries the continuity* — and after two rounds it was still ~30 lines
 * of app code plus a stylesheet in all four apps, which is what atlas's gap list says in three
 * words: "there is no echo container". The three lines of app code that were never the same
 * twice are the ones here.
 *
 *   · WHICH changes get an echo. Every app said "the level changed" and then discovered the
 *     exception: an L2→L2 move between two items of the same group is a change of subject, not a
 *     change of depth, and an echo of it reads as a stutter. Default is the level; `stages` is
 *     the surface's own answer.
 *   · WHERE the move comes from. A zoom that starts in the middle of the screen is a dissolve
 *     with extra steps; hirelane's measured origin is what makes the move read as "that one, and
 *     you are now inside it". The origin is the centre of the node you left, in the echo
 *     container's own coordinates.
 *   · WHICH WAY. `in` on the way down (L0→L1, L1→L2), `out` on the way back. The surface hangs
 *     two animations off `data-direction` and never inspects the foci itself.
 *
 * THE UNIT of `origin` — the question the contract asks to have answered in writing — is a
 * FRACTION OF THE CONTAINER, 0..1, with `{ origin: "px" }` for the other one. A fraction is the
 * default because the value's destination is `transform-origin`, which takes percentages, and
 * because a fraction survives a resize between the measurement and the paint, which pixels do
 * not. `Echo` writes `--echo-ox` / `--echo-oy` as percentages for the fraction unit and as `px`
 * for the pixel one, so the CSS reads the same either way.
 *
 * `test/echo.test.ts` pins all three.
 */
import type { Focus } from "./state";

/* `sameFocus` says exactly this, but this module is loaded by `node --test`, whose ESM resolver
   needs a file extension on a VALUE import — and every other pure module in the kit is
   type-imports-only for the same reason. Three comparisons is the cheaper half of that trade. */
const samePlace = (a: Focus, b: Focus): boolean =>
  a.level === b.level && a.group === b.group && a.item === b.item;

/** As much of a `DOMRect` as the origin needs. `getBoundingClientRect()` is one. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type EchoDirection = "in" | "out";

export type EchoOriginUnit = "fraction" | "px";

/** Did this change of focus change the DEPTH? The default answer to "does this get an echo". */
export const levelChanged = (from: Focus, to: Focus): boolean => from.level !== to.level;

/**
 * Should this change get an echo?
 *
 * The default is `levelChanged`, which is the rule as written in the formula. A change that does
 * not move the reader (the same focus twice, which an abort can produce) never gets one, whatever
 * `stages` says — an echo of a move that did not happen is a flash.
 */
export function echoStages(
  from: Focus,
  to: Focus,
  stages: (from: Focus, to: Focus) => boolean = levelChanged,
): boolean {
  if (samePlace(from, to)) return false;
  return stages(from, to);
}

/** Down is `in`, back up is `out`. A same-level change reads as `in`: it is a move inwards. */
export const echoDirection = (from: Focus, to: Focus): EchoDirection =>
  to.level < from.level ? "out" : "in";

const CENTRE = { x: 0.5, y: 0.5 } as const;

/**
 * Where on the container the move happened.
 *
 * `rect` is the node being left, measured before the change (viewport coordinates, as
 * `getBoundingClientRect` gives them); `container` is the echo's own box, in the same
 * coordinates. Both may be `null` — an agent moved the nav with nothing rendered for the focus
 * it moved from, or the container has not been laid out yet — and the answer is then the middle,
 * which is the honest reading of "we do not know where this came from" and is also what a
 * surface with no measurable nodes wants.
 *
 * The fraction is NOT clamped: a node scrolled out of the container gives an origin outside
 * 0..1, and a zoom out of a point off-screen is a perfectly good move. A zero-sized container
 * cannot produce a fraction at all and answers the centre.
 */
export function echoOrigin(
  rect: RectLike | null | undefined,
  container: RectLike | null | undefined,
  unit: EchoOriginUnit = "fraction",
): { x: number; y: number } {
  if (!rect) {
    if (unit === "px" && container) return { x: container.width / 2, y: container.height / 2 };
    return { ...CENTRE };
  }
  const base = container ?? { left: 0, top: 0, width: 0, height: 0 };
  const x = rect.left + rect.width / 2 - base.left;
  const y = rect.top + rect.height / 2 - base.top;
  if (unit === "px") return { x, y };
  if (!(base.width > 0) || !(base.height > 0)) return { ...CENTRE };
  return { x: x / base.width, y: y / base.height };
}

/**
 * The origin as the two CSS values `Echo` writes.
 *
 * A percentage for a fraction, `px` for pixels — so `transform-origin: var(--echo-ox)
 * var(--echo-oy)` is the same line of CSS whichever unit the surface chose.
 */
export function echoOriginVars(
  origin: { x: number; y: number },
  unit: EchoOriginUnit = "fraction",
): { "--echo-ox": string; "--echo-oy": string } {
  const fmt = (n: number) =>
    unit === "px" ? `${Math.round(n * 100) / 100}px` : `${Math.round(n * 1e4) / 100}%`;
  return { "--echo-ox": fmt(origin.x), "--echo-oy": fmt(origin.y) };
}

/**
 * The echo's React key.
 *
 * The flight counter alone would do — it is monotonic — but the foci are in it so that a key
 * read in a devtools tree says which move it belongs to, and because a surface that renders two
 * echoes at once (it should not) gets two distinct keys rather than one silent collision.
 */
export const echoKey = (flight: number, from: Focus, to: Focus): string =>
  `${flight}:${from.level}${from.group ?? ""}${from.item ?? ""}>${to.level}${to.group ?? ""}${to.item ?? ""}`;
