/**
 * The catalogue's and the topic page's figures — README section 3.5, ADR 0096 and 0133 (fix wave
 * chores-uat).
 *
 * Every figure says its source and its kind: the author's estimate in one `valueCell` that the
 * catalogue and the topic page's secondary line both read, so they cannot disagree; one money headline,
 * the example case's money back (`economics.example_usd`), or in words what the chore does for the
 * money when none of the example is money back; the flow's result and the totals line with money back
 * only; the time saved with the person's review counted; and the "Where it fits" rows from the
 * playbook's `fit`, none without one. Kept apart from `model.ts`, which the first frame loads, because
 * only the catalogue and the topic page read these. Pure.
 */
import { minutes, usd, type Fit, type Source, type ValueKind } from "@/lib/playbooks";
import {
  MONEY_KINDS,
  annualValue,
  isYearly,
  kindAmount,
  withReviewMinutes,
  type PlaybookView,
  type PlaybooksModel,
} from "@/modules/playbooks/model";

import { shortLine } from "./model";

/** A card's value as a cell says it, by its kind: "$24.10", "$36,000 protected", "" for a weight. */
export function cardValue(kind: ValueKind, value: number | null): string {
  if (!value || kind === "count") return "";
  return kind === "money_back" ? usd(value) : kindAmount(kind, value);
}

/** The word after an estimate's figure that says what kind of money it is. */
export const KIND_WORD: Record<Exclude<ValueKind, "count">, string> = {
  money_back: "back",
  money_protected: "protected",
  penalty_avoided: "in penalties avoided",
};

/**
 * The author's estimate, as every surface says it: on the year's scale where it has one, in its own
 * unit ("an episode") where not, with its kind's word. The catalogue cell and the topic page's
 * secondary line both read this, so they cannot disagree.
 */
export function valueCell(view: PlaybookView): { figure: string; per: string; kind: string } {
  return {
    figure: usd(annualValue(view.playbook)),
    per: isYearly(view.playbook) ? "a year" : view.per,
    kind: KIND_WORD[view.playbook.economics.valueKind],
  };
}

/** The compact line over the ledger: how many, how many beat their bar on the latest run, and the
 *  money back the test runs found (money back only; an exposure or a weight is never summed here). */
