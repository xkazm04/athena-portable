/**
 * The Playbooks module's fixtures — view-models for `preview.html?module=playbooks&fixture=`.
 *
 * Built from raw JSON through `parsePlaybook`, the same reader the shipped set goes through, so a
 * fixture cannot drift into a shape no real `playbook.json` could produce. They are invented and
 * stay invented: the shipped playbooks change every round, and a fixture that tracked them would
 * be a second copy to keep in step.
 */
import type { FixtureId } from "@/modules/types";
import { PLAYBOOKS, parsePlaybook, type Playbook } from "@/lib/playbooks";

import { selectPlaybooks, type PlaybookActions, type PlaybooksModel } from "./model";

const NOOP: PlaybookActions = { copy: () => {}, open: () => {}, hand: () => {} };

function book(raw: Record<string, unknown>, bench: Record<string, unknown> | null = null): Playbook {
  const p = parsePlaybook(raw, bench);
  if (p === null) throw new Error("fixture without an id");
  return p;
}

const REFUNDS = book(
  {
    id: "carrier-refunds",
    title: "Late-parcel refunds",
    domain: "E-commerce",
    promise:
      "Every late parcel's refund found across the carrier's invoices and your orders, filed for your signature.",
    persona: "A store shipping 900 parcels a month",
    chore:
      "Open the carrier's billing centre, export the invoice, compare each delivery against its guarantee, check the exceptions, then file one claim at a time within 15 days.",
    command:
      "Go through this week's carrier invoice, find every parcel that missed its guaranteed time without a covered exception, and file a refund claim for each.",
    apps: [
      { name: "Carrier billing centre", role: "the invoices and tracking", api: "No API for small accounts" },
      { name: "Store admin", role: "the orders and addresses", api: "Orders only, no carrier data" },
    ],
    steps: [
      "Reads the week's invoice, a page at a time.",
      "Checks each delivery against its guaranteed time.",
      "Rules out weather, address and signature exceptions.",
      "Files one claim per late parcel, each a card.",
    ],
    gates: [{ action: "file_claim", label: "File a refund claim", why: "It reaches the carrier and can be filed once." }],
    traps: ["A weather exception looks late and is not refundable.", "A parcel already claimed last week."],
    memory: ["The 15-day filing window.", "Which exception codes void a refund."],
    economics: {
      value_usd: 4940,
      per: "year",
      manual_minutes: 180,
      incumbent: "Refund-audit services keep half of what they recover.",
      sources: [{ label: "Carrier service guarantee terms", url: "https://example.com/terms" }],
    },
    edge: {
      difficulty: 4,
      usefulness: 5,
      difficulty_why: "Portal-locked and cross-system.",
      usefulness_why: "Money left on the table every week.",
    },
    expectation: { recall: 0.7, false_claims: 0, minutes: 20 },
  },
  {
    run_at: "2026-10-07T22:10:00Z",
    engine: "claude_code",
    model: "sonnet",
    wall_s: 372,
    turns: 9,
    reads: 6,
    cost_usd: 0.41,
    your_time_s: 150,
    verdict: { word: "exceeds", reasons: [], minutes: 6.2 },
    score: {
      eligible: 5,
      found: 5,
      exact: 5,
      value_total_usd: 96.4,
      value_found_usd: 96.4,
      false_claims: 0,
      duplicates: 0,
    },
    cards: [
      { action: "file_claim", key: "1Z88A0", outcome: "correct", value_usd: 24.1, exact: true },
      { action: "file_claim", key: "1Z88A3", outcome: "correct", value_usd: 18.75, exact: true },
      { action: "file_claim", key: "1Z88B1", outcome: "correct", value_usd: 21.3, exact: true },
      { action: "file_claim", key: "1Z88C4", outcome: "correct", value_usd: 16.9, exact: true },
      { action: "file_claim", key: "1Z88C9", outcome: "correct", value_usd: 15.35, exact: true },
    ],
    missed: [],
    closing_words:
      "Five parcels missed their guaranteed time with no covered exception; each claim is a card waiting for you. I left out 1Z88B7 (weather) and 1Z88A9 (claimed on 30 September).",
  },
);

