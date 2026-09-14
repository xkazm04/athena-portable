/**
 * Presence: what recedes when you drill in, and what that looks like.
 *
 * `emphasis()` — the model's answer, imported by every world since the first round — lives here
 * rather than in `nav.ts` as of the consolidation round, for the reason `escape.ts` and
 * `state.ts` are their own modules: it is a rule that can be wrong, and pinning it under
 * `node --test` must not drag React in behind it. `nav.ts` re-exports it, so nothing has moved.
 * `presenceStyle()` below is the other half, and the two are one file because a mapping kept
 * apart from the thing it maps is a mapping that drifts.
 *
 * WHY THE KIT OWNS THE MAPPING NOW. Round 1 ended with two apps mapping `emphasis()` onto
 * opacity and scale and a third about to — hirelane's `dim()` and ledgerbox's receding lanes —
 * each with its own depth constant, arrived at by eye, in a component. Rule 7 of the formula
 * says presence comes from the model; a second number invented per app is the same defect one
 * layer down, because "how far back does 0.22 stand" is then an app opinion and two surfaces in
 * the same repo recede at different rates.
 *
 * THE MAPPING, and why it is this one:
 *
 *     opacity = e
 *     scale   = 1 − (1 − e) · depth        depth = 0.06
 *
 * Opacity is the presence itself: the model already says how present a thing is, and dimming is
 * the honest reading of it. Scale is SHALLOWER than the fade on purpose — hirelane's note says
 * it in one line: "a row that shrinks as far as it dims reads as falling off the board rather
 * than as standing further back on it". Six percent is the whole travel from fully present to
 * gone, so a receding group loses about five percent of its size while it loses three quarters
 * of its ink. Depth is an option, not a second opinion: a surface with real perspective (a
 * canvas, a stack of cards) can ask for more, and says so at the call site.
 *
 * Pure, no React, no DOM: `test/presence.test.ts` pins it under `node --test`.
 */
import type { Focus } from "./state";

/**
 * Presence of a node given the focus: 1 fully there, 0 gone.
 *
 * The one rule every world obeys, so "what recedes when I drill in" is a property of the model
 * and not of whoever wrote the world. Worlds read it and decide what to DO with it — fade, sink,
 * unlight — but never re-derive it (formula §1 rule 7).
 */
export function emphasis(focus: Focus, group: string, item: string | null): number {
  if (focus.level === 0) return item ? 0.45 : 1;
  const mine = focus.group === group;
  if (focus.level === 1) {
    if (!mine) return item ? 0.05 : 0.22;
    return 1;
  }
  if (!mine) return item ? 0.02 : 0.12;
  if (!item) return 0.4;
  return item === focus.item ? 1 : 0.14;
}

/**
 * A TYPE ALIAS, not an interface, and that is load-bearing.
 *
 * Round 2 logged it three times (hirelane, atlas twice): `presenceOf` returned a shape `motion`
 * rejected as a `Target`, so the kit's own template did not typecheck as written. `Target` is an
 * index-signature type, and TypeScript gives an implicit index signature to an object TYPE but
 * never to an INTERFACE — an interface can be augmented later, so it cannot be known to hold
 * only the members it declares. One keyword, and `animate={presenceOf(...)}` compiles.
 */
export type Presence = {
  opacity: number;
  scale: number;
};

/** The same, for a surface whose transform is its own. See `{ scale: false }` below. */
export type PresenceOpacity = {
  opacity: number;
};

export interface PresenceOptions {
  /** How much of its size a node loses between fully present and gone. Default `0.06`. */
  depth?: number;
  /** A floor on opacity, for a surface that must keep a receding node legible. Default `0`. */
  floor?: number;
  /**
   * `false` emits NO `scale` key at all — not `scale: 1`.
   *
   * Round 2, ledgerbox: a lane that carries a `translateZ` as DATA cannot take a scale from the
   * navigation channel, and `scale: 1` is not a way of declining it — `motion` writes the key,
   * which composes into the same transform and overwrites the lane's own. The absent key is the
   * only spelling of "this channel does not speak for the transform".
   */
  scale?: false;
}

/** The kit's depth: six percent of size across the whole of the fade. */
export const PRESENCE_DEPTH = 0.06;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * One presence value as the two properties a level change is allowed to animate.
 *
 * `e` is clamped to 0..1, so an app that hands in a number of its own (a filter's fade, a
 * staged entrance) gets the same curve rather than a negative scale.
 */
export function presenceStyle(e: number, opts: PresenceOptions & { scale: false }): PresenceOpacity;
export function presenceStyle(e: number, opts?: PresenceOptions): Presence;
export function presenceStyle(e: number, opts: PresenceOptions = {}): Presence | PresenceOpacity {
  const { depth = PRESENCE_DEPTH, floor = 0 } = opts;
  const present = clamp01(Number.isFinite(e) ? e : 0);
  const opacity = floor + (1 - floor) * present;
  if (opts.scale === false) return { opacity };
  return { opacity, scale: 1 - (1 - present) * depth };
}

/**
 * The whole rule in one call: what the model says about this node, drawn.
 *
 *     <motion.div animate={presenceOf(nav.state.focus, group, null)} />
 *
 * `item` is `null` for a group and the item id for a member of one, exactly as `emphasis()`
 * takes them.
 */
export function presenceOf(
  focus: Focus,
  group: string,
  item: string | null,
  opts: PresenceOptions & { scale: false },
): PresenceOpacity;
export function presenceOf(
  focus: Focus,
  group: string,
  item?: string | null,
  opts?: PresenceOptions,
): Presence;
export function presenceOf(
  focus: Focus,
  group: string,
  item: string | null = null,
  opts: PresenceOptions = {},
): Presence | PresenceOpacity {
  return presenceStyle(emphasis(focus, group, item), opts);
}
