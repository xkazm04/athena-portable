/**
 * THE GUIDED STORY: the twelve-stop turn as four chapters. Archify study §1 (`guidedViews`) and §4
 * (`guided-views.js`).
 *
 * Archify's stories are `{id, label, focus: [nodeId], note ≤ 140 chars}`, at most five, and the
 * viewer draws a **Story Trail overlay on top of the authored edge, which keeps its own style** —
 * practice §7.11, "overlays for derived paths; the authored edge is never mutated". Beats carry
 * `data-story-beat-state=past|active|next`; a chapter handoff computes enter/stay/leave and a
 * static preview shows the coming delta.
 *
 * THE SCRIPT IS ROUND 4'S, AS DATA. Twelve stops read straight off README §3.2, each naming a real
 * module and carrying the section it came from. It is copied rather than imported because it now
 * lives inside a sibling variant's folder and the contract forbids reaching across — and copying
 * twelve rows of cited data is the cheaper mistake. `test/archify.model.test.ts` fails if a stop
 * names a component the model does not have, and fails again if the twelve do not touch all six
 * layers, which is the same guard round 4 put on it.
 *
 * WHAT THIS VARIANT ADDS, and it is the reason the trail is worth drawing: **five of the eleven
 * hops are authored module edges and six are not.** The turn is a claim README §3.2 makes; the
 * edge list is a claim `data/edges.ts` makes; where they disagree the drawing says so, with a
 * derived hop drawn in a different dash and counted in the chapter's own receipt. A story overlay
 * that quietly straightened that out would be the decorative version of exactly this feature.
 *
 * THIS FILE MOVED HERE, UNCHANGED, WHEN `variants/archify/**` WAS DELETED after the round-6 verdict
 * — it is `archify/story.ts` under the one name that was free, because this folder's own `story.ts`
 * is the lane grid's trail and the script is the data that trail reads.
 */
import { EDGES, componentById, systemById } from "@/data";

export type StopKind = "enter" | "compose" | "run" | "gate" | "wait" | "write" | "return";

export interface Stop {
  part: string;
  label: string;
  kind: StopKind;
  cite: string;
}

/** README §3.2 in order, with §3.3's gate expanded into its three moments and §2's ledger row. */
const SCRIPT: readonly Stop[] = [
  { part: "cmp-mod-panel", label: "a message, with host_state, fenced", kind: "enter", cite: "README §3.2.1" },
  { part: "cmp-daemon-routes", label: "POST /run — the stream opens", kind: "enter", cite: "README §3.2.1" },
  { part: "cmp-lane", label: "one turn, streamed", kind: "run", cite: "README §3.1 lane" },
  { part: "cmp-prompt", label: "static blocks, and a turn frame", kind: "compose", cite: "README §3.2.2" },
  { part: "cmp-cli-harness", label: "up to eight rounds — one turn", kind: "run", cite: "README §3.2.3" },
  { part: "cmp-hooks", label: "every tool call passes the gate", kind: "gate", cite: "README §3.2.4" },
  { part: "cmp-catalog", label: "reversible? external? → GATED", kind: "gate", cite: "README §3.3" },
  { part: "cmp-c-manifest", label: "the manifest's own flags decide", kind: "gate", cite: "README §3.3" },
  { part: "cmp-approvals", label: "an approval row. The turn waits.", kind: "wait", cite: "README §3.2.4" },
  { part: "cmp-ledger", label: "one row, failures included", kind: "write", cite: "README §2, invariant 6" },
  { part: "cmp-daemon-sessions", label: "the stream carries it up", kind: "return", cite: "README §3.1" },
  { part: "cmp-mod-panel", label: "back where it started", kind: "return", cite: "README §3.2.6" },
];

export interface Beat extends Stop {
  index: number;
  /** The system the stop happens in — the node that lights at band 0. Derived, never typed. */
  system: string;
  layer: string;
  /** True when an authored module edge carries the hop FROM the previous stop to this one. */
  authored: boolean;
}

