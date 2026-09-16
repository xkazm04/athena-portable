/**
 * THE CLOSED KIND ENUM. Archify study §1, §2, §7.1 — and the same mapping the baseline variant
 * uses, because the mapping is a claim about this repository and two drawings of one repository
 * may not disagree about what the gate is.
 *
 * COPIED, NOT IMPORTED. `variants/contract.ts` forbids a variant from reaching into a sibling's
 * folder, and the alternative — hoisting the mapping into a shared module — would make the
 * baseline's folder no longer self-contained. Copying nineteen cited rows is the cheaper mistake
 * (the same call `variants/archify/story.ts` made for the turn script), and
 * `test/density.sheet.test.ts` fails the day the model grows a system this file does not name.
 *
 * THE RULE, restated so this file can be read alone: a system's kind is the ROLE it plays in one
 * turn (README §3.2), never the directory it lives in.
 *
 *   frontend    a human looks at it, or it renders something a human looks at.
 *   messagebus  it carries a turn ACROSS a process boundary — a socket, a stream, an RPC.
 *   backend     it RUNS the turn: composes it, drives the engine, binds the classes.
 *   security    it DECIDES whether something may run. The gate, wherever the gate is.
 *   database    it owns durable state on disk.
 *   cloud       it reaches a third-party service across a network boundary we do not own.
 *   external    a declared shape, or a binary we do not ship.
 */

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

export const KIND_LABEL: Record<Kind, string> = {
  frontend: "Frontend",
  messagebus: "Message bus",
  backend: "Backend",
  security: "Security",
  database: "Database",
  cloud: "Cloud",
  external: "External",
};

export const KIND_RULE: Record<Kind, string> = {
  frontend: "a human looks at it",
  messagebus: "it carries a turn across a process boundary",
  backend: "it runs the turn",
  security: "it decides whether something may run",
  database: "it owns durable state on disk",
  cloud: "it reaches a service we do not own",
  external: "a declared shape, or a binary we do not ship",
};

/** Every system, by the rule. Nineteen entries — the model's own count, asserted in the test. */
export const SYSTEM_KIND: Record<string, Kind> = {
  /* surfaces */
  "sys-shell": "frontend",
  "sys-panel": "frontend",
  "sys-studio": "frontend",
  "sys-journey": "frontend",
  "sys-wiring": "backend",
  "sys-bridge": "security",
  /* channels */
  "sys-daemon": "messagebus",
  "sys-voice": "messagebus",
  "sys-mcp": "messagebus",
  /* lane */
  "sys-lane": "backend",
  /* harness */
  "sys-runner": "backend",
  "sys-hooks": "security",
  /* core */
  "sys-prompt": "backend",
  "sys-catalog": "security",
  "sys-record": "database",
  "sys-brain": "database",
  "sys-connectors": "cloud",
  /* contracts */
  "sys-seams": "external",
  "sys-vocab": "external",
};

export const kindOfSystem = (id: string): Kind => SYSTEM_KIND[id] ?? "external";

/**
 * The rose `security-group`: the gate and its receipt.
 *
 * Membership is authored — it is a claim about this repository, not a fold over a field — and the
 * FRAME IS DERIVED FROM IT (study §7.4). `sheet.ts` takes the bounding box of exactly the nodes
 * that carry one of these systems; nobody draws a rectangle.
 */
export const TRUST_SYSTEMS: readonly string[] = [
  "sys-bridge", // the gate in the page (tier 1)
  "sys-hooks", // the gate behind every engine
  "sys-catalog", // where the ToolClass is decided, once
  "sys-record", // the approval row and the ledger row the decision leaves behind
];
