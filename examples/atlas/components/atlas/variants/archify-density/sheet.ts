/**
 * THE SHEET — the abstraction, as data. Archify study PART 2 §1 and §2.
 *
 * This module is the whole argument of the `archify-density` variant and it is a module of
 * QUANTITIES, not of technique. Part 2 of the study measured archify's nineteen example diagrams
 * and found an authored ceiling nobody had written down in part 1:
 *
 *     at most 12 nodes · 1–4 boundaries · nesting depth 1 · edges ≈ nodes (6–14)
 *     "prefer 6–12 primary components; group only real ownership, trust, process or deployment
 *      boundaries"           (archify `references/authoring-contract.md:152`)
 *     "remove low-value edges before adding routing controls"          (`SKILL.md:77`)
 *
 * Our model is 19 systems, 68 components and 120 edges: seven times the node ceiling and eight and
 * a half times the edge count. Round 5 drew all of it, and the owner's verdict was that the
 * degradation from visual archify was "significant in grouping". So this file performs the merge
 * the study's part 2 §1 specifies, and it performs it AS A DERIVATION over `data/` rather than as a
 * second hand-written model — every node names the systems it absorbs, and
 * `test/density.sheet.test.ts` asserts that the twelve nodes cover all nineteen systems exactly
 * once and that all sixty-eight components are absorbed by one of three channels.
 *
 * THE THREE ABSORPTION CHANNELS (study part 2 §1: "the 68 components become the directory in the
 * sublabel, the part id and status in the tag, and three cards of three bullets naming the clusters
 * we lose"). Every component is assigned to exactly one, by priority:
 *
 *   tag       the component the node's tag POINTS AT — its system's own entry module — and every
 *             component whose status is not `built`, because the tag prints the status and a map
 *             that silently omits what was designed and not built is a brochure (`data/types.ts`).
 *   card      named by one of the nine bullets below the canvas.
 *   sublabel  found by the node's directory. The test checks the directory really contains it, so
 *             this channel is a citation rather than a catch-all.
 *
 * NOTHING HERE IS REACT AND NOTHING HERE IS PIXELS-ON-SCREEN. World units only; the camera turns
 * them into pixels and `poses.ts` decides at what rate.
 */
import {
  COMPONENTS,
  EDGES,
  SYSTEMS,
  componentById,
  componentsOf,
  systemById,
  type Component,
  type EdgeKind,
  type LayerId,
  type Status,
  type System,
} from "@/data";

import { TRUST_SYSTEMS, kindOfSystem, type Kind } from "./kinds";

/* ============================================================================================ */
/*  1. GEOMETRY — archify's fixed cell math (study §3), with the node as a fixed unit (part 2 §2) */
/* ============================================================================================ */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * THE NODE IS A FIXED UNIT. `render-architecture.mjs:65-66` — `defaultW: 120, defaultH: 60`, fixed;
 * round 5 fitted widths from `⌈√n⌉ × 96` and drew 378×214 boxes. 140 rather than archify's 120
 * because our labels are English phrases and archify's are product names; everything else is theirs.
 */
export const NODE = { w: 140, h: 60 } as const;

/** The inner width three text tiers must fit inside (study §7.8: shrink to a floor, then reject). */
export const NODE_PAD = 9;

/**
 * THE WORLD, AUTHORED. Archify has NO AUTO-LAYOUT (study §3) and no fit pass (part 2 §4): the
 * authored viewBox fills the reading column at scale 1 and the AUTHOR is made to make it fit.
 *
 * 1140 × 680 is chosen so that `min(frameW/worldW, frameH/worldH) ≥ 1` inside the atlas stage at
 * 1440×900 — which is the one change part 2 §5 says matters, and the reason round 5's home pose of
 * 0.16–0.28 (hairline runs, an 11 px grid, unreadable labels) cannot happen here.
 */
export const WORLD = { w: 1140, h: 680 } as const;

/** Archify's 40×40 background grid. 40 world units, and therefore ~40 px on screen at home. */
export const GRID = 40;

