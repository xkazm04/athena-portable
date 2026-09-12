/**
 * `@athena/demo-kit/seed` - deterministic fake data, no faker, no network.
 *
 * Every app seeds from a fixed integer, so two people running the demo see identical rows and a
 * screenshot taken in week one still matches the app in week three. That matters more than variety:
 * the design 4.6 seeds contain deliberate defects (near-duplicates, disputed invoices, borderline
 * applicants) and those must land in the same place every time.
 */

/** Mulberry32: 32-bit state, uniform enough for demo data, four lines, no dependency. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number, decimals = 2): number {
    const v = min + this.next() * (max - min);
    return Number(v.toFixed(decimals));
  }

  bool(trueProbability = 0.5): boolean {
    return this.next() < trueProbability;
  }

  /** One item. Throws on an empty array so a bad seed fails loudly at build time. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** `n` distinct items (or all of them, if `n` exceeds the array). */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, Math.min(n, items.length));
  }

  /** A new shuffled array; the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  /** Weighted pick: `pickWeighted([["paid", 7], ["overdue", 2], ["disputed", 1]])`. */
  pickWeighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) throw new Error("Rng.pickWeighted: weights must sum above zero");
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  /** ISO date `n` days before `from`, jittered within `spreadDays`. */
  dateBefore(from: Date, spreadDays: number): string {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() - this.int(0, spreadDays));
    d.setUTCHours(this.int(8, 19), this.int(0, 59), 0, 0);
    return d.toISOString();
  }

  /** ISO date `n` days after `from`. */
  dateAfter(from: Date, spreadDays: number): string {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + this.int(0, spreadDays));
    d.setUTCHours(this.int(8, 19), this.int(0, 59), 0, 0);
    return d.toISOString();
  }

  /** `prefix_0001`-style ids, stable across runs. */
  id(prefix: string, n: number, width = 4): string {
    return `${prefix}_${String(n).padStart(width, "0")}`;
  }

  firstName(): string {
    return this.pick(FIRST_NAMES);
  }

  lastName(): string {
    return this.pick(LAST_NAMES);
  }

  fullName(): string {
    return `${this.firstName()} ${this.lastName()}`;
  }

  company(): string {
    return `${this.pick(COMPANY_HEADS)} ${this.pick(COMPANY_TAILS)}`;
  }

  /** Deterministic address-safe slug of any string. */
  slug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /** An email that matches the name, on a fake domain that will never resolve. */
  email(name: string, domain?: string): string {
    const [first = "sam", last = "quinn"] = name.toLowerCase().split(" ");
    return `${first}.${last}@${domain ?? this.pick(DOMAINS)}`;
  }

  /** Deliberately inconsistent phone formats - tidycrm's seed needs the mess (design 4.6.4). */
  phone(style: "e164" | "dashed" | "spaced" | "parens" | "random" = "random"): string {
    const a = this.int(200, 989);
    const b = this.int(200, 989);
    const c = this.int(1000, 9999);
    const chosen = style === "random" ? this.pick(PHONE_STYLES) : style;
    switch (chosen) {
      case "e164":
        return `+1${a}${b}${c}`;
      case "dashed":
        return `${a}-${b}-${c}`;
      case "spaced":
        return `${a} ${b} ${c}`;
      default:
        return `(${a}) ${b}-${c}`;
    }
  }

  /** A short sentence of filler that reads like a note, not like lorem ipsum. */
  sentence(): string {
    return `${this.pick(SENTENCE_HEADS)} ${this.pick(SENTENCE_TAILS)}`;
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PHONE_STYLES = ["e164", "dashed", "spaced", "parens"] as const;

const FIRST_NAMES = [
  "Ada", "Bo", "Cleo", "Dev", "Elin", "Faris", "Gita", "Hal", "Ines", "Jonas",
  "Kira", "Luc", "Mira", "Nils", "Oona", "Pia", "Quinn", "Rosa", "Sami", "Tova",
  "Uma", "Vik", "Wren", "Xan", "Yara", "Zeke",
] as const;

const LAST_NAMES = [
  "Abbott", "Barros", "Chan", "Duarte", "Eriksen", "Ferrer", "Gould", "Haddad", "Ibsen", "Jarvis",
  "Kaur", "Lindqvist", "Mbeki", "Novak", "Okafor", "Pashinyan", "Quiroga", "Reyes", "Silva",
  "Tanaka", "Ueda", "Voss", "Whitlock", "Xu", "Yilmaz", "Zabala",
] as const;

const COMPANY_HEADS = [
  "Northbank", "Kestrel", "Marlow", "Pinegrove", "Halcyon", "Brightwater", "Ironwood", "Solstice",
  "Verdant", "Copperline", "Ashfield", "Longitude",
] as const;

const COMPANY_TAILS = [
  "Studio", "Labs", "Partners", "Collective", "Works", "Supply", "Group", "Industries",
] as const;

const DOMAINS = [
  "example.com", "example.net", "example.org", "test.invalid", "demo.invalid",
] as const;

const SENTENCE_HEADS = [
  "Followed up by email;", "Left on hold since the last review;", "Flagged during intake;",
  "Came in through the referral form;", "Migrated from the old system;", "Reopened after a reply;",
] as const;

const SENTENCE_TAILS = [
  "waiting on a decision.", "no response yet.", "needs a second look.", "resolved, kept for the record.",
  "the details do not line up.", "everything checks out.",
] as const;

/** Convenience: a fresh RNG per logical stream, so adding a table never shifts earlier data. */
export function rngFor(appId: string, stream: string): Rng {
  return new Rng(`${appId}:${stream}`);
}

export {
  COMPANIES,
  KESTREL_APPLICANT,
  PINEGROVE_ALIAS,
  QUIET_CLIENT,
  STUDIO,
  companyByDomain,
  companyByName,
  companyDomain,
  type Company,
  type Person,
} from "./companies";
