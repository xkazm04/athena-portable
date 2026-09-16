/**
 * THE WORKFLOW, AS DATA — archify's `workflow` schema v2, authored against our model.
 * `docs/archify-study.md` Part 2 §1, §5 (proposal B); the reference IR is
 * `archify/examples/agent-tool-call.workflow.json` (read, never copied).
 *
 * WHAT THIS VARIANT ARGUES. The round-5 sheet drew WHERE nineteen systems sit and let boundary
 * frames do the grouping; the owner's verdict was that the grouping, the node and the finish were
 * all degraded from archify. Archify's own answer to grouping is not a better frame — it is a
 * SECOND SPATIAL AXIS. A workflow diagram has lanes (who owns the step), columns (when it happens)
 * and phases (which act it belongs to), so **reading order comes from position** and the amber
 * dashes disappear entirely. That is the whole of this variant: no boundary rectangles anywhere,
 * four lanes, six columns, three phases, twelve nodes.
 *
 * THE ABSTRACTION CEILING IS THE POINT (study Part 2 §1: no archify example exceeds twelve nodes
 * and fourteen edges). Nineteen systems become TWELVE NODES by four authored merges, and the
 * sixty-eight components become the `sublabel`. `test/lanes.model.test.ts` asserts that every one
 * of the model's systems appears in exactly one node — a system added to `data/systems.ts` with no
 * home here fails the build rather than silently vanishing from the drawing.
 *
 * THE FOUR MERGES, each with its reason:
 *
 *   desktop    shell + modules + studio + journey — study Part 2 §1's own recommendation
 *              ("merge studio + journey + modules → Desktop surfaces"): four directories that are
 *              all "a human looks at it", and the turn only ever enters through one of them.
 *   channels   daemon + voice + mcp — README §3.1's own line. Three doors onto ONE lane; the
 *              drawing's claim is that a turn does not care which one it came through.
 *   contracts  seams + vocabulary — ADR 0002's "dataclasses and Protocols only". Both are the
 *              same kind (`external`: a declared shape a turn cannot execute) and neither has
 *              behaviour to place in a column.
 *   record     the record + the brain — `data/systems.ts` says it itself: the record is "two
 *              tables in the brain's index". One durable store, two tables, one node.
 *
 * ROLES, NOT VARIANTS. Archify's workflow edges carry `role: main | branch | async | return |
 * error`, which is a claim about the TURN rather than about the line's appearance. The twelve
 * stops of README §3.2 give seven `main` edges; the gate's decline gives the ONE `error`; the
 * ledger write gives the ONE `async`; the stream carrying the answer home gives two `return`s;
 * the four nodes the turn does not pass through hang off the nearest main-path node as `branch`.
 * Fourteen edges, which is archify's ceiling exactly.
 */
import { SYSTEMS, systemById } from "@/data";

import { kindOfSystem, type Kind } from "./kinds";

/* ------------------------------------------- the lanes --------------------------------------- */

/** Archify's two lane variants and no third (`workflow.schema.json`). */
export type LaneVariant = "normal" | "exception";

export interface Lane {
  id: string;
  /** The number archify prints before the name: `01 / User Interface`. */
  ord: string;
  label: string;
  /** One line: what owning this lane means. Read by the L1 receipt and the aria label. */
  note: string;
  variant: LaneVariant;
}

/**
 * Four lanes, top to bottom in the order the turn descends them.
 *
 * `policy` IS THE EXCEPTION LANE, and that is a decision rather than a default. Archify's own
 * workflow example marks "Policy & Recovery" as the exception lane, and our three `security`
 * systems — the bridge in the page, the hooks behind every engine, the catalog that assigns the
 * class — are three layers apart in `data/systems.ts`. Drawing them as one rose-dashed band is the
 * single most useful thing this arrangement says about this repository: **the gate is not a
 * layer.** `kinds.ts` states the same finding in colour; the lane states it in position.
 */
export const LANES: readonly Lane[] = [
  {
    id: "surface",
    ord: "01",
    label: "Surface",
    note: "A human looks at it, or it carries a turn across a process boundary.",
    variant: "normal",
  },
  {
    id: "runtime",
    ord: "02",
    label: "Runtime",
    note: "What runs the turn: binds the classes, streams it, composes it, drives the engine.",
    variant: "normal",
  },
  {
    id: "policy",
    ord: "EX",
    label: "Policy and recovery",
    note: "What decides whether something may run — three gates, three layers apart.",
    variant: "exception",
  },
  {
    id: "tools",
    ord: "04",
    label: "Tools and evidence",
    note: "What a turn reaches for, and what it leaves behind.",
    variant: "normal",
  },
];