/** Four columns — the ceiling `DEFAULT_GRID` sets (`cols: 4`). */
export const COLS = [65, 355, 645, 935] as const;

/**
 * The rows, and they are the layers.
 *
 * Seven bands for six layers: README §3.1 puts the composition root "above every layer because it
 * is what reaches into all of them", so it gets its own band and the six layers follow in the
 * order the README prints them. The gaps are authored rather than uniform for exactly one reason:
 * the gap between `surfaces` and `channels` is where the region frame's top edge lives, and a
 * frame edge needs its own lane.
 */
export const ROWS = {
  root: 6,
  surfaces: 100,
  channels: 204,
  lane: 292,
  harness: 380,
  core: 468,
  contracts: 556,
} as const;

export type RowId = keyof typeof ROWS;

/** Archify pads a boundary 30 top/left/right and 50 bottom (study §3). */
export const REGION_PAD = { t: 30, l: 30, r: 30, b: 50 } as const;
/**
 * The security group is the INNER frame and is padded tighter, so two derived bounding boxes that
 * share a member's edge never resolve to two dashed lines on the same pixel. Nested boundaries are
 * archify's own arrangement (`production-deployment` nests a region and a security group); what it
 * does not do is draw them on top of each other.
 */
export const TRUST_PAD = { t: 16, l: 16, r: 16, b: 16 } as const;

/* ============================================================================================ */
/*  2. THE TWELVE NODES                                                                          */
/* ============================================================================================ */

export interface NodeSpec {
  id: string;
  label: string;
  /** The directory line, 9 px muted at cy+14. Short enough to fit; the test proves it. */
  sublabel: string;
  /** The directories the sublabel stands for — what the `sublabel` absorption channel means. */
  dirs: readonly string[];
  /** The systems this node absorbs. The union over all twelve is SYSTEMS, exactly once each. */
  systems: readonly string[];
  /** The layer band it sits in; `root` is the composition root's own band above the six. */
  row: RowId;
  col: 0 | 1 | 2 | 3;
  /** Why this node exists at this size — the note the passport and the tools print. */
  note: string;
}

/**
 * The merge, exactly as study part 2 §1 specifies it:
 *
 *   "Merge studio + journey + modules → Desktop surfaces, daemon + mcp + voice → Channels,
 *    seams + vocabulary → Contracts; keep shell, bridge, browser lane, runner, hooks, brain,
 *    catalog, record as the main path because the gate and the ledger are the argument."
 *
 * That names eleven. The three systems the sentence leaves over are placed by the same editorial
 * rule and each merge carries its reason on its own line:
 *
 *   · `sys-wiring` is the twelfth node. README §3.1 calls the composition root "above every layer",
 *     and the one place the real classes are bound is the claim ADR 0002 exists to protect.
 *   · `sys-prompt` joins the brain. Recall, the constitution and the nonce fence are what the brain
 *     is FOR at turn time; `core/prompt.py` reads `core/brain` and nothing else does.
 *   · `sys-connectors` joins the bridge. `data/systems.ts` says a connector presents "a manifest of
 *     the same shape as a page" — the bridge is the other thing that presents one, and the vault is
 *     a gate. One node, two ways a manifest of tools arrives.
 *
 * COLUMNS ARE CHOSEN SO THE TWO DERIVED FRAMES ARE HONEST: no node that is not in the trust set
 * falls inside the trust set's bounding box, and no node outside the runtime falls inside the
 * region. `test/density.sheet.test.ts` asserts both, which is what stops the columns drifting.
 */