const AUTHORED = new Set(EDGES.map((e) => `${e.from}->${e.to}`));

export const BEATS: readonly Beat[] = SCRIPT.map((s, index) => {
  const component = componentById(s.part);
  const system = component?.system ?? "sys-lane";
  const prev = index > 0 ? SCRIPT[index - 1]!.part : null;
  return {
    ...s,
    index,
    system,
    layer: systemById(system)?.layer ?? "lane",
    authored: prev !== null && AUTHORED.has(`${prev}->${s.part}`),
  };
});

/* -------------------------------------------- chapters --------------------------------------- */

export interface Chapter {
  id: string;
  label: string;
  /** Archify caps a story note at 140 characters. So does this. */
  note: string;
  beats: readonly Beat[];
  /** The systems this chapter lights — archify's `focus: [nodeId]`. */
  focus: readonly string[];
}

const CUTS: readonly { id: string; label: string; note: string; from: number; to: number }[] = [
  {
    id: "arrive",
    label: "The turn arrives",
    note: "A message with fenced host state reaches the panel, crosses the one door, and becomes one streamed turn.",
    from: 0,
    to: 3,
  },
  {
    id: "compose",
    label: "Composed, then run",
    note: "Two outputs — a static prompt and a per-turn frame — then up to eight provider rounds that are still one turn.",
    from: 3,
    to: 5,
  },
  {
    id: "gate",
    label: "The gate",
    note: "The hook fires, the catalog decides the class in one module, the manifest's own flags answer, and the turn waits.",
    from: 5,
    to: 9,
  },
  {
    id: "receipt",
    label: "The receipt",
    note: "One ledger row, failures included, and the stream carries the answer back to where it started.",
    from: 9,
    to: 12,
  },
];

export const CHAPTERS: readonly Chapter[] = CUTS.map((c) => {
  const beats = BEATS.slice(c.from, c.to);
  return {
    id: c.id,
    label: c.label,
    note: c.note,
    beats,
    focus: [...new Set(beats.map((b) => b.system))],
  };
});

/** Which chapter a stop belongs to. */
export const chapterOf = (stop: number): number =>
  Math.max(0, CUTS.findIndex((c) => stop >= c.from && stop < c.to));

/**
 * The chapter handoff, archify's `≡ + −` receipt: what stays, what enters, what leaves.
 *
 * Computed against the PREVIOUS chapter's focus, so the preview a reader sees before pressing play
 * is the delta they are about to be shown rather than a count of the whole chapter.
 */
export interface Delta {
  stay: number;
  enter: number;
  leave: number;
}

export function deltaOf(index: number): Delta {
  const here = new Set(CHAPTERS[index]?.focus ?? []);
  const before = new Set(index > 0 ? (CHAPTERS[index - 1]?.focus ?? []) : []);
  let stay = 0;
  for (const id of here) if (before.has(id)) stay += 1;
  return { stay, enter: here.size - stay, leave: [...before].filter((id) => !here.has(id)).length };
}

/** Past / active / next, the three states archify gives a beat (opacity .72 / 1 / .5). */
export type BeatState = "past" | "active" | "next";

export const beatState = (index: number, stop: number): BeatState =>
  index < stop ? "past" : index === stop ? "active" : "next";

/** Every hop, as a pair. The Story Trail draws one overlay per hop, authored or not. */
export interface Hop {
  from: string;
  to: string;
  index: number;
  authored: boolean;
}

export const HOPS: readonly Hop[] = BEATS.slice(1).map((b, i) => ({
  from: BEATS[i]!.part,
  to: b.part,
  index: i + 1,
  authored: b.authored,
}));

/** The counts the Story Trail's own receipt prints. */
export const TRAIL_COUNTS = {
  hops: HOPS.length,
  authored: HOPS.filter((h) => h.authored).length,
  derived: HOPS.filter((h) => !h.authored).length,
};

export const stopAt = (index: number): Beat =>
  BEATS[Math.min(BEATS.length - 1, Math.max(0, index))]!;
