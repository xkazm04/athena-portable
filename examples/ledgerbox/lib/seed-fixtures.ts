/**
 * Static ingredients for the seed: the client book, the work a two-person studio bills for, and
 * the shapes a bank memo arrives in. Kept apart from `seed.ts` so the generator reads as a story.
 */
import type { Rng } from "@athena/demo-kit/seed";
import { PINEGROVE_ALIAS, companyByName } from "@athena/demo-kit/seed";
import type { Category } from "./constants";

export interface ClientSeed {
  name: string;
  address: string;
  /** Set on the one client who moved mid-quarter (design 4.6.1). */
  priorAddress?: string;
  addressChangedAt?: string;
  termsDays: number;
  note: string;
  /** Trading name the bank prints, when it is not the name on the invoice. */
  bankAlias?: string;
}

/**
 * Every client here is a company in the shared registry, and the check under
 * the list asserts it: a client the other two apps have never heard of cannot
 * take part in a cross-app scenario, so adding one means adding it there first.
 */
export const CLIENTS: ClientSeed[] = [
  { name: "Northbank Supply", address: "18 Wharf Road, Bristol BS1 4RN", termsDays: 30, note: "Pays on the last day of terms, every time." },
  { name: "Kestrel Labs", address: "2 Fen Court, Cambridge CB1 2AL", termsDays: 21, note: "Two retainers run in parallel; amounts repeat." },
  { name: "Marlow & Vine", address: "77 Chapel Street, Manchester M3 5BZ", termsDays: 14, note: "Small brand jobs, quick turnaround." },
  {
    name: "Pinegrove Collective",
    address: "Unit 5, Sawmill Yard, Sheffield S3 8DB",
    priorAddress: "12 Attercliffe Common, Sheffield S9 3QS",
    addressChangedAt: "2026-07-14T09:00:00.000Z",
    termsDays: 30,
    note: "Moved in July. Invoices before the 14th carry the old address.",
    bankAlias: PINEGROVE_ALIAS.bank,
  },
  { name: "Halcyon Works", address: "3 Quay Street, Glasgow G1 5PY", termsDays: 30, note: "Finance team batches payments on Fridays." },
  { name: "Brightwater Group", address: "40 Meadow Lane, Leeds LS11 5BD", termsDays: 21, note: "Purchase-order number must appear on every invoice." },
  { name: "Ironwood Studio", address: "9 Print Yard, Norwich NR3 1AB", termsDays: 14, note: "Sole trader; pays by card." },
  { name: "Solstice Partners", address: "220 Kingsway, London WC2B 6LH", termsDays: 30, note: "Settled 80% of the summer retainer and went quiet on the rest." },
  { name: "Verdant Supply", address: "6 Orchard Row, Exeter EX4 3PN", termsDays: 21, note: "Seasonal work, quiet until autumn." },
  { name: "Copperline Industries", address: "The Foundry, Newport NP20 1DT", termsDays: 30, note: "Their bank truncates the memo field." },
  { name: "Ashfield Works", address: "14 Miller Street, Derby DE1 3GB", termsDays: 21, note: "New this quarter." },
  { name: "Longitude Labs", address: "1 Harbour Steps, Plymouth PL1 3EW", termsDays: 30, note: "Disputing two line items from July." },
  { name: "Quarry House", address: "Quarry House, Bath BA1 2QZ", termsDays: 14, note: "Pays same week, always short by the wire fee." },
  { name: "Tideline Press", address: "8 Harbour Road, Whitstable CT5 1AB", termsDays: 21, note: "Print runs, invoiced on delivery." },
  { name: "Foxglove Studio", address: "31 Bell Lane, York YO1 9TD", termsDays: 14, note: "Referred by Marlow & Vine." },
];

for (const c of CLIENTS) {
  if (!companyByName(c.name)) {
    throw new Error(`ledgerbox client not in the shared registry: ${c.name}`);
  }
}

export const WORK: Record<Exclude<Category, "uncategorized">, string[]> = {
  design: ["Brand identity, second round", "Poster series artwork", "Packaging layout", "Editorial art direction", "Icon set, 24 marks"],
  development: ["Front-end build, sprint 3", "CMS migration", "Checkout rework", "Accessibility fixes", "Performance pass"],
  consulting: ["Discovery workshop, two days", "Design system audit", "Technical review", "Hiring panel support"],
  retainer: ["Monthly retainer", "Retainer overage, 6 hours", "Support retainer"],
  reimbursable: ["Photography licence", "Print proofs and courier", "Travel to client site", "Font licence, 3 seats"],
};

export const EXPENSE_MEMOS: [string, number, number][] = [
  ["STRIPE MONTHLY FEE", 2900, 2900],
  ["FIGMA ORG SEAT", 9000, 9000],
  ["ADOBE CC TEAMS", 8899, 8899],
  ["HETZNER CLOUD", 4212, 6740],
  ["COWORKING DESK - THE BINDERY", 24000, 24000],
  ["RAIL TICKET LDN-MAN", 6350, 11200],
  ["ACCOUNTANT RETAINER", 18000, 18000],
  ["INSURANCE PREMIUM", 4780, 4780],
  ["OFFICE SUPPLIES", 1120, 4400],
  ["DOMAIN RENEWAL", 1400, 3200],
  ["LAPTOP REPAIR", 18900, 18900],
  ["COFFEE + CLIENT LUNCH", 1850, 6400],
];

export const OTHER_CREDITS: [string, number][] = [
  ["INTEREST PAID", 412],
  ["TRANSFER FROM SAVINGS", 250000],
  ["HMRC VAT REFUND", 84300],
  ["REFUND - RAIL TICKET LDN-MAN", 6350],
];

/** The four shapes a payment memo arrives in. Only the first quotes the invoice number. */
export function memoFor(rng: Rng, clientName: string, number: string, alias?: string): string {
  const printed = (alias ?? clientName).toUpperCase();
  const squashed = printed.replace(/[^A-Z0-9]/g, "");
  switch (rng.int(0, 3)) {
    case 0:
      return `SEPA CR ${printed} INV ${number}`;
    case 1:
      return `TRANSFER FROM ${printed}`;
    case 2:
      return `ACH CREDIT ${squashed.slice(0, 14)}`;
    default:
      return `${printed} PAYMENT`;
  }
}

/** `2026-06-14T10:22:00.000Z` for a day offset from the start of the quarter. */
export function dayFrom(startIso: string, offsetDays: number, hour = 10, minute = 0): string {
  const d = new Date(startIso);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}
