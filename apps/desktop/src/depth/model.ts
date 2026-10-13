/**
 * The depth model — README section 3.1 and 3.5, ADR 0087 and 0088.
 *
 * Main is one scene and everything else is a depth below it. This file is the whole of the
 * navigation: where you are (a `Path`), how you move (`go`, `rise`, `settle`), what the chrome
 * shows about it (`crumbs`, `gaugeDepth`, `riseLabel`) and which of the window's two shapes it is
 * (`shapeOf`, the one thing Rust is told). It is pure. It imports no store, no Tauri and no view,
 * so every rule here is tested without a DOM and the preview harness can render any depth.
 *
 * **A path has a fixed grammar, not a string of segments.** A root (Apps, Chores, Accounts, Voice,
 * Mind), then an item under it, then one sub-level of a kind the root allows. The grammar is why
 * "every capability is at most three moves from the surface" is a property that holds, not a
 * habit: `depthOf` is 0 to 3 and no path is deeper.
 *
 * **The reducer is instantaneous and total.** `state.path` is always where the person last asked
 * to be; the transition between two places is the stage's business and reads `from` and `move`.
 * An invalid destination is ignored and a rise at the surface stays at the surface, so no key
 * can leave the model somewhere it cannot draw, and Escape can never close the window. An id
 * under a root is opaque here; whether it names anything is the scene's to say.
 */

export const ROOTS = ["apps", "chores", "accounts", "voice", "mind"] as const;

export type Root = (typeof ROOTS)[number];

/** The words a person reads, which are not the module ids (ADR 0087). */
export const ROOT_LABEL: Readonly<Record<Root, string>> = {
  apps: "Apps",
  chores: "Chores",
  accounts: "Accounts",
  voice: "Voice",
  mind: "Mind",
};

/** The module whose model, fixtures and tests a root's scene is built on. Ids stay as they were. */
export const ROOT_MODULE: Readonly<Record<Root, string>> = {
  apps: "browser",
  chores: "playbooks",
  accounts: "connectors",
  voice: "voice",
  mind: "setup",
};

export type SubKind = "page" | "tool" | "run" | "allowlist";

export interface Sub {
  kind: SubKind;
  /** The tool name or the turn number, for the kinds that take one. */
  arg?: string;
}

export interface Path {
  /** `null` is the surface. */
  root: Root | null;
  item?: string;
  sub?: Sub;
}

export const SURFACE: Path = { root: null };

/** Per root: the fixed items it offers (or open ids), and the sub-levels it allows. */
const GRAMMAR: Readonly<
  Record<Root, { items: readonly string[] | "open"; subs: Readonly<Partial<Record<SubKind, boolean>>> }>
> = {
  // A boolean says whether the sub-level takes an argument.
  apps: { items: "open", subs: { page: false, tool: true } },
  chores: { items: "open", subs: { run: true } },
  accounts: { items: "open", subs: { allowlist: false } },
  voice: { items: ["studio", "settings"], subs: {} },
  mind: { items: ["engine", "brain", "look", "data", "mic"], subs: {} },
};

export function isRoot(value: unknown): value is Root {
  return typeof value === "string" && (ROOTS as readonly string[]).includes(value);
}

/** How many moves from the surface: 0 to 3. */
export function depthOf(path: Path): 0 | 1 | 2 | 3 {
  if (path.root === null) return 0;
  if (path.item === undefined) return 1;
  return path.sub === undefined ? 2 : 3;
}

/** True when the path obeys the grammar. The one place that says what a legal place is. */
export function isValid(path: Path): boolean {
  if (path.root === null) return path.item === undefined && path.sub === undefined;
  if (!isRoot(path.root)) return false;
  const g = GRAMMAR[path.root];
  if (path.item === undefined) return path.sub === undefined;
  if (path.item === "") return false;
  if (g.items !== "open" && !g.items.includes(path.item)) return false;
  if (path.sub === undefined) return true;
  if (!Object.hasOwn(g.subs, path.sub.kind)) return false;
  const takesArg = g.subs[path.sub.kind];
  const arg = path.sub.arg;
  return takesArg ? arg !== undefined && arg !== "" : arg === undefined;
}

export function samePath(a: Path, b: Path): boolean {
  return (
    a.root === b.root &&
    a.item === b.item &&
    a.sub?.kind === b.sub?.kind &&
    a.sub?.arg === b.sub?.arg
  );
}

/** One level up. The surface is its own parent. */
export function parentOf(path: Path): Path {
  if (path.sub !== undefined) return { root: path.root, item: path.item };
  if (path.item !== undefined) return { root: path.root };
  return SURFACE;
}