export const LANE_IDS: readonly string[] = LANES.map((l) => l.id);
export const laneById = (id: string): Lane | undefined => LANES.find((l) => l.id === id);

/* ------------------------------------------ the phases --------------------------------------- */

export type PhaseVariant = "default" | "emphasis" | "dashed";

export interface Phase {
  id: string;
  label: string;
  note: string;
  fromCol: number;
  toCol: number;
  variant: PhaseVariant;
}

/**
 * Three phases over six columns — archify's "high-level story beats such as Intake, Plan, Execute".
 *
 * They are also this variant's L1 GROUPS: opening a phase is opening two columns, which is the one
 * grouping a lane diagram can offer that a boundary rectangle cannot, because the reader already
 * knows where it is.
 */
export const PHASES: readonly Phase[] = [
  {
    id: "arrive",
    label: "Arrive",
    note: "A message with fenced host state reaches a surface, crosses one door, and becomes one streamed turn.",
    fromCol: 0,
    toCol: 1,
    variant: "default",
  },
  {
    id: "compose",
    label: "Compose and gate",
    note: "Two outputs — a static prompt and a per-turn frame — and the declared shapes the gate is about to read.",
    fromCol: 2,
    toCol: 3,
    variant: "emphasis",
  },
  {
    id: "record",
    label: "Run and record",
    note: "Up to eight provider rounds, still one turn; every tool call passes the gate; one row, failures included.",
    fromCol: 4,
    toCol: 5,
    variant: "dashed",
  },
];

export const PHASE_IDS: readonly string[] = PHASES.map((p) => p.id);
export const phaseById = (id: string | null): Phase | undefined =>
  id === null ? undefined : PHASES.find((p) => p.id === id);
export const phaseOfCol = (col: number): Phase =>
  PHASES.find((p) => col >= p.fromCol && col <= p.toCol) ?? PHASES[0]!;

export const COLS = 6;

/* ------------------------------------------- the nodes --------------------------------------- */

export interface WNode {
  id: string;
  lane: string;
  col: number;
  /** The systems this node stands for. Every system in the model is in exactly one of these. */
  systems: readonly string[];
  label: string;
  /** The components it stands for — archify's sublabel, absorbing what sub-nodes used to cost. */
  sublabel: string;
  /** The part id, bottom-centre in the kind accent (study Part 2 §2). */
  tag: string;
  /** The component the L2 pane opens. One per node, named because the pane takes a component. */
  item: string;
  /** One line for the receipt and the aria label. */
  note: string;
}

/**
 * Twelve nodes. The eight the turn passes through are the main path; four hang off it.
 *
 * The columns are the turn's own order and nothing else: a node's `col` is *when* it happens, so
 * the main path is monotone left to right and never climbs a column. `test/lanes.model.test.ts`
 * asserts that.
 */