export const NODES: readonly NodeSpec[] = [
  {
    id: "n-root",
    label: "Composition root",
    sublabel: "wiring.py · cli.py",
    dirs: ["src/athena"],
    systems: ["sys-wiring"],
    row: "root",
    col: 0,
    note: "The one place the real classes are bound together, and the command line that boots them.",
  },
  {
    id: "n-surfaces",
    label: "Desktop surfaces",
    sublabel: "modules · examples",
    dirs: ["apps/desktop/src/modules", "examples"],
    systems: ["sys-panel", "sys-studio", "sys-journey"],
    row: "surfaces",
    col: 0,
    note: "The window's front end, the four host apps that ship without Athena, and the journey that drives them.",
  },
  {
    id: "n-shell",
    label: "Shell",
    sublabel: "src-tauri/src",
    dirs: ["apps/desktop/src-tauri"],
    systems: ["sys-shell"],
    row: "surfaces",
    col: 1,
    note: "The Tauri window: chrome, page webviews, the relay, the nine hands and the daemon sidecar.",
  },
  {
    id: "n-bridge",
    label: "Bridge",
    sublabel: "bridge · connectors",
    dirs: ["packages/athena-bridge", "src/athena/connectors"],
    systems: ["sys-bridge", "sys-connectors"],
    row: "surfaces",
    col: 3,
    note: "Two ways a manifest of tools arrives — a page through the polyfill, a service through one spec and one vault — and the gate every surface runs.",
  },
  {
    id: "n-channels",
    label: "Channels",
    sublabel: "daemon · voice · mcp",
    dirs: ["src/athena/daemon", "src/athena/channels"],
    systems: ["sys-daemon", "sys-voice", "sys-mcp"],
    row: "channels",
    col: 1,
    note: "One Athena on 127.0.0.1: HTTP and SSE, a WebSocket under /voice on the same port, and the JSON-RPC channel README §3.1 names and the tree does not have.",
  },
  {
    id: "n-lane",
    label: "Browser lane",
    sublabel: "src/athena/lane",
    dirs: ["src/athena/lane"],
    systems: ["sys-lane"],
    row: "lane",
    col: 1,
    note: "One turn, streamed, holding no gated executor: up to eight provider rounds make one turn and one ledger row.",
  },
  {
    id: "n-runner",
    label: "Runner",
    sublabel: "harness · 2 dialects",
    dirs: ["src/athena/harness"],
    systems: ["sys-runner"],
    row: "harness",
    col: 0,
    note: "One CLI harness in two dialects behind one transport port, calling tools through the OP line grammar. An engine is configuration.",
  },
  {
    id: "n-hooks",
    label: "Hooks",
    sublabel: "harness/hooks.py",
    dirs: ["src/athena/harness"],
    systems: ["sys-hooks"],
    row: "harness",
    col: 2,
    note: "The three hooks every engine runs behind, and the four structural rules that run before the gate.",
  },
  {
    id: "n-brain",
    label: "Brain",
    sublabel: "core/brain · prompt",
    dirs: ["src/athena/core"],
    systems: ["sys-brain", "sys-prompt"],
    row: "core",
    col: 1,
    note: "One markdown file per memory with a rebuildable index beside it, and the two outputs a turn is composed from.",
  },
  {
    id: "n-record",
    label: "Record",
    sublabel: "approvals · ledger",
    dirs: ["src/athena/core"],
    systems: ["sys-record"],
    row: "core",
    col: 2,
    note: "The gate's durable half and the cost of every turn: two tables outside the tables a reconcile clears.",
  },
  {
    id: "n-catalog",
    label: "Catalog",
    sublabel: "core/catalog.py",
    dirs: ["src/athena/core"],
    systems: ["sys-catalog"],
    row: "core",
    col: 3,
    note: "The one module that assigns a ToolClass, and the parameter validation that is the last line of the gate.",
  },
  {
    id: "n-contracts",
    label: "Contracts",
    sublabel: "src/athena/contracts",
    dirs: ["src/athena/contracts"],
    systems: ["sys-seams", "sys-vocab"],
    row: "contracts",
    col: 2,
    note: "Dataclasses and Protocols only: the registry row, the host manifest, the channel events, the harness Protocol and every id prefix.",
  },
];

/** The node a system belongs to. Total and injective over SYSTEMS — the test says so. */
export const NODE_OF_SYSTEM: ReadonlyMap<string, string> = new Map(
  NODES.flatMap((n) => n.systems.map((s) => [s, n.id] as const)),
);

export const nodeOfComponent = (c: Component): string | undefined =>
  NODE_OF_SYSTEM.get(c.system);