/** The window's two shapes (ADR 0088): the scene owns the window, or a page webview does. */
export type Shape = "scene" | "page";

/** A page is shown only at `apps/<app>/page`. The rest of the time the scene owns the window. */
export function shapeOf(path: Path): Shape {
  return path.root === "apps" && path.sub?.kind === "page" ? "page" : "scene";
}

// ---------------------------------------------------------------- hash

/** `#/apps/host-1/tool/page_read`. Segments are percent-encoded, so an id may hold a slash. */
export function formatHash(path: Path): string {
  if (path.root === null) return "#/";
  const parts: string[] = [path.root];
  if (path.item !== undefined) parts.push(encodeURIComponent(path.item));
  if (path.sub !== undefined) {
    parts.push(path.sub.kind);
    if (path.sub.arg !== undefined) parts.push(encodeURIComponent(path.sub.arg));
  }
  return "#/" + parts.join("/");
}

/** A hash to a path. Anything that does not obey the grammar is the surface. Never throws. */
export function parseHash(hash: string): Path {
  const raw = hash.replace(/^#\/?/, "");
  if (raw === "") return SURFACE;
  const parts = raw.split("/");
  const root = parts[0];
  if (!isRoot(root)) return SURFACE;
  let item: string | undefined;
  let sub: Sub | undefined;
  try {
    if (parts.length > 1) item = decodeURIComponent(parts[1]!);
    if (parts.length > 2) {
      const kind = parts[2] as SubKind;
      sub = { kind };
      if (parts.length > 3) sub.arg = decodeURIComponent(parts[3]!);
      if (parts.length > 4) return SURFACE;
    }
  } catch {
    return SURFACE; // a malformed percent escape
  }
  const path: Path = { root };
  if (item !== undefined) path.item = item;
  if (sub !== undefined) path.sub = sub;
  return isValid(path) ? path : SURFACE;
}

// ---------------------------------------------------------------- crumbs

export interface Crumb {
  path: Path;
  label: string;
  depth: 0 | 1 | 2 | 3;
}

/** What an item or a sub-level is called. The scene knows its own names; the default is the id. */
export type Labeller = (path: Path) => string | undefined;

function labelOf(path: Path, label?: Labeller): string {
  const given = label?.(path);
  if (given !== undefined) return given;
  if (path.root === null) return "Athena";
  if (path.sub !== undefined) return path.sub.arg ?? path.sub.kind;
  if (path.item !== undefined) return path.item;
  return ROOT_LABEL[path.root];
}

/** The breadcrumb: the surface, then each level down to here. Always starts at the surface. */
export function crumbs(path: Path, label?: Labeller): Crumb[] {
  const levels: Path[] = [SURFACE];
  if (path.root !== null) levels.push({ root: path.root });
  if (path.item !== undefined) levels.push({ root: path.root, item: path.item });
  if (path.sub !== undefined) levels.push(path);
  return levels.map((p) => ({ path: p, label: labelOf(p, label), depth: depthOf(p) }));
}

/** The words on the Rise button: where one rise lands. `null` at the surface, which has none. */
export function riseLabel(path: Path, label?: Labeller): string | null {
  if (path.root === null) return null;
  return labelOf(parentOf(path), label);
}

// ---------------------------------------------------------------- state

export type Move = "down" | "up" | "across" | "none";

export interface DepthState {
  /** Where the person last asked to be. */
  path: Path;
  /** Where the move started, while one is in flight; `null` once it has settled. */
  from: Path | null;
  move: Move;
  /** Counts every accepted move, so a late `settle` for an older move can be told apart. */
  seq: number;
}

export const INITIAL: DepthState = { path: SURFACE, from: null, move: "none", seq: 0 };

export type DepthAction =
  | { type: "go"; to: Path }
  | { type: "rise" }
  | { type: "surface" }
  | { type: "settle"; seq: number };

function moveTo(state: DepthState, to: Path): DepthState {
  if (!isValid(to) || samePath(state.path, to)) return state;
  const a = depthOf(state.path);
  const b = depthOf(to);
  const move: Move = b > a ? "down" : b < a ? "up" : "across";
  return { path: to, from: state.path, move, seq: state.seq + 1 };
}

export function reduce(state: DepthState, action: DepthAction): DepthState {
  switch (action.type) {
    case "go":
      return moveTo(state, action.to);
    case "rise":
      return moveTo(state, parentOf(state.path));
    case "surface":
      return moveTo(state, SURFACE);
    case "settle":
      // A settle for a move that has since been replaced is the old animation ending, not this one.
      return action.seq === state.seq && state.from !== null
        ? { ...state, from: null, move: "none" }
        : state;
  }
}