const CHARGEBACKS = book(
  {
    id: "chargeback-evidence",
    title: "Chargeback evidence packs",
    domain: "Payments",
    promise: "A dispute answered with the order, the tracking and the customer's own words, before the deadline.",
    persona: "A shop with 12 disputes a month",
    chore: "Pull the order, the shipment proof and the support thread from three systems into one response.",
    command: "Answer every open dispute that is winnable, with evidence from the orders, the tracking and the inbox.",
    apps: [
      { name: "Payments dashboard", role: "the disputes", api: "Evidence upload is manual" },
      { name: "Support inbox", role: "the customer's messages", api: "" },
      { name: "Carrier tracking", role: "proof of delivery", api: "" },
    ],
    economics: { value_usd: 1800, per: "month", manual_minutes: 45, incumbent: "Dispute services take 20–30% of what they win." },
    edge: { difficulty: 4, usefulness: 4 },
    expectation: { recall: 0.6, false_claims: 0, minutes: 25 },
  },
  {
    run_at: "2026-10-07T23:40:00Z",
    engine: "claude_code",
    model: "sonnet",
    wall_s: 1640,
    turns: 21,
    reads: 15,
    cost_usd: 1.12,
    your_time_s: 120,
    verdict: { word: "short", reasons: ["took 27.3 min, expected at most 25"], minutes: 27.3 },
    score: {
      eligible: 4,
      found: 3,
      exact: 3,
      value_total_usd: 612,
      value_found_usd: 455,
      false_claims: 1,
      duplicates: 0,
    },
    cards: [
      { action: "submit_evidence", key: "DP-118", outcome: "correct", value_usd: 189, exact: true },
      { action: "submit_evidence", key: "DP-121", outcome: "correct", value_usd: 142, exact: true },
      { action: "submit_evidence", key: "DP-124", outcome: "trap", why: "Refunded already; contesting it loses the fee twice." },
      { action: "submit_evidence", key: "DP-130", outcome: "correct", value_usd: 124, exact: true },
    ],
    missed: [{ action: "submit_evidence", key: "DP-127", value_usd: 157 }],
  },
);

const FLIGHTS = book({
  id: "flight-compensation",
  title: "Delayed-flight compensation",
  domain: "Daily life",
  promise: "Every delay that qualifies, claimed from the airline directly, with no agency's cut.",
  persona: "A family that flies four times a year",
  chore: "Find the booking, check the delay against the rules, and fill the airline's own form.",
  command: "Check my flights this year for delays that qualify for compensation and claim each one.",
  apps: [
    { name: "Mail", role: "the bookings", api: "" },
    { name: "Airline claim form", role: "the claim", api: "No API" },
  ],
  economics: { value_usd: 600, per: "year", manual_minutes: 60, incumbent: "Claim agencies keep 25–35%." },
  edge: { difficulty: 3, usefulness: 3 },
  expectation: { recall: 0.8, false_claims: 0, minutes: 15 },
});

const MORE: Playbook[] = Array.from({ length: 5 }, (_, i) =>
  book({
    id: `more-${i}`,
    title: ["Seat audit", "Freight invoice audit", "Rent ledger check", "Price-drop refunds", "Denied-claim appeals"][i],
    domain: ["SaaS", "Logistics", "Property", "Daily life", "Clinics"][i],
    promise: "A further playbook for the heavy fixture.",
    command: "Do the chore.",
    economics: { value_usd: [3200, 18000, 900, 240, 26000][i], per: "year", manual_minutes: [120, 600, 60, 30, 900][i] },
    edge: { difficulty: [2, 5, 3, 2, 5][i], usefulness: [3, 5, 2, 2, 5][i] },
    expectation: { recall: 0.7, false_claims: 0, minutes: 30 },
  }),
);

const sorted = (list: Playbook[]) =>
  [...list].sort(
    (a, b) => b.edge.difficulty * b.edge.usefulness - a.edge.difficulty * a.edge.usefulness,
  );

export const fixtures: Record<FixtureId, PlaybooksModel> = {
  empty: selectPlaybooks([], NOOP),
  typical: selectPlaybooks(sorted([REFUNDS, CHARGEBACKS, FLIGHTS]), NOOP),
  heavy: selectPlaybooks(sorted([REFUNDS, CHARGEBACKS, FLIGHTS, ...MORE]), NOOP),
  degraded: selectPlaybooks([book({ id: "half-written", title: "A half-written playbook" })], NOOP),
  open: selectPlaybooks(sorted([REFUNDS, CHARGEBACKS, FLIGHTS]), NOOP),
  "open-short": selectPlaybooks(sorted([REFUNDS, CHARGEBACKS, FLIGHTS]), NOOP),
  "open-unbenched": selectPlaybooks(sorted([REFUNDS, CHARGEBACKS, FLIGHTS]), NOOP),
  /** What this build actually ships, with its real bench runs: the one fixture that is not invented. */
  shipped: selectPlaybooks(PLAYBOOKS, NOOP),
  "shipped-open": selectPlaybooks(PLAYBOOKS, NOOP),
};

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

/** The fixtures that render a playbook's layer open, and which one. */
export function initialOpenFor(fixture: FixtureId): string | null {
  switch (fixture) {
    case "open":
      return REFUNDS.id;
    case "open-short":
      return CHARGEBACKS.id;
    case "open-unbenched":
      return FLIGHTS.id;
    case "shipped-open":
      return PLAYBOOKS[0]?.id ?? null;
    default:
      return null;
  }
}