export const NODES: readonly WNode[] = [
  /* -------------------------------------- surface -------------------------------------- */
  {
    id: "desktop",
    lane: "surface",
    col: 0,
    systems: ["sys-shell", "sys-panel", "sys-studio", "sys-journey"],
    label: "Desktop surfaces",
    sublabel: "module bar · panel",
    tag: "S-02 +3",
    item: "cmp-mod-panel",
    note: "The Tauri window, the module bar and the panel in it, the four example hosts and the journey that drives them.",
  },
  {
    id: "channels",
    lane: "surface",
    col: 1,
    systems: ["sys-daemon", "sys-voice", "sys-mcp"],
    label: "Channels",
    sublabel: "daemon · voice · mcp",
    tag: "S-06 +2",
    item: "cmp-daemon-routes",
    note: "Three doors onto one lane: HTTP and SSE, a WebSocket on the same port, and the JSON-RPC channel README names and the tree does not have.",
  },

  /* -------------------------------------- runtime -------------------------------------- */
  {
    id: "wiring",
    lane: "runtime",
    col: 0,
    systems: ["sys-wiring"],
    label: "Composition root",
    sublabel: "wiring · cli",
    tag: "S-00",
    item: "cmp-wiring",
    note: "The one place the real classes are bound together, and the command line that boots them.",
  },
  {
    id: "lane",
    lane: "runtime",
    col: 1,
    systems: ["sys-lane"],
    label: "The browser lane",
    sublabel: "lane · frame · ports",
    tag: "S-09",
    item: "cmp-lane",
    note: "One turn, streamed, holding no gated executor: up to eight provider rounds make one turn and one ledger row.",
  },
  {
    id: "composer",
    lane: "runtime",
    col: 2,
    systems: ["sys-prompt"],
    label: "The composer",
    sublabel: "prompt · recall",
    tag: "S-15",
    item: "cmp-prompt",
    note: "Two outputs — a static system prompt and a per-turn frame — plus the law, the bounded recall blocks and the nonce fence.",
  },
  {
    id: "runner",
    lane: "runtime",
    col: 3,
    systems: ["sys-runner"],
    label: "The runner",
    sublabel: "harness · engines",
    tag: "S-10",
    item: "cmp-cli-harness",
    note: "One CLI harness in two dialects behind one transport port, calling tools through the OP line grammar.",
  },

  /* --------------------------------- policy and recovery -------------------------------- */
  {
    id: "bridge",
    lane: "policy",
    col: 1,
    systems: ["sys-bridge"],
    label: "The bridge",
    sublabel: "inject · gate.js",
    tag: "S-03",
    item: "cmp-gate-js",
    note: "Tier one: the WebMCP polyfill that reads a page's tools, and the gate every surface runs, in the page.",
  },
  {
    id: "hooks",
    lane: "policy",
    col: 3,
    systems: ["sys-hooks"],
    label: "The hooks",
    sublabel: "hooks · policy",
    tag: "S-11",
    item: "cmp-hooks",
    note: "The three hooks every engine runs behind, and the four structural rules that run before the gate.",
  },
  {
    id: "catalog",
    lane: "policy",
    col: 4,
    systems: ["sys-catalog"],
    label: "The catalog",
    sublabel: "catalog · validators",
    tag: "S-13",
    item: "cmp-catalog",
    note: "The one module that assigns a ToolClass, and the parameter validation that is the last line of the gate.",
  },

  /* --------------------------------- tools and evidence --------------------------------- */
  {
    id: "contracts",
    lane: "tools",
    col: 2,
    systems: ["sys-seams", "sys-vocab"],
    label: "The contracts",
    sublabel: "seams · vocabulary",
    tag: "S-17 +1",
    item: "cmp-c-manifest",
    note: "Dataclasses and Protocols only: the registry row, the host manifest, the channel events, and the closed ERROR_REASONS set.",
  },
  {
    id: "connectors",
    lane: "tools",
    col: 3,
    systems: ["sys-connectors"],
    label: "Connectors",
    sublabel: "spec · vault · port",
    tag: "S-16 partial",
    item: "cmp-conn-spec",
    note: "A third-party service as one JSON spec plus a credential in one vault, presenting a manifest of the same shape as a page.",
  },
  {
    id: "record",
    lane: "tools",
    col: 5,
    systems: ["sys-record", "sys-brain"],
    label: "The record",
    sublabel: "approvals · ledger",
    tag: "S-14 +1",
    item: "cmp-approvals",
    note: "The gate's durable half and the cost of every turn: two tables in the brain's own index.",
  },
];

export const NODE_BY_ID: ReadonlyMap<string, WNode> = new Map(NODES.map((n) => [n.id, n]));
export const nodeById = (id: string | null): WNode | undefined =>
  id === null ? undefined : NODE_BY_ID.get(id);

/** Which node a system landed in. Derived, so the mapping is stated exactly once, above. */
export const NODE_OF_SYSTEM: ReadonlyMap<string, string> = new Map(
  NODES.flatMap((n) => n.systems.map((s) => [s, n.id] as const)),
);

/** Which node a component's system landed in — how the story finds the box for a stop. */
export const nodeOfSystem = (systemId: string): string | undefined => NODE_OF_SYSTEM.get(systemId);

/**
 * The node's kind, read off `../archify/kinds` for its FIRST system.
 *
 * The rule is stated once in that module ("a system's kind is the role it plays in one turn") and
 * a merge never invents a kind: every merge above is inside one kind already, which is part of why
 * those four merges and not others. The test asserts it.
 */
export const kindOfNode = (n: WNode): Kind => kindOfSystem(n.systems[0]!);

