/**
 * Settling a company spelling: the fourth check's repair, as a pure state machine.
 *
 * The dossier prints four checks. Three have a repair in the AUTO bar; the company-spelling
 * conflict printed its competing spellings and offered nothing, although `resolve_company` is
 * reversible and AUTO. This is the repair's whole decision, kept out of the components so it can be
 * tested without a browser:
 *
 *   none        - the table is spelled one way; no chooser, no act
 *   choosing    - every spelling, consensus first, NOTHING chosen: which spelling is the company's
 *                 real name is the person's decision, not the data's
 *   previewing  - a spelling was chosen and its preview is out
 *   ready       - the preview came back; the act files exactly `plan.rewrites` contacts
 *   refused     - the preview said no, and why
 *
 * The count comes from the preview, never from the sheet: the planner rewrites every contact whose
 * stored company is not the chosen spelling character for character, while the sheet groups
 * spellings by their trimmed form, so `records - n` is wrong wherever whitespace variants exist.
 *
 * Every preview carries the spelling it was asked for. One that lands after the person moved to
 * another spelling is dropped, so the act is never offered against a plan for a spelling they left.
 */
import type { CompanyPlan } from "@/lib/mutations";

export interface Spelling {
  company: string;
  n: number;
}

export type SettleState =
  | { kind: "none" }
  | { kind: "choosing"; spellings: Spelling[] }
  | { kind: "previewing"; spellings: Spelling[]; spelling: string }
  | { kind: "ready"; spellings: Spelling[]; spelling: string; plan: CompanyPlan }
  | { kind: "refused"; spellings: Spelling[]; spelling: string; reason: string };

export type SettleEvent =
  | { type: "choose"; spelling: string }
  | { type: "previewed"; spelling: string; plan: CompanyPlan | string };

export const choose = (spelling: string): SettleEvent => ({ type: "choose", spelling });
export const previewed = (spelling: string, plan: CompanyPlan | string): SettleEvent => ({
  type: "previewed",
  spelling,
  plan,
});

/** Where a table starts: a chooser exactly when the sheet counts more than one spelling. */
export function settleState(table: { spellings: Spelling[] }): SettleState {
  if (table.spellings.length < 2) return { kind: "none" };
  return { kind: "choosing", spellings: table.spellings };
}

export function reduce(state: SettleState, event: SettleEvent): SettleState {
  if (state.kind === "none") return state;
  const { spellings } = state;
  if (event.type === "choose") {
    if (!spellings.some((s) => s.company === event.spelling)) return state;
    return { kind: "previewing", spellings, spelling: event.spelling };
  }
  // A preview answers only the spelling still being previewed; anything else is late.
  if (state.kind !== "previewing" || state.spelling !== event.spelling) return state;
  if (typeof event.plan === "string") {
    return { kind: "refused", spellings, spelling: event.spelling, reason: event.plan };
  }
  if (event.plan.rewrites === 0) {
    return {
      kind: "refused",
      spellings,
      spelling: event.spelling,
      reason: `Every contact on ${event.plan.domain} is already "${event.plan.canonical_name}".`,
    };
  }
  return { kind: "ready", spellings, spelling: event.spelling, plan: event.plan };
}

/** The spelling the person picked, if any: what the chooser marks pressed. */
export function chosen(state: SettleState): string | null {
  return state.kind === "none" || state.kind === "choosing" ? null : state.spelling;
}

/** The AUTO control: whether it may fire, and what it says. */
export function settleAct(state: SettleState): { enabled: boolean; label: string } {
  switch (state.kind) {
    case "none":
      return { enabled: false, label: "Spelled one way" };
    case "choosing":
      return { enabled: false, label: "Pick a company spelling above to file this table under it" };
    case "previewing":
      return { enabled: false, label: `Checking what filing under "${state.spelling}" changes…` };
    case "refused":
      return { enabled: false, label: state.reason };
    case "ready": {
      const n = state.plan.rewrites;
      return { enabled: true, label: `File ${n} contact${n === 1 ? "" : "s"} under "${state.spelling}"` };
    }
  }
}