/* ============================================================================================ */
/*  3. THE NODE'S THREE TEXT TIERS                                                               */
/* ============================================================================================ */

/**
 * Monospace advance per tier, at archify's own sizes: 11 / 9 / 7, times the 0.6 em advance of the
 * figure face. The same table the baseline's layout pass measures its columns with, because the
 * two must agree about what "fits" means or one of them is guessing.
 */
export const ADVANCE = { label: 6.6, sub: 5.4, tag: 4.2 } as const;
export const SIZE = { label: 11, sub: 9, tag: 7 } as const;
/** Archify shrinks, then REJECTS (study §7.8). Below these the text is not made smaller. */
export const FLOOR = { label: 8, sub: 6, tag: 5 } as const;

export const INNER = NODE.w - NODE_PAD * 2;

/**
 * Shrink-to-fit with a legibility floor. Returns the size to draw at, or `null` for REJECT — the
 * answer archify gives rather than an ellipsis, and the answer `test/density.sheet.test.ts` asserts
 * is never needed, which is the real claim: the twelve labels were CHOSEN to fit.
 */
export function fit(text: string, tier: keyof typeof SIZE): number | null {
  const advance = ADVANCE[tier] / SIZE[tier];
  const want = text.length * advance;
  if (want <= 0) return SIZE[tier];
  const size = Math.min(SIZE[tier], INNER / want);
  return size < FLOOR[tier] ? null : Math.floor(size * 100) / 100;
}

export interface NodeText {
  label: string;
  sublabel: string;
  tag: string;
}

/**
 * The tag: the part id and the count, in the kind accent at the bottom (part 2 §2 — round 5 put it
 * top-right, where it competed with the sigil). A merged node counts its systems instead of listing
 * part ids that would not fit; a node with anything unbuilt says so, because that is the one thing
 * this atlas exists to be honest about.
 */
export function tagFor(spec: NodeSpec): string {
  const parts = spec.systems.flatMap((s) => componentsOf(s));
  const unbuilt = parts.filter((c) => c.status !== "built");
  const head =
    spec.systems.length === 1
      ? (systemById(spec.systems[0]!)?.part ?? spec.id)
      : `${spec.systems.length} sys`;
  const tail = unbuilt.length > 0 ? ` · ${unbuilt.length} ${unbuilt[0]!.status}` : "";
  return `${head} · ${parts.length} parts${tail}`;
}

export const textOf = (spec: NodeSpec): NodeText => ({
  label: spec.label,
  sublabel: spec.sublabel,
  tag: tagFor(spec),
});

/* ============================================================================================ */
/*  4. THE CARDS — the third grouping axis (study part 2 §1: 1–3 cards, 2–3 bullets each)        */
/* ============================================================================================ */

export interface Bullet {
  text: string;
  /** The components this bullet is the drawing's answer for. Every id is checked by the test. */
  covers: readonly string[];
}

export interface Card {
  id: string;
  label: string;
  kind: Kind;
  /** The node the card is about — L1 opens the card whose node is in the open layer. */
  node: string;
  bullets: readonly Bullet[];
}

/**
 * Three cards, three bullets each. Archify's cards are "the side-panel escape hatch for detail that
 * would otherwise become edges" (study §1); here they are the escape hatch for detail that would
 * otherwise become NODES. Twenty-seven of the sixty-eight components are named here and nowhere
 * else on the sheet, and that is the honest price of twelve boxes.
 */