/** All seven kinds are used; the legend counts them. */
export const kindCounts = (): { kind: Kind; n: number }[] => {
  const tally = new Map<Kind, number>();
  for (const n of NODES) {
    const k = kindOfNode(n);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return [...tally.entries()].map(([kind, n]) => ({ kind, n }));
};

/** Every system, with the node that claims it — the coverage the test walks. */
export const systemCoverage = (): { system: string; node: string | undefined }[] =>
  SYSTEMS.map((s) => ({ system: s.id, node: NODE_OF_SYSTEM.get(s.id) }));

/** The status a node carries: the worst of its systems', so `partial` is never hidden by a merge. */
export function statusOfNode(n: WNode): "built" | "partial" | "planned" {
  let worst: "built" | "partial" | "planned" = "built";
  for (const id of n.systems) {
    const s = systemById(id);
    if (!s) continue;
    if (s.status === "planned") return "planned";
    if (s.status === "partial") worst = "partial";
  }
  return worst;
}

/* ------------------------------------------- the edges --------------------------------------- */

export const ROLES = ["main", "branch", "async", "return", "error"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  main: "the turn",
  branch: "a side path",
  async: "written, not awaited",
  return: "the answer, home",
  error: "the gate declines",
};

export type Side = "top" | "right" | "bottom" | "left";

/** A named vertical corridor. Resolved against the plan, so a widened phase carries its routes. */
export type XRef =
  | { col: number }
  | { colGap: number }
  | { outside: "left" | "right" };

/** A named horizontal corridor. */
export type YRef =
  | { lane: string }
  | { laneAbove: string }
  | { laneBelow: string }
  | { laneGap: number };

export type Channel = { x: XRef } | { y: YRef };

export interface Port {
  side: Side;
  /** Displacement from the middle of the side, in world units. Archify's port spread, authored. */
  off?: number;
}

export interface WEdge {
  id: string;
  from: string;
  to: string;
  role: Role;
  /** The one word or phrase the line carries. Never deleted as a spacing repair (study §3). */
  label: string;
  /** The longer reading, for the receipt and `read_turn`. */
  note: string;
  cite: string;
  fromPort: Port;
  toPort: Port;
  /** The corridors the route threads, in order. Empty is a facing-straight edge. */
  via?: readonly Channel[];
  /** Which segment carries the label, when the longest is not the right one. */
  labelSegment?: number;
}

/**
 * Fourteen edges — archify's ceiling, and the exact count its own workflow example uses ±3.
 *
 * ROUTES ARE AUTHORED AS CORRIDORS, NOT AS PIXELS. Archify v2 lets an author pin `route`,
 * `fromSide`, `toSide`, `channelX`/`channelY` and treats them as hard constraints; the compiler
 * only solves what is not pinned. On a lane diagram almost everything is pinnable, because the
 * corridors are a PROPERTY OF THE GRID — the midline of a column gap, the strip above or below a
 * lane's nodes, the gap between two lanes, the two outside channels. So each edge below names the
 * corridors it threads, `routing.ts` resolves those names against whichever plan is current, and
 * widening a phase moves every route with it for free. The router still checks each result against
 * the same hard feasibility predicate archify uses, and the test fails the build if one is wrong.
 */
export const EDGES: readonly WEdge[] = [
  /* ------------------------------------- the main path ------------------------------------- */
  {
    id: "e-run",
    from: "desktop",
    to: "channels",
    role: "main",
    label: "/run",
    note: "A message with host_state, fenced, opens the stream.",
    cite: "README §3.2.1",
    fromPort: { side: "right", off: -10 },
    toPort: { side: "left", off: -10 },
  },
  {
    id: "e-stream",
    from: "channels",
    to: "lane",
    role: "main",
    label: "one turn, streamed",
    note: "Whichever door it came through, it becomes one turn on one lane.",
    cite: "README §3.1 lane",
    fromPort: { side: "bottom" },
    toPort: { side: "top" },
  },
  {
    id: "e-compose",
    from: "lane",
    to: "composer",
    role: "main",
    label: "compose",
    note: "Static blocks, the law, bounded recall, and a per-turn frame.",
    cite: "README §3.2.2",
    fromPort: { side: "right" },
    toPort: { side: "left" },
  },
  {
    id: "e-frame",
    from: "composer",
    to: "runner",
    role: "main",
    label: "frame",
    note: "The prompt and the turn frame reach the harness; up to eight rounds are still one turn.",
    cite: "README §3.2.3",
    fromPort: { side: "right" },
    toPort: { side: "left" },
  },
  {
    id: "e-call",
    from: "runner",
    to: "hooks",
    role: "main",
    label: "every tool call",
    note: "Every tool call the engine makes passes the hook, before anything runs.",
    cite: "README §3.2.4",
    fromPort: { side: "bottom" },
    toPort: { side: "top" },
  },
  {
    id: "e-class",
    from: "hooks",
    to: "catalog",
    role: "main",
    label: "class?",
    note: "Reversible? External? The ToolClass is decided in one module.",
    cite: "README §3.3",
    fromPort: { side: "right" },
    toPort: { side: "left" },
  },
  {
    id: "e-approval",
    from: "catalog",
    to: "record",
    role: "main",
    label: "GATED · approval",
    note: "GATED files an approval row, and the turn waits for a decision.",
    cite: "README §3.2.4, §3.3",
    fromPort: { side: "right" },
    toPort: { side: "top" },
    via: [{ x: { col: 5 } }],
    labelSegment: 0,
  },

  /* -------------------------------------- the branches -------------------------------------- */
  {
    id: "e-tier1",
    from: "desktop",
    to: "bridge",
    role: "branch",
    label: "page tools · tier 1",
    note: "A surface's own tools are read and gated in the page before anything leaves it.",
    cite: "README §3.4 tier 1",
    fromPort: { side: "left" },
    toPort: { side: "left" },
    via: [{ x: { outside: "left" } }],
    labelSegment: 2,
  },
  {
    id: "e-boot",
    from: "wiring",
    to: "lane",
    role: "branch",
    label: "boots",
    note: "The composition root binds the real classes and boots the lane. Nothing points at it.",
    cite: "README §3.1, §7",
    fromPort: { side: "right" },
    toPort: { side: "left" },
  },
  {
    id: "e-manifest",
    from: "connectors",
    to: "hooks",
    role: "branch",
    label: "manifest flags",
    note: "A connector presents a manifest of the same shape as a page, and the same gate reads it.",
    cite: "README §4; ADR 0021",
    fromPort: { side: "top" },
    toPort: { side: "bottom" },
  },

  /* --------------------------------------- the ledger --------------------------------------- */
  {
    id: "e-ledger",
    from: "hooks",
    to: "record",
    role: "async",
    label: "the ledger row",
    note: "One row per turn, failures included — written, never awaited.",
    cite: "README §2, invariant 6",
    fromPort: { side: "bottom", off: 35 },
    toPort: { side: "top", off: -39 },
    via: [{ y: { laneAbove: "tools" } }],
  },

  /* -------------------------------------- the exception ------------------------------------- */
  {
    id: "e-declined",
    from: "record",
    to: "contracts",
    role: "error",
    label: "declined · a reason",
    note: "A declined approval refuses the call with a reason from the closed ERROR_REASONS set.",
    cite: "README §3.3; ADR 0009",
    fromPort: { side: "bottom" },
    toPort: { side: "bottom" },
    via: [{ y: { laneBelow: "tools" } }, { x: { col: 2 } }],
  },

  /* --------------------------------------- the returns -------------------------------------- */
  {
    id: "e-up",
    from: "record",
    to: "channels",
    role: "return",
    label: "carried back up",
    note: "The stream carries the answer up the way it came.",
    cite: "README §3.1",
    fromPort: { side: "right" },
    toPort: { side: "top", off: -26 },
    via: [{ x: { outside: "right" } }, { y: { laneAbove: "surface" } }],
  },
  {
    id: "e-home",
    from: "channels",
    to: "desktop",
    role: "return",
    label: "and back",
    note: "Back where it started, in the module that asked.",
    cite: "README §3.2.6",
    fromPort: { side: "left", off: 10 },
    toPort: { side: "right", off: 10 },
  },
];

export const EDGE_BY_ID: ReadonlyMap<string, WEdge> = new Map(EDGES.map((e) => [e.id, e]));

/** The counts the legend prints, in role order. One measurement, shared by legend and tests. */
export const roleCounts = (): { role: Role; n: number }[] =>
  ROLES.map((role) => ({ role, n: EDGES.filter((e) => e.role === role).length })).filter(
    (r) => r.n > 0,
  );

/** The main path as a node sequence, derived from the `main` edges — archify's `mainPath`. */
export const MAIN_PATH: readonly string[] = (() => {
  const main = EDGES.filter((e) => e.role === "main");
  const froms = new Set(main.map((e) => e.from));
  const tos = new Set(main.map((e) => e.to));
  const start = main.find((e) => !tos.has(e.from))?.from;
  const out: string[] = [];
  let at = start ?? main[0]?.from;
  while (at && froms.has(at) && !out.includes(at)) {
    out.push(at);
    at = main.find((e) => e.from === at)?.to;
  }
  if (at && !out.includes(at)) out.push(at);
  return out;
})();

export const ON_MAIN = new Set(MAIN_PATH);
