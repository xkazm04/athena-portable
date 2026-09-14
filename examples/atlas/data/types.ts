/**
 * The model Atlas draws: this repository's own architecture, extracted by hand.
 *
 * NOTHING IS FETCHED. There is no database, no network call and no build step that reads the
 * source tree. Every entry below was read out of `README.md`, `docs/adr/*`, `AGENTS.md`, the
 * package READMEs and the first docstring line of the module it names — which is a fact this
 * repository's own law makes available, since "every module's first docstring line names the
 * design section it implements" (README §7).
 *
 * THE ONE CONTENT RULE: every entry cites the file it came from. A hand-extracted model is an
 * argument, and an argument that does not show its source is decoration. `file` is a
 * repository-relative path; `source` is the document section the claim was read from.
 *
 * `test/model.test.ts` holds the integrity of the shape: every edge endpoint exists, every
 * component belongs to exactly one system, every system to one layer, every concept lights at
 * least one component, and every part number is unique.
 */

/** The six layers of README §3.1, in the order it prints them (surfaces on top). */
export type LayerId = "surfaces" | "channels" | "lane" | "harness" | "core" | "contracts";

/**
 * What kind of claim a concept is.
 *
 *   invariant  one of the six of README §2 — what makes the features trustworthy
 *   tier       a rung of the onboarding ladder (README §1)
 *   act        one of the four acts of the demo (README §1)
 *   decision   a standing decision the architecture is shaped by (README §3.4, §4, §3.5)
 */
export type ConceptKind = "invariant" | "tier" | "act" | "decision";

/**
 * Whether the thing named is in the tree.
 *
 * `planned` is not a hedge, it is the point: an atlas of a machine that silently omits the parts
 * that were designed and not built is a sales brochure. README §3.1 lists `mcp` as a channel and
 * there is no `channels/mcp.py`; Atlas says so.
 */
export type Status = "built" | "partial" | "planned";

/** A rung of the ladder, an invariant, an act — the population at L0. */
export interface Concept {
  id: string;
  /** The part number printed on the cell, e.g. `I-3`. Unique across the whole model. */
  part: string;
  kind: ConceptKind;
  name: string;
  /** The claim itself, in one sentence, as close to the source's words as it can be. */
  claim: string;
  /** The document section it was read from. */
  source: string;
  /** The file that section lives in. */
  file: string;
}

/** One layer of README §3.1 — the group a reader opens to reach L1. */
export interface Layer {
  id: LayerId;
  part: string;
  name: string;
  /** README §3.1's own one-line description of the layer. */
  blurb: string;
  source: string;
  file: string;
}

/** One system inside a layer: a directory or a package that realises part of it. */
export interface System {
  id: string;
  part: string;
  layer: LayerId;
  name: string;
  blurb: string;
  /** Where it lives in the repository. */
  home: string;
  source: string;
  file: string;
  status: Status;
}

/** One module: the smallest thing Atlas will open at L2. */
export interface Component {
  id: string;
  part: string;
  /** Exactly one system. A component in two systems is a modelling error, not a nuance. */
  system: string;
  name: string;
  /** What it enforces — the reason it exists, not what it contains. */
  enforces: string;
  /** The repository path. This is the citation. */
  file: string;
  /** Concepts it carries. This is what the lens reads. */
  concepts: string[];
  /** ADR numbers that explain it, from `docs/adr/`. */
  adrs: number[];
  status: Status;
}

/**
 * How one component reaches another.
 *
 *   calls       runtime call or import
 *   implements  satisfies a port or a contract declared by the other
 *   gates       decides whether the other may run
 *   streams     emits events the other consumes
 *   reads       reads state the other owns
 */
export type EdgeKind = "calls" | "implements" | "gates" | "streams" | "reads";

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Why this edge exists, in a clause. */
  note: string;
}

/** An ADR, as Atlas cites it. */
export interface Adr {
  n: number;
  title: string;
  file: string;
}