export const CARDS: readonly Card[] = [
  {
    id: "card-surfaces",
    label: "Desktop surfaces",
    kind: "frontend",
    node: "n-surfaces",
    bullets: [
      {
        text: "apps/desktop/src/modules — panel, browser, connectors and setup, behind one registry",
        covers: ["cmp-mod-panel", "cmp-mod-browser", "cmp-mod-connectors", "cmp-mod-setup"],
      },
      {
        text: "examples/demo-kit — the WebMCP hooks, bounded lists, the zoom model and one seed",
        covers: ["cmp-kit-webmcp", "cmp-kit-bounded", "cmp-kit-zoom", "cmp-kit-seed"],
      },
      {
        text: "Four host apps that ship without Athena, and the journey that drives them in a real Chromium",
        covers: [
          "cmp-app-ledgerbox",
          "cmp-app-hirelane",
          "cmp-app-tidycrm",
          "cmp-app-atlas",
          "cmp-journey-surface",
          "cmp-journey-contracts",
        ],
      },
    ],
  },
  {
    id: "card-gate",
    label: "The gate is not a layer",
    kind: "security",
    node: "n-hooks",
    bullets: [
      {
        text: "packages/athena-bridge — inject.js and gate.js: tier 1 runs inside the page",
        covers: ["cmp-inject", "cmp-gate-js"],
      },
      {
        text: "harness/policy.py — the four structural rules that run before the gate",
        covers: ["cmp-policy"],
      },
      {
        text: "core/validators.py is the gate's last line; core/ledger.py keeps the row it leaves",
        covers: ["cmp-validators", "cmp-ledger"],
      },
    ],
  },
  {
    id: "card-turn",
    label: "What one turn is made of",
    kind: "backend",
    node: "n-lane",
    bullets: [
      {
        text: "lane/turn_frame.py and ports.py — one turn, streamed, holding no gated executor",
        covers: ["cmp-turnframe", "cmp-lane-ports"],
      },
      {
        text: "core/recall, constitution and fence — bounded blocks and a nonce the model cannot forge",
        covers: ["cmp-recall", "cmp-constitution", "cmp-fence"],
      },
      {
        text: "harness/engines, transports and op_grammar — a provider CLI we probe and do not ship",
        covers: ["cmp-engines", "cmp-transports", "cmp-op-grammar"],
      },
    ],
  },
];

/* ============================================================================================ */
/*  5. ABSORPTION — where each of the sixty-eight components went                                */
/* ============================================================================================ */

export type Channel = "tag" | "card" | "sublabel";

export interface Absorbed {
  component: string;
  node: string;
  channel: Channel;
  /** For `card`, the bullet's text; for `tag`, the tag; for `sublabel`, the directory it is under. */
  where: string;
}

const CARD_COVER = new Map<string, Bullet>(
  CARDS.flatMap((c) => c.bullets.flatMap((b) => b.covers.map((id) => [id, b] as const))),
);

/** A system's own entry module — the component its part id points at, if the model has one. */
const ENTRY = new Set<string>(
  SYSTEMS.map((s: System) => COMPONENTS.find((c) => c.system === s.id && c.file === s.file)?.id).filter(
    (id): id is string => typeof id === "string",
  ),
);

export function absorb(component: Component): Absorbed | null {
  const node = nodeOfComponent(component);
  if (!node) return null;
  const spec = NODES.find((n) => n.id === node)!;
  if (ENTRY.has(component.id) || component.status !== "built") {
    return { component: component.id, node, channel: "tag", where: tagFor(spec) };
  }
  const bullet = CARD_COVER.get(component.id);
  if (bullet) return { component: component.id, node, channel: "card", where: bullet.text };
  const dir = spec.dirs.find((d) => component.file === d || component.file.startsWith(`${d}/`));
  if (!dir) return null;
  return { component: component.id, node, channel: "sublabel", where: dir };
}

export const ABSORPTION: readonly Absorbed[] = COMPONENTS.map(absorb).filter(
  (a): a is Absorbed => a !== null,
);

export const ABSORPTION_COUNTS: Record<Channel, number> = {
  tag: ABSORPTION.filter((a) => a.channel === "tag").length,
  card: ABSORPTION.filter((a) => a.channel === "card").length,
  sublabel: ABSORPTION.filter((a) => a.channel === "sublabel").length,
};

/* ============================================================================================ */
/*  6. THE PLAN — boxes, boundaries and runs, all derived                                        */
/* ============================================================================================ */