export function totalsLine(model: PlaybooksModel): string {
  const t = model.totals;
  return [
    `${t.count} ${t.count === 1 ? "playbook" : "playbooks"}`,
    t.benched ? `${t.exceeds} of ${t.benched} tested beat their bar on the latest run` : "none tested yet",
    t.foundUsd ? `${usd(t.foundUsd)} back found in test runs on invented cases` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What the flow's result and the topic's "mistakes avoided" are drawn from: the playbook and its run alone. */
export interface Blueprint {
  /** The mistakes the latest run walked past, of how many; `null` when there is no run to count. */
  guard: { avoided: number; of: number } | null;
  /** The flow's end: the money back her test run found (or the items, when none of it is money
   *  back), every other kind in its own words, or the bar it will be held to when untested. */
  result: { figure: string; line: string; measured: boolean };
}

export function blueprintOf(view: PlaybookView): Blueprint {
  const p = view.playbook;
  const b = p.bench;
  const ledger = b?.trapLedger ?? [];
  const of = ledger.length || b?.trapsTotal || 0;
  const avoided = ledger.length ? ledger.filter((t) => !t.filed).length : of - (b?.trapsFiled ?? 0);
  const back = view.tally?.money_back;
  const others = MONEY_KINDS.filter((k) => k !== "money_back").flatMap((k) => {
    const t = view.tally?.[k];
    return t && t.total ? [`${usd(t.found)} of ${kindAmount(k, t.total)}`] : [];
  });
  return {
    guard: b && of ? { avoided, of } : null,
    result: b
      ? {
          figure: back && back.total ? `${usd(back.found)} back` : `${b.found} of ${b.eligible}`,
          line: [
            `${b.found} of ${b.eligible} found${b.falseClaims ? `, ${b.falseClaims} false` : ", none false"}`,
            ...others,
          ].join("; "),
          measured: true,
        }
      : {
          figure: `${Math.round(p.expectation.recall * 100)}%`,
          line: "of what the example holds: the bar it will be held to, not tested yet",
          measured: false,
        },
  };
}

/** The before-and-after band: the chore by hand against the same chore with her, in the test run. */
export interface BeforeAfter {
  manual: { figure: string; line: string };
  /** Her run plus the person's review: `figure` counts both, `review` says the review's share. */
  athena: { figure: string; line: string; review: string } | null;
  /** "30× faster" (the ledger's own figure: by hand against her run plus your review), or "". */
  ratio: string;
}

export function beforeAfterOf(view: PlaybookView): BeforeAfter {
  const p = view.playbook;
  const b = p.bench;
  const review = b && b.yourTimeS ? `including about ${minutes(b.yourTimeS / 60)} of your review` : "";
  const parts = b
    ? [review, b.costUsd !== null ? `${usd(b.costUsd)} of model time` : ""].filter(Boolean)
    : [];
  return {
    manual: {
      figure: p.economics.manualMinutes ? minutes(p.economics.manualMinutes) : "–",
      line: p.economics.incumbent ? shortLine(p.economics.incumbent, 72) : "",
    },
    athena: b ? { figure: minutes(withReviewMinutes(b)), line: parts.join(" · "), review } : null,
    ratio: view.speed,
  };
}

/** What the topic page says of the chore's money: one headline, and the estimate beneath it. */
export interface Worth {
  /** The example case's money back ("$26,410"), or `null` when none of it is money back. */
  example: string | null;
  /** When there is no money back to show: what the chore does for the money instead, in words. */
  instead: string;
  /** "Typical value: about $20,000 a year, author's estimate". */
  estimate: string;
  basis: string;
  sources: readonly Source[];
  caveat: string;
}

const INSTEAD: Record<Exclude<ValueKind, "count">, string> = {
  money_back: "The example case holds no money back to count; it is scored by what she finds.",
  money_protected: "No money comes back in the example case: this chore protects money that is at risk.",
  penalty_avoided: "No money comes back in the example case: this chore keeps you clear of penalties.",
};

export function worthOf(view: PlaybookView): Worth {
  const p = view.playbook;
  const e = p.economics;
  const cell = valueCell(view);
  const kind = e.valueKind === "money_back" ? "" : ` ${cell.kind}`;
  return {
    example: e.exampleUsd !== null && e.exampleUsd > 0 ? usd(e.exampleUsd) : null,
    instead: INSTEAD[e.valueKind],
    estimate: `Typical value: about ${cell.figure} ${cell.per}${kind}, author's estimate`,
    basis: e.basis,
    sources: e.sources,
    caveat: p.caveat,
  };
}

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "the District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico",
};
const REGIONS: Record<string, string> = { US: "the United States", EU: "the European Union", UK: "the United Kingdom" };

/** "Texas", "California or Oregon", "the United States": where a chore's rules hold, in words. */
export function whereWords(where: readonly string[]): string {
  const names = where.map((w) => STATES[w.toUpperCase()] ?? REGIONS[w.toUpperCase()] ?? w);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The "Where it fits" rows, in reading order; a row the file leaves empty is not drawn. `[]` without a fit. */
export function fitRows(fit: Fit | null): { label: string; text: string }[] {
  if (fit === null) return [];
  const where = [whereWords(fit.where), fit.whereNote].filter(Boolean).join(". ");
  return [
    { label: "Where", text: where },
    { label: "Who it is for", text: fit.who },
    { label: "Not for", text: fit.notFor },
    { label: "She will ask you for", text: fit.asksFor.join("; ") },
    { label: "What it costs", text: fit.costs },
  ].filter((r) => r.text);
}
