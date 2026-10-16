/**
 * THE CLOSED KIND ENUM, AND THE ONE RULE THAT ASSIGNS IT. Archify study §1, §2, §7.1.
 *
 * Archify's architecture schema has exactly seven component types —
 * `frontend | backend | database | cloud | security | messagebus | external` — with one colour per
 * meaning and no decorative accents. Our model has no such field: it has six LAYERS (where a thing
 * sits) and a status. A layer is not a kind. `core` contains the brain (state on disk), the catalog
 * (a policy), the composer (compute) and the connectors (a third party); painting all four the same
 * colour says nothing, and painting them by layer would make the colour a duplicate of the row.
 *
 * SO THE RULE IS ABOUT THE TURN, NOT ABOUT THE DIRECTORY:
 *
 *     A system's kind is the ROLE it plays in one turn (README §3.2).
 *
 *       frontend    a human looks at it, or it renders something a human looks at.
 *       messagebus  it carries a turn ACROSS a process boundary — a socket, a stream, an RPC.
 *       backend     it RUNS the turn: composes it, drives the engine, binds the classes.
 *       security    it DECIDES whether something may run. The gate, wherever the gate is.
 *       database    it owns durable state on disk and is the reason the state survives a restart.
 *       cloud       it reaches a third-party service across a network boundary we do not own.
 *       external    it is not behaviour at all: a declared shape, or a binary we do not ship.
 *
 * That rule is the whole mapping and it is written here once. Two consequences worth stating,
 * because they are the findings the colour makes visible:
 *
 *   1. THE GATE IS NOT A LAYER. `security` lands on the bridge (surfaces), the hooks (harness) and
 *      the catalog (core) — three layers apart. The `trust` boundary below is the rose
 *      `security-group` drawn around them plus the record, and it crosses four layer regions. That
 *      is the single most useful thing this drawing says about this repository.
 *   2. CONTRACTS ARE `external`. Not because they are third-party — they are ours — but because
 *      they are the only part of the model a turn cannot EXECUTE. `external` is archify's slate:
 *      the kind for a thing you depend on and never run. ADR 0002 says the contracts import
 *      nothing and reach nothing; a colour that says "not behaviour" is the honest one.
 *
 * COMPONENT KINDS INHERIT THEIR SYSTEM'S, with five named exceptions listed below — a module whose
 * own job differs from its system's role. Every exception carries its reason on the same line,
 * because an unexplained exception is an opinion and there is no room for one in a legend.
 *
 * THIS FILE MOVED HERE, UNCHANGED, WHEN `variants/archify/**` WAS DELETED after the round-6 verdict
 * — the lanes variant is the only drawing left and the contract forbids importing from a sibling.
 */
import { COMPONENTS, SYSTEMS, type Component } from "@/data";

/** Archify's closed seven-set, in the legend's canonical order. Nothing may be added. */
export const KINDS = [
  "frontend",
  "messagebus",
  "backend",
  "security",
  "database",
  "cloud",
  "external",
] as const;

export type Kind = (typeof KINDS)[number];

/** The rule above, in one clause per kind. */
export const KIND_RULE: Record<Kind, string> = {
  frontend: "a human looks at it",
  messagebus: "it carries a turn across a process boundary",
  backend: "it runs the turn",
  security: "it decides whether something may run",
  database: "it owns durable state on disk",
  cloud: "it reaches a service we do not own",
  external: "a declared shape, or a binary we do not ship",
};

/* --------------------------------------- the mapping ---------------------------------------- */

/**
 * Every system, by the rule. Nineteen entries, all seven kinds used.
 *
 * `test/archify.model.test.ts` asserts this covers SYSTEMS exactly — a system added to the model
 * with no kind fails the build rather than rendering in a default colour nobody chose.
 */