export interface NodeBox extends Rect {
  id: string;
  spec: NodeSpec;
  kind: Kind;
  layer: LayerId;
  text: NodeText;
  status: Status;
  trust: boolean;
  /** The component `resolveItem` answers with when the camera stands over this node. */
  primary: string;
  components: readonly Component[];
}

export type BoundaryKind = "region" | "security-group";

export interface Boundary extends Rect {
  id: string;
  kind: BoundaryKind;
  label: string;
  note: string;
  wraps: readonly string[];
}

/** The layer a node's row stands for. The composition root's band is `surfaces`, per its system. */
export const layerOfNode = (spec: NodeSpec): LayerId =>
  (systemById(spec.systems[0]!)?.layer ?? "surfaces") as LayerId;

function boxOf(spec: NodeSpec): NodeBox {
  const systems = spec.systems.map((id) => systemById(id)).filter((s): s is System => Boolean(s));
  const components = spec.systems.flatMap((s) => componentsOf(s));
  const primarySystem = systems[0]!;
  const primary =
    components.find((c) => c.file === primarySystem.file)?.id ?? components[0]?.id ?? "";
  const unbuilt = components.filter((c) => c.status !== "built").length;
  return {
    id: spec.id,
    spec,
    x: COLS[spec.col],
    y: ROWS[spec.row],
    w: NODE.w,
    h: NODE.h,
    kind: kindOfSystem(primarySystem.id),
    layer: layerOfNode(spec),
    text: textOf(spec),
    status: unbuilt === components.length ? "planned" : unbuilt > 0 ? "partial" : "built",
    trust: spec.systems.some((s) => TRUST_SYSTEMS.includes(s)),
    primary,
    components,
  };
}

export const BOXES: readonly NodeBox[] = NODES.map(boxOf);
export const BOX_BY_ID: ReadonlyMap<string, NodeBox> = new Map(BOXES.map((b) => [b.id, b]));

const bbox = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x1 - x, h: y1 - y };
};

const pad = (r: Rect, p: { t: number; l: number; r: number; b: number }): Rect => ({
  x: r.x - p.l,
  y: r.y - p.t,
  w: r.w + p.l + p.r,
  h: r.h + p.t + p.b,
});

/**
 * THE TWO BOUNDARIES, DERIVED FROM MEMBERSHIP (study §7.4 — "never from authored rectangles").
 *
 *   region          the Athena runtime: everything below the surfaces band, which is exactly the
 *                   part of this repository that is Python running inside one process.
 *   security-group  the trust boundary: the four systems that decide whether something may run and
 *                   the row the decision leaves. It CROSSES the region's top edge, because the
 *                   first gate runs in the page — which is the single most useful thing this
 *                   drawing says about this repository, and it is a shape, not a sentence.
 */
const RUNTIME_ROWS: readonly RowId[] = ["channels", "lane", "harness", "core", "contracts"];

const runtimeMembers = BOXES.filter((b) => RUNTIME_ROWS.includes(b.spec.row));
const trustMembers = BOXES.filter((b) => b.trust);

export const BOUNDARIES: readonly Boundary[] = [
  {
    id: "b-runtime",
    kind: "region",
    label: "Athena runtime",
    note: `${runtimeMembers.length} nodes · src/athena`,
    wraps: runtimeMembers.map((b) => b.id),
    ...pad(bbox(runtimeMembers), REGION_PAD),
  },
  {
    id: "b-trust",
    kind: "security-group",
    label: "trust boundary",
    note: `${TRUST_SYSTEMS.length} systems, three layers apart`,
    wraps: trustMembers.map((b) => b.id),
    ...pad(bbox(trustMembers), TRUST_PAD),
  },
];

/* --------------------------------------- the spine ------------------------------------------ */

/**
 * THE TURN, AS DATA. README §3.2, twelve stops — the round-4/5 script, reused unchanged because it
 * is cited data rather than code, and because two variants of one atlas that told different turns
 * would be two atlases.
 */
export interface Stop {
  part: string;
  word: string;
  cite: string;
}

