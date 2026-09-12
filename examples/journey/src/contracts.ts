/**
 * README section 1 â€” the four acts, expressed as field access over what the apps answer.
 *
 * Every read of an application's answer goes through a small named function here and nowhere
 * else, so a field that moves is one edit in this file and none in `tests/journey.spec.ts`. The
 * tool *names* are the stable half of the contract with the three app agents; the shape of what a
 * tool answers is theirs.
 *
 * All three apps have delivered their contracts and the adapters below are written against them,
 * with the older spellings kept as fallbacks so one app rolling back a field does not take the
 * journey with it.
 *
 * Two rules keep this honest. An adapter accepts more than one spelling of the field it wants,
 * and an adapter that cannot find its field throws with the value it was given rather than
 * returning a plausible default â€” a silent `?? 0` is a beat that passes while asserting nothing.
 *
 * The cross-app constants come from the shared seed the three apps read
 * (`examples/demo-kit/src/seed/companies.ts`), so the journey checks the apps against the registry
 * they were built from rather than a copy that can drift.
 */
export {
  COMPANIES,
  KESTREL_APPLICANT,
  PINEGROVE_ALIAS,
  QUIET_CLIENT,
  STUDIO,
  companyByName,
  companyDomain,
  type Company,
  type Person,
} from "../../demo-kit/src/seed/companies.ts";
import { COMPANIES, companyByName } from "../../demo-kit/src/seed/companies.ts";

export type Row = Record<string, unknown>;

/** Where the list is, in the kit's `{ showing, of, items }` envelope or any of its predecessors. */
const LIST_KEYS = [
  "items",
  "rows",
  "results",
  "messages",
  "pages",
  "records",
  "contacts",
  "invoices",
  "credits",
  "clients",
  "applicants",
  "candidates",
  "slots",
  "companies",
  "pairs",
  "domains",
  "changes",
] as const;

export function itemsOf(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object") {
    const record = value as Row;
    for (const key of LIST_KEYS) {
      const held = record[key];
      if (Array.isArray(held)) return held as Row[];
      // One level down: `export` nests its list under `companies: { showing, total, items }`.
      if (held && typeof held === "object" && Array.isArray((held as Row).items)) {
        return (held as Row).items as Row[];
      }
    }
  }
  throw new Error(`expected a bounded envelope or a list, got ${preview(value)}`);
}

/** `(showing N of M)` as numbers: the pair the kit promises on every bounded answer. */
export function boundsOf(value: unknown): { showing: number; of: number } {
  const record = asRow(value);
  const showing = num(record.showing ?? itemsOf(value).length);
  const of = num(record.of ?? record.total ?? showing);
  return { showing, of };
}

function asRow(value: unknown): Row {
  if (!value || typeof value !== "object") throw new Error(`expected an object, got ${preview(value)}`);
  return value as Row;
}

function pick(row: Row, keys: readonly string[], what: string): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  throw new Error(`no ${what} on ${preview(row)} (looked for ${keys.join(", ")})`);
}

function str(value: unknown): string {
  return String(value);
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`not a number: ${preview(value)}`);
  return parsed;
}

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > 240 ? `${text.slice(0, 240)}...` : String(text);
}

/** Run an adapter that may not find its field, with a stated fallback. Only ever for a filter. */
export function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// --- act 1, Ledgerbox -------------------------------------------------------------------------

/** One invoice as `read_inbox` projects it (the contract's `Row`). */
export const invoice = {
  id: (row: Row): string => str(pick(row, ["id", "invoice_id"], "invoice id")),
  number: (row: Row): string => str(pick(row, ["number", "invoice_number", "id"], "invoice number")),
  client: (row: Row): string => str(pick(row, ["client", "client_name", "customer"], "client name")),
  daysOverdue: (row: Row): number => num(pick(row, ["days_overdue", "overdue_days", "age_days"], "days overdue")),
  balance: (row: Row): number => num(pick(row, ["balance", "outstanding", "amount"], "balance")),
  state: (row: Row): string => str(pick(row, ["state", "status"], "invoice state")),
  /** How much of it is paid, 0â€¦1. The signal act 1 skips a chase on. */
  paidRatio: (row: Row): number => {
    const held = row.paid_ratio;
    if (held !== undefined && held !== null) return num(held);
    return num(pick(row, ["paid"], "paid amount")) / num(pick(row, ["amount"], "invoice amount"));
  },
  /** The app's own judgement, when it offers one, rather than a ratio the runner re-derives. */
  mostlyPaid: (row: Row): boolean => row.mostly_paid === true || safe(() => invoice.paidRatio(row), 0) >= 0.8,
  /** The billing address a chase goes to; falls back to the shared registry by client name. */
  contactEmail: (row: Row): string => {
    const carried = row.contact_email ?? row.email;
    if (typeof carried === "string" && carried.includes("@")) return carried.toLowerCase();
    return contactEmailFor(invoice.client(row));
  },
};

