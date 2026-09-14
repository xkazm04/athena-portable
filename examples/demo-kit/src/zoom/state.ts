/**
 * The three-level model itself — state, actions, reducer — with no React in it.
 *
 *   L0  the whole population — one glance, "where is the trouble"
 *   L1  one group — the working set, laid out so its members compare
 *   L2  one item — the thing you act on, with the evidence and the buttons
 *
 * It was inside `nav.ts` until the consolidation round, and it is here for the reason
 * `escape.ts` is its own module: the reducer is the part that can be WRONG, and pinning it
 * under `node --test` must not drag React (and a renderer, and a DOM) in behind it. `nav.ts`
 * re-exports everything below, so nothing that imported it has moved.
 */

export type Level = 0 | 1 | 2;

export interface Focus {
  level: Level;
  /** Lane / rack / quadrant id. */
  group: string | null;
  /** The single item at L2. */
  item: string | null;
}

export const HOME: Focus = { level: 0, group: null, item: null };

export interface NavState {
  focus: Focus;
  /**
   * The focus the last change LEFT, which is the only thing an abort needs.
   *
   * Round 1 taught that a move in flight has to be abandonable (formula §1 rule 6) and every
   * app discovered that "abandon" means "put me back where I was", which the level model did
   * not remember: `up` from a half-drawn L1 lands at L0, which is a third place rather than
   * the place the reader was standing. Every focus-changing action writes it, so `abort`
   * never has to be told.
   */
  prev: Focus;
  /** Hovered node id — `group` or `group:item`. */
  hover: string | null;
  /** Nodes something is pointing at (a scripted agent run, a filter). */
  highlight: ReadonlySet<string>;
  /** Monotonic — every focus change bumps it so the rig re-flies even when the
   *  computed pose happens to be identical to the last one. */
  flight: number;
}

export type NavAction =
  | { type: "open-group"; group: string }
  | { type: "open-item"; group: string; item: string }
  | { type: "up" }
  | { type: "home" }
  /** Abandon the move in flight: back to `prev`, with a flight of its own. */
  | { type: "abort" }
  | { type: "hover"; id: string | null }
  | { type: "highlight"; ids: string[] };

export const nodeId = (group: string, item?: string | null): string => (item ? `${group}:${item}` : group);

export const initialNavState = (): NavState => ({
  focus: HOME,
  prev: HOME,
  hover: null,
  highlight: new Set<string>(),
  flight: 0,
});

/** Two foci are the same place. Structural, because a `Focus` is re-created on every action. */
export const sameFocus = (a: Focus, b: Focus): boolean =>
  a.level === b.level && a.group === b.group && a.item === b.item;

export function navReducer(s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case "open-group":
      return {
        ...s,
        focus: { level: 1, group: a.group, item: null },
        prev: s.focus,
        flight: s.flight + 1,
      };
    case "open-item":
      return {
        ...s,
        focus: { level: 2, group: a.group, item: a.item },
        prev: s.focus,
        flight: s.flight + 1,
      };
    case "up": {
      if (s.focus.level === 0) return s;
      const focus: Focus =
        s.focus.level === 2 ? { level: 1, group: s.focus.group, item: null } : HOME;
      return { ...s, focus, prev: s.focus, flight: s.flight + 1 };
    }
    case "home":
      return s.focus.level === 0 && s.highlight.size === 0
        ? s
        : { ...s, focus: HOME, prev: s.focus, highlight: new Set<string>(), flight: s.flight + 1 };
    case "abort":
      // Nothing to go back to is not an error and not a flight: a bump with no move is a
      // re-fly of the pose that is already on screen, which is a flicker the reader did not ask
      // for. The first action of a session takes this branch.
      return sameFocus(s.prev, s.focus)
        ? s
        : { ...s, focus: s.prev, prev: s.focus, flight: s.flight + 1 };
    case "hover":
      return s.hover === a.id ? s : { ...s, hover: a.id };
    case "highlight":
      return { ...s, highlight: new Set(a.ids) };
    default:
      return s;
  }
}