const SCRIPT: readonly Stop[] = [
  { part: "cmp-mod-panel", word: "message", cite: "README §3.2.1" },
  { part: "cmp-daemon-routes", word: "POST /run", cite: "README §3.2.1" },
  { part: "cmp-lane", word: "one turn", cite: "README §3.1 lane" },
  { part: "cmp-prompt", word: "compose", cite: "README §3.2.2" },
  { part: "cmp-cli-harness", word: "8 rounds", cite: "README §3.2.3" },
  { part: "cmp-hooks", word: "every call", cite: "README §3.2.4" },
  { part: "cmp-catalog", word: "ToolClass", cite: "README §3.3" },
  { part: "cmp-c-manifest", word: "flags", cite: "README §3.3" },
  { part: "cmp-approvals", word: "approval", cite: "README §3.2.4" },
  { part: "cmp-ledger", word: "one row", cite: "README §2, invariant 6" },
  { part: "cmp-daemon-sessions", word: "stream", cite: "README §3.1" },
  { part: "cmp-mod-panel", word: "back", cite: "README §3.2.6" },
];

export interface Hop {
  from: string;
  to: string;
  word: string;
  cite: string;
  index: number;
}

/**
 * The spine: the twelve stops projected onto the twelve nodes, with consecutive stops inside one
 * node collapsed. Ten hops — and the collapse is the abstraction working: `cmp-approvals` and
 * `cmp-ledger` are two stops of the turn and one box on the sheet.
 */
export const SPINE: readonly Hop[] = (() => {
  const nodes = SCRIPT.map((s) => {
    const component = componentById(s.part);
    const node = component ? nodeOfComponent(component) : undefined;
    return { ...s, node: node ?? "n-lane" };
  });
  const out: Hop[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const from = nodes[i - 1]!;
    const to = nodes[i]!;
    if (from.node === to.node) continue;
    out.push({ from: from.node, to: to.node, word: to.word, cite: to.cite, index: out.length + 1 });
  }
  return out;
})();

/* ---------------------------------- the runs that earn a line -------------------------------- */

export interface RunSpec {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  status: Status;
  label: string;
  emphasis: boolean;
  /** The authored module edges this one line stands for. The passport can list them. */
  weight: number;
  cite: string;
}

/** How many non-spine relationships may still earn a line. Archify's ceiling is 14 edges total. */
export const EDGE_CEILING = 14;