/** The registry contact for a client name â€” the address act 1's chases are allowed to reach. */
export function contactEmailFor(clientName: string): string {
  const company = companyByName(clientName) ?? COMPANIES.find((c) => clientName.includes(c.name));
  if (!company) throw new Error(`no company named ${clientName} in the shared registry`);
  return company.contact.email.toLowerCase();
}

/** One unapplied bank credit (the contract's `Credit`). */
export const credit = {
  id: (row: Row): string => str(pick(row, ["line_id", "id", "bank_line_id"], "bank line id")),
  memo: (row: Row): string => str(pick(row, ["memo", "description", "narrative"], "memo")),
  amount: (row: Row): number => num(pick(row, ["amount", "value"], "credit amount")),
  /** The app's own verdict when it has one; otherwise derived from the candidate count. */
  ambiguous: (row: Row): boolean => {
    if (typeof row.ambiguous === "boolean") return row.ambiguous;
    return credit.candidates(row).length > 1;
  },
  candidates: (row: Row): Row[] => {
    const held = row.could_be ?? row.candidates ?? row.matches;
    return Array.isArray(held) ? (held as Row[]) : [];
  },
  /** The trading name the money arrived under, when the app knows it is not the client's name. */
  alias: (row: Row): string | null => {
    const held = row.counterparty_alias ?? row.alias;
    return typeof held === "string" && held.length > 0 ? held : null;
  },
};

export const candidate = {
  invoiceId: (row: Row): string => str(pick(row, ["invoice_id", "id"], "candidate invoice id")),
  confidence: (row: Row): string => str(pick(row, ["confidence", "verdict"], "confidence")),
};

/**
 * The invoice this credit unambiguously settles, or `null`.
 *
 * The contract's shape is one `could_be` entry for each of the fourteen unambiguous credits, an
 * `ambiguous: true` flag on the one that has two, and no candidate at all on the four that are
 * not the studio's money. All three cases answer here so the act reads as one loop.
 */
export function unambiguousMatch(row: Row): string | null {
  if (credit.ambiguous(row)) return null;
  const candidates = credit.candidates(row);
  if (candidates.length === 1) return candidate.invoiceId(candidates[0]!);
  const ids = row.candidate_invoice_ids;
  if (Array.isArray(ids) && ids.length === 1) return String(ids[0]);
  return null;
}

/** The alias a `match_bank_line` answer reports, when the credit came under a trading name. */
export function aliasFromMatch(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as Row;
    const held = parsed.counterparty_alias;
    if (typeof held === "string" && held.length > 0) return held;
  } catch {
    /* the answer is a sentence, not JSON */
  }
  const found = /([A-Z][A-Z ]{4,})\b/.exec(output);
  return found ? found[1]!.trim() : null;
}

/** The chase `draft_reminder` produced: who it is addressed to and what it says. */
export const draft = {
  of: (value: unknown): Row => {
    if (value && typeof value === "object" && (value as Row).draft) return (value as Row).draft as Row;
    return asRow(value);
  },
  to: (row: Row): string => str(pick(row, ["to", "to_email", "recipient"], "draft recipient")).toLowerCase(),
  from: (row: Row): string => str(pick(row, ["from", "sender"], "draft sender")).toLowerCase(),
  subject: (row: Row): string => str(pick(row, ["subject", "title"], "draft subject")),
  body: (row: Row): string => str(pick(row, ["body", "text", "message"], "draft body")),
};

/** The tone act 1 chases in: firm for the oldest debt, gentle for everything else. */
export function toneFor(row: Row, oldest: Row): "firm" | "gentle" {
  return invoice.id(row) === invoice.id(oldest) ? "firm" : "gentle";
}

/** The markdown an export answers with, whatever it wraps it in. */
export function bodyOf(value: unknown): string {
  if (typeof value === "string") return value;
  const row = asRow(value);
  return str(pick(row, ["markdown", "body", "message"], "export body"));
}

// --- act 2, Hirelane ---------------------------------------------------------------------------

/** The req act 2 works: the backend role, by the id the app answers `read_applicants` for. */
export const BACKEND_ROLE = "role_backend";