export const SYSTEM_KIND: Record<string, Kind> = {
  /* surfaces */
  "sys-shell": "frontend", // the Tauri window
  "sys-panel": "frontend", // the modules in it
  "sys-studio": "frontend", // four host apps
  "sys-journey": "frontend", // drives those surfaces in a real Chromium
  "sys-wiring": "backend", // binds the real classes and boots them
  "sys-bridge": "security", // the gate every surface runs, in the page
  /* channels */
  "sys-daemon": "messagebus", // HTTP + SSE across the process boundary
  "sys-voice": "messagebus", // a WebSocket on the same port
  "sys-mcp": "messagebus", // JSON-RPC, designed and not built
  /* lane */
  "sys-lane": "backend", // one turn, streamed
  /* harness */
  "sys-runner": "backend", // drives the engine
  "sys-hooks": "security", // every tool call passes it
  /* core */
  "sys-prompt": "backend", // composes the turn
  "sys-catalog": "security", // assigns the ToolClass — the policy itself
  "sys-record": "database", // approvals and the ledger: two durable tables
  "sys-brain": "database", // one markdown file per memory, an index beside it
  "sys-connectors": "cloud", // a third-party service behind one spec and one vault
  /* contracts */
  "sys-seams": "external", // dataclasses only
  "sys-vocab": "external", // the words, and the closed refusal set
};

/**
 * The five modules whose own job is not their system's role.
 *
 * Each one is a place where the drawing would otherwise lie about what a reader is looking at.
 */
export const COMPONENT_KIND: Record<string, Kind> = {
  "cmp-shell-store": "database", // a key/value table with a size cap: state, inside a frontend
  "cmp-shell-daemon": "messagebus", // the sidecar's lifetime and its port: a channel, not chrome
  "cmp-engines": "external", // a provider CLI we probe and do not ship
  "cmp-transports": "external", // how that CLI is actually run
  "cmp-conn-vault": "security", // the credential boundary inside a cloud system
};

export const kindOfSystem = (id: string): Kind => SYSTEM_KIND[id] ?? "external";

export const kindOfComponent = (c: Component): Kind =>
  COMPONENT_KIND[c.id] ?? kindOfSystem(c.system);

/* ------------------------------------- the trust boundary ------------------------------------ */

/**
 * The gate and its receipt: the systems the round-5 sheet framed as its rose `security-group`.
 *
 * Membership is authored (it is a claim about this repository, not a fold over a field). The lane
 * drawing draws no frame around it — the `policy` exception lane in `workflow.ts` says the same
 * thing by position — so this list survives as the claim `test/lanes.model.test.ts` checks: real
 * systems, more than one layer apart.
 */
export const TRUST_SYSTEMS: readonly string[] = [
  "sys-bridge", // the gate in the page (tier 1)
  "sys-hooks", // the gate behind every engine
  "sys-catalog", // where the class is decided, once
  "sys-record", // the approval row and the ledger row the decision leaves behind
];

/* ------------------------------------------ counts ------------------------------------------- */

export interface KindCount {
  kind: Kind;
  systems: number;
  components: number;
}

/**
 * The counted legend (study §2: "`auto` shows only kinds present, with counts").
 *
 * One measurement, shared by the legend, the LENS filter and the tests, so a chip that says 4 and
 * a filter that reveals 3 cannot both be right.
 */
export function countKinds(): KindCount[] {
  const systems = new Map<Kind, number>();
  const components = new Map<Kind, number>();
  for (const s of SYSTEMS) {
    const k = kindOfSystem(s.id);
    systems.set(k, (systems.get(k) ?? 0) + 1);
  }
  for (const c of COMPONENTS) {
    const k = kindOfComponent(c);
    components.set(k, (components.get(k) ?? 0) + 1);
  }
  return KINDS.filter((k) => (systems.get(k) ?? 0) + (components.get(k) ?? 0) > 0).map((kind) => ({
    kind,
    systems: systems.get(kind) ?? 0,
    components: components.get(kind) ?? 0,
  }));
}

export const KIND_COUNTS: readonly KindCount[] = countKinds();