/** Every authored module edge, folded onto node pairs. The fold is the drawing's only edge source. */
function foldEdges() {
  const tally = new Map<
    string,
    { from: string; to: string; weight: number; kinds: Map<EdgeKind, number>; unbuilt: boolean }
  >();
  for (const e of EDGES) {
    const a = componentById(e.from);
    const b = componentById(e.to);
    if (!a || !b) continue;
    const from = nodeOfComponent(a);
    const to = nodeOfComponent(b);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}`;
    const hit = tally.get(key) ?? {
      from,
      to,
      weight: 0,
      kinds: new Map<EdgeKind, number>(),
      unbuilt: false,
    };
    hit.weight += 1;
    hit.kinds.set(e.kind, (hit.kinds.get(e.kind) ?? 0) + 1);
    if (a.status !== "built" || b.status !== "built") hit.unbuilt = true;
    tally.set(key, hit);
  }
  return tally;
}

export const FOLDED = foldEdges();

const dominant = (kinds: Map<EdgeKind, number>): EdgeKind => {
  let best: EdgeKind = "calls";
  let n = -1;
  for (const [kind, count] of kinds) {
    if (count > n) {
      n = count;
      best = kind;
    }
  }
  return best;
};

/** The authored module edges a node pair carries, IN EITHER DIRECTION. One line, one relationship. */
const bothWays = (from: string, to: string): number =>
  (FOLDED.get(`${from}|${to}`)?.weight ?? 0) + (FOLDED.get(`${to}|${from}`)?.weight ?? 0);

/**
 * THE FOUR SIDE BRANCHES, AUTHORED — because in archify abstraction is editorial, not statistical.
 *
 * "One obvious main path; side branches leave the nearest main-path node; remove low-value edges
 * before adding routing controls; put supporting detail in cards instead of more edges" (study §1).
 * A ranked fold over the 120 authored edges was tried first and it draws a fan of four `implements`
 * lines into `Contracts` — statistically correct, editorially useless, and a corridor two of them
 * have to share. So the four are named here, each one a claim a reader should leave with, and the
 * MODEL still has the last word: `kind`, `status` and `weight` are derived, and the test fails if a
 * pair is not carried by at least one real edge in `data/edges.ts`.
 *
 * The remaining ~100 authored edges are not lost. They are one hop away in the passport, which is
 * exactly where archify puts them: "put supporting detail in cards instead of more edges".
 */
export const BRANCHES: readonly { from: string; to: string; word: string }[] = [
  { from: "n-shell", to: "n-bridge", word: "injects" },
  { from: "n-shell", to: "n-channels", word: "sidecar" },
  { from: "n-root", to: "n-lane", word: "binds" },
  { from: "n-hooks", to: "n-record", word: "the row" },
];

/**
 * The runs: the spine in emphasis, then the four branches. Fourteen lines for 120 authored edges —
 * "remove low-value edges before adding routing controls" (`SKILL.md:77`) read as a budget.
 */
export const RUNS: readonly RunSpec[] = (() => {
  const out: RunSpec[] = SPINE.map((h) => {
    const folded = FOLDED.get(`${h.from}|${h.to}`) ?? FOLDED.get(`${h.to}|${h.from}`);
    return {
      id: `spine-${h.index}`,
      from: h.from,
      to: h.to,
      kind: folded ? dominant(folded.kinds) : "calls",
      status: (folded?.unbuilt ? "partial" : "built") as Status,
      label: `${h.index} ${h.word}`,
      emphasis: true,
      weight: bothWays(h.from, h.to),
      cite: h.cite,
    };
  });

  for (const b of BRANCHES) {
    if (out.length >= EDGE_CEILING) break;
    const folded = FOLDED.get(`${b.from}|${b.to}`);
    out.push({
      id: `branch-${b.from}-${b.to}`,
      from: b.from,
      to: b.to,
      kind: folded ? dominant(folded.kinds) : "calls",
      status: (folded?.unbuilt ? "planned" : "built") as Status,
      label: b.word,
      emphasis: false,
      weight: bothWays(b.from, b.to),
      cite: "data/edges.ts",
    });
  }
  return out;
})();

/** Every node carries at least one line: a box with no relationship is decoration. */
export const FLOATING: readonly string[] = NODES.filter(
  (n) => !RUNS.some((r) => r.from === n.id || r.to === n.id),
).map((n) => n.id);

/** What the drawing does NOT draw, stated rather than hidden. The legend prints it. */
export const EDGES_OMITTED = EDGES.length - RUNS.reduce((n, r) => n + r.weight, 0);

/* ------------------------------------------ helpers ------------------------------------------ */

export const centreOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const contains = (r: Rect, p: { x: number; y: number }): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const area = (r: Rect): number => r.w * r.h;

/** The bounding box of one layer's nodes — the rectangle `poseFor` frames at L1. */
export function layerBox(layer: LayerId): Rect | null {
  const here = BOXES.filter((b) => b.layer === layer);
  return here.length > 0 ? bbox(here) : null;
}

/** Kinds present, with counts — archify's `auto` legend (study §2). */
export function legendCounts(): { kind: Kind; n: number }[] {
  const tally = new Map<Kind, number>();
  for (const b of BOXES) tally.set(b.kind, (tally.get(b.kind) ?? 0) + 1);
  return [...tally]
    .map(([kind, n]) => ({ kind, n }))
    .sort((a, b) => b.n - a.n || (a.kind < b.kind ? -1 : 1));
}

/** The counted claim the sheet makes about itself, printed under the title. */
export const SHEET_COUNTS = {
  nodes: BOXES.length,
  boundaries: BOUNDARIES.length,
  runs: RUNS.length,
  systems: SYSTEMS.length,
  components: COMPONENTS.length,
  edges: EDGES.length,
};