/** One applicant as `read_applicants` projects them. */
export const applicant = {
  id: (row: Row): string => str(pick(row, ["id", "applicant_id", "candidate_id"], "applicant id")),
  name: (row: Row): string => str(pick(row, ["name", "applicant", "full_name"], "applicant name")),
  /**
   * The key for everything in this act. Two other borderline applicants share a first or a last
   * name with the Kestrel one, so a beat that matched on name would match the wrong person and
   * still pass — which is exactly the failure the cross-app thread is supposed to catch.
   */
  email: (row: Row): string => str(pick(row, ["email", "contact_email"], "applicant email")).toLowerCase(),
  stage: (row: Row): string => str(pick(row, ["stage", "status", "column"], "stage")).toLowerCase(),
  employer: (row: Row): string => {
    const held = row.employer ?? row.current_employer ?? row.company;
    return held === undefined || held === null ? "" : str(held);
  },
  employerDomain: (row: Row): string => {
    const held = row.employer_domain ?? row.domain;
    return held === undefined || held === null ? "" : str(held).toLowerCase();
  },
  /** `null` until the rubric has run: "not scored yet" is a state act 2 acts on. */
  score: (row: Row): number | null => {
    const held = row.score ?? row.rubric_score ?? row.rating;
    return held === undefined || held === null ? null : num(held);
  },
  scored: (row: Row): boolean => (typeof row.scored === "boolean" ? row.scored : applicant.score(row) !== null),
  /** The app's own verdict on who the rubric does not decide. */
  borderline: (row: Row): boolean => row.borderline === true,
  /** What the rubric could not evidence — the reason a person has to look. */
  gap: (row: Row): string => {
    const held = row.gap ?? row.missing;
    return held === undefined || held === null ? "" : str(held);
  },
};

/** An answer that refused: `{ ok: false, error, roles }` for an unknown role id. */
export function refusedAnswer(value: unknown): string | null {
  if (value && typeof value === "object" && (value as Row).ok === false) {
    return str((value as Row).error ?? "refused");
  }
  return null;
}

/** The mail a gated send composed: `{ ok, message, to, subject, body }`. */
export const outbound = {
  to: (value: unknown): string => str(pick(asRow(value), ["to", "recipient"], "recipient")).toLowerCase(),
  subject: (value: unknown): string => str(pick(asRow(value), ["subject", "title"], "subject")),
  body: (value: unknown): string => str(pick(asRow(value), ["body", "text", "message"], "body")),
};

/** The slot `propose_slots` held, from `{ ok, message, slots: [{ id, ... }] }`. */
export function slotIdFrom(value: unknown): string {
  const rows = itemsOf(value);
  if (rows.length === 0) throw new Error(`propose_slots held no slots: ${preview(value)}`);
  return str(pick(rows[0]!, ["id", "slot_id"], "slot id"));
}

/**
 * Fields the pipeline may never carry, whatever an app adds later. Asserted across the whole
 * manifest — names, descriptions and every parameter — rather than against a list of tools, so a
 * new tool cannot smuggle one in.
 */
export const FORBIDDEN_PARAMETERS = ["university", "school", "age", "gender"] as const;

// --- act 3, TidyCRM ---------------------------------------------------------------------------

/** The seed's own threshold: 43 pairs at or above it are confident, 17 below it are not. */
export const CONFIDENT_PAIR = 0.8;

export const pair = {
  id: (row: Row): string => str(pick(row, ["id", "pair_id"], "pair id")),
  confidence: (row: Row): number => num(pick(row, ["confidence", "certainty", "score"], "pair confidence")),
  keep: (row: Row): string => str(pick(row, ["keep_id", "primary_id"], "keep id")),
  drop: (row: Row): string => str(pick(row, ["drop_id", "duplicate_id"], "drop id")),
  status: (row: Row): string => safe(() => str(pick(row, ["status"], "status")), "open"),
};

export function isConfidentPair(row: Row): boolean {
  return safe(() => pair.confidence(row), 0) >= CONFIDENT_PAIR;
}

/** One company-name conflict from `read_conflicts`. */
export const conflict = {
  domain: (row: Row): string => str(pick(row, ["domain"], "conflict domain")),
  consensus: (row: Row): string => str(pick(row, ["consensus", "canonical", "majority"], "consensus spelling")),
  /** Every spelling the contacts on this domain are filed under. */
  spellings: (row: Row): string[] => {
    const held = row.spellings;
    if (!Array.isArray(held)) return [];
    return (held as Row[]).map((s) => (typeof s === "string" ? s : str(pick(s, ["company", "name"], "spelling"))));
  },
};

/** One row of a contact preview or an export. */
export const contact = {
  id: (row: Row): string => str(pick(row, ["contact_id", "id"], "contact id")),
  /** The cross-app key: TidyCRM files a block by domain and the registry agrees with it. */
  domain: (row: Row): string => {
    const held = row.domain;
    if (typeof held === "string" && held.length > 0) return held.toLowerCase();
    const email = contact.email(row);
    return email.includes("@") ? email.split("@")[1]!.toLowerCase() : "";
  },
  name: (row: Row): string => str(pick(row, ["name", "contact", "full_name"], "contact name")),
  company: (row: Row): string => {
    const held = row.company ?? row.organisation ?? row.organization ?? row.account ?? row.block;
    return held === undefined || held === null ? "" : str(held);
  },
  email: (row: Row): string => {
    const held = row.email ?? row.contact_email;
    return held === undefined || held === null ? "" : str(held).toLowerCase();
  },
};

/** The segment act 3 exports for the campaign â€” the fifteen registry domains. */
export const CAMPAIGN_SEGMENT = "clients";
