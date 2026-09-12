/**
 * Near-duplicate matching: a handful of named rules, each with a weight, each of which has to say
 * what it saw. Confidence is the sum of the weights that fired.
 *
 * Nothing here is clever, and that is the point - the reviewer is shown the rules, not a number
 * from a model, so "why is this a duplicate" always has an answer (design 4.6.4: every merge cites
 * its evidence).
 */
import { CONFIDENT_AT } from "./constants";
import { toE164 } from "./normalize";
import type { Evidence } from "./types";

interface MatchRule {
  id: string;
  label: string;
  weight: number;
}

/** Every rule, in the order the reviewer lists them. Weights are hand-set, not learned. */
const MATCH_RULES: MatchRule[] = [
  { id: "email_exact", label: "Identical email address", weight: 0.45 },
  { id: "email_domain_shift", label: "Same mailbox, renamed domain", weight: 0.3 },
  { id: "name_exact", label: "Identical name", weight: 0.25 },
  { id: "name_diacritics", label: "Name differs only by accents", weight: 0.2 },
  { id: "name_initials", label: "Name abbreviated to an initial", weight: 0.18 },
  { id: "name_order", label: "First and last name swapped", weight: 0.16 },
  { id: "phone_match", label: "Same phone once normalised", weight: 0.2 },
  { id: "company_match", label: "Same company", weight: 0.08 },
];

const BY_ID = new Map(MATCH_RULES.map((r) => [r.id, r]));

function rule(id: string, detail: string): Evidence {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`unknown match rule: ${id}`);
  return { rule: r.id, label: r.label, weight: r.weight, detail };
}

/** Lowercase, de-accented, whitespace-squeezed: the form every comparison is made in. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s{2,}/g, " ");
}

function splitEmail(email: string): { local: string; domain: string } {
  const at = email.lastIndexOf("@");
  if (at < 0) return { local: fold(email), domain: "" };
  return { local: fold(email.slice(0, at)), domain: fold(email.slice(at + 1)) };
}

export interface Matchable {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
}

function emailEvidence(a: Matchable, b: Matchable): Evidence | null {
  const ea = splitEmail(a.email);
  const eb = splitEmail(b.email);
  if (ea.local === eb.local && ea.domain === eb.domain && ea.local !== "") {
    return rule("email_exact", `both ${fold(a.email)}`);
  }
  if (ea.local === eb.local && ea.local !== "") {
    return rule("email_domain_shift", `${ea.local}@ on ${ea.domain} and ${eb.domain}`);
  }
  return null;
}

function nameEvidence(a: Matchable, b: Matchable): Evidence | null {
  const af = fold(a.first_name);
  const al = fold(a.last_name);
  const bf = fold(b.first_name);
  const bl = fold(b.last_name);
  const rawSame =
    a.first_name.trim().toLowerCase() === b.first_name.trim().toLowerCase() &&
    a.last_name.trim().toLowerCase() === b.last_name.trim().toLowerCase();

  if (af === bf && al === bl) {
    return rawSame
      ? rule("name_exact", `both ${a.first_name} ${a.last_name}`)
      : rule("name_diacritics", `${a.first_name} ${a.last_name} vs ${b.first_name} ${b.last_name}`);
  }
  if (af === bl && al === bf) {
    return rule("name_order", `${a.first_name} ${a.last_name} vs ${b.first_name} ${b.last_name}`);
  }
  const initial = af.replace(/\W/g, "");
  const otherInitial = bf.replace(/\W/g, "");
  const abbreviated =
    al === bl &&
    ((initial.length === 1 && otherInitial.startsWith(initial)) ||
      (otherInitial.length === 1 && initial.startsWith(otherInitial)));
  if (abbreviated) {
    return rule("name_initials", `${a.first_name} ${a.last_name} vs ${b.first_name} ${b.last_name}`);
  }
  return null;
}

/**
 * Score one candidate pair. Confidence is capped just under 1: this app never claims certainty
 * about two rows it did not watch a human create.
 */
export function scorePair(a: Matchable, b: Matchable): { confidence: number; evidence: Evidence[] } {
  const evidence: Evidence[] = [];
  const email = emailEvidence(a, b);
  if (email) evidence.push(email);
  const name = nameEvidence(a, b);
  if (name) evidence.push(name);

  const pa = toE164(a.phone);
  const pb = toE164(b.phone);
  if (pa === pb && pa.trim() !== "") evidence.push(rule("phone_match", pa));
  if (fold(a.company) === fold(b.company) && a.company.trim() !== "") {
    evidence.push(rule("company_match", a.company.trim()));
  }

  const sum = evidence.reduce((total, e) => total + e.weight, 0);
  return { confidence: Math.min(0.99, Number(sum.toFixed(2))), evidence };
}

/** Three bands, because a reviewer reads a word faster than a decimal. */
export function confidenceBand(confidence: number): "confident" | "likely" | "uncertain" {
  if (confidence >= CONFIDENT_AT) return "confident";
  if (confidence >= 0.5) return "likely";
  return "uncertain";
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
