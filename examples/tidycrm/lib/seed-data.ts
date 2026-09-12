/**
 * The deterministic 800-contact seed, with the defects design 4.6.4 asks for injected on purpose:
 * 60 near-duplicate pairs, 120 inconsistent phone formats, stale records, 10 domains carrying more
 * than one spelling of one company. Pure - no server imports - so the shape can be checked from
 * anywhere.
 *
 * 724 of the 800 are generated, 60 are accidental re-entries of them, and 16 are written down: the
 * fifteen registry billing contacts and the Kestrel applicant, who are the same people in the
 * sibling apps and are therefore copied rather than drawn (`ANCHOR_PEOPLE`).
 *
 * Everything comes from `rngFor(APP_ID, stream)`, one stream per concern, so adding a concern later
 * never shifts the rows an earlier one produced.
 */
import {
  rngFor,
  type Rng,
  type Company,
  type Person,
  COMPANIES,
  KESTREL_APPLICANT,
  PINEGROVE_ALIAS,
  companyByDomain,
} from "@athena/demo-kit/seed";
import { APP_ID, NOW_ISO, STALE_MONTHS } from "./constants";
import { scorePair } from "./matching";
import type { Evidence } from "./types";

export interface SeedContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
  domain: string;
  title: string;
  city: string;
  last_activity_at: string;
  created_at: string;
}

export interface SeedPair {
  id: string;
  keep_id: string;
  drop_id: string;
  confidence: number;
  evidence: Evidence[];
}

/*
 * 724 generated people, 60 accidental re-entries of them, and 16 who are written down rather than
 * drawn: 800 rows, as the design asks for. The anchors came out of the generated budget rather
 * than on top of it, because "800 contacts" is a figure the demo says out loud.
 */
const BASE_COUNT = 724;
const DUP_COUNT = 60;
/** Pairs below this index get high-signal evidence; the rest are the ones a human must judge. */
const CONFIDENT_PAIRS = 43;
const PHONE_DEFECTS = 120;
const STALE_COUNT = 110;
const CONFLICT_DOMAINS = 10;
const ORG_COUNT = 46;

const CITIES = [
  "Lisbon", "Rotterdam", "Tallinn", "Bristol", "Malmo", "Ghent", "Krakow", "Porto",
  "Aarhus", "Leeds", "Bilbao", "Turku", "Trieste", "Cluj", "Graz", "Dundee",
] as const;

const TITLES = [
  "Operations lead", "Head of partnerships", "Account manager", "Founder", "Finance manager",
  "Programme director", "Studio manager", "Buyer", "Facilities lead", "Marketing lead",
] as const;

/** Spelling drift of one company name. All of these sit on the same email domain. */
function spellingVariants(name: string): string[] {
  // Split at the LAST space, so "Marlow & Vine" drifts to "Marlow & Vines"
  // and not to "Marlow &s".
  const at = name.lastIndexOf(" ");
  const head = at < 0 ? name : name.slice(0, at);
  const tail = at < 0 ? "" : name.slice(at + 1);
  return [name, name.toLowerCase(), `${head} ${tail}s`, `${head} ${tail} Inc.`, `${head}-${tail}`];
}

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function localOf(first: string, last: string): string {
  return `${slugOf(first)}.${slugOf(last)}`;
}

function monthsBefore(months: number, jitterDays: number, rng: Rng): string {
  const d = new Date(NOW_ISO);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - rng.int(0, jitterDays));
  d.setUTCHours(rng.int(8, 18), rng.int(0, 59), 0, 0);
  return d.toISOString();
}

/** Turn a clean +1 number back into one of the shapes a real CRM accumulates. */
function messify(e164: string, style: "dashed" | "spaced" | "parens" | "dotted"): string {
  const digits = e164.replace(/\D+/g, "").slice(-10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6);
  switch (style) {
    case "dashed":
      return `${a}-${b}-${c}`;
    case "spaced":
      return `+1 ${a} ${b} ${c}`;
    case "parens":
      return `(${a}) ${b}-${c}`;
    case "dotted":
      return `${a}.${b}.${c}`;
  }
}

/**
 * Spellings a sibling app already taught Athena, keyed by domain.
 *
 * Act 1 is Ledgerbox: a payment lands from "PINEGROVE COOP" and the person confirms it is
 * Pinegrove Collective. Act 3 is this app, where some of Pinegrove's contacts carry that same
 * alias in their company field. The two are one fact, so both apps read it from one constant
 * (`PINEGROVE_ALIAS`, @athena/demo-kit/seed) rather than each spelling it themselves — and the
 * memory is only worth anything if the row it applies to is HERE on every machine, which is why
 * this is seeded rather than left to the drift sampler.
 */
const REMEMBERED_SPELLING: Record<string, string> = {
  [COMPANIES[0]!.domain]: PINEGROVE_ALIAS.crm,
};

/**
 * The spellings one conflicted domain carries.
 *
 * A remembered alias displaces one of the sampled variants rather than being appended, and the
 * canonical name is pinned at the head, so the domain is still spelled three or four ways and the
 * one spelling the demo depends on cannot be sampled away. The two `rng` calls happen either way,
 * so pinning a domain never shifts the rows drawn after it.
 */
function drift(rng: Rng, name: string, domain: string): string[] {
  const sampled = rng.sample(spellingVariants(name), rng.int(3, 4));
  const remembered = REMEMBERED_SPELLING[domain];
  if (!remembered) return sampled;
  const rest = sampled.filter((s) => s !== name && s !== remembered).slice(0, sampled.length - 2);
  return [name, remembered, ...rest];
}

interface Org {
  domain: string;
  /** More than one entry is exactly the "conflicting company names" defect. */
  spellings: string[];
}

function buildOrgs(rng: Rng): Org[] {
  const seen = new Set<string>();
  const orgs: Org[] = [];
  // The studio's clients first, on the domains the other two apps use for
  // them. They land in the conflicted slice too, which is the more honest
  // data: a real client is exactly whose name gets written three ways.
  for (const c of COMPANIES) {
    seen.add(c.domain);
    const conflicted = orgs.length < CONFLICT_DOMAINS;
    orgs.push({
      domain: c.domain,
      spellings: conflicted ? drift(rng, c.name, c.domain) : [c.name],
    });
  }
  while (orgs.length < ORG_COUNT) {
    const name = rng.company();
    const domain = `${slugOf(name)}.example`;
    if (seen.has(domain)) continue;
    seen.add(domain);
    const conflicted = orgs.length < CONFLICT_DOMAINS;
    orgs.push({ domain, spellings: conflicted ? drift(rng, name, domain) : [name] });
  }
  return orgs;
}

function buildBase(rng: Rng, orgs: Org[]): SeedContact[] {
  const rows: SeedContact[] = [];
  for (let i = 1; i <= BASE_COUNT; i++) {
    const first = rng.firstName();
    const last = rng.lastName();
    const org = orgs[rng.int(0, orgs.length - 1)] as Org;
    rows.push({
      id: rng.id("ct", i),
      first_name: first,
      last_name: last,
      email: `${localOf(first, last)}${i}@${org.domain}`,
      phone: `+1${rng.int(200, 989)}${rng.int(200, 989)}${rng.int(1000, 9999)}`,
      company: rng.pick(org.spellings),
      domain: org.domain,
      title: rng.pick(TITLES),
      city: rng.pick(CITIES),
      last_activity_at: monthsBefore(rng.int(0, STALE_MONTHS - 1), 27, rng),
      created_at: monthsBefore(rng.int(STALE_MONTHS, 54), 27, rng),
    });
  }
  return rows;
}


/**
 * The people who are written down rather than drawn (design 4.6.4, and the demo's one-studio rule).
 *
 * Every company in the shared registry has a named billing contact, and `KESTREL_APPLICANT` is the
 * person Hirelane sees apply in act 2. The three apps only read as one studio's tabs if those
 * people are the SAME people here: same name, same title, same address, on the registry domain. So
 * they are seeded verbatim, and `injectDefects` is never pointed at them — an anchor whose email
 * had been shouted into upper case would no longer be the person the other tab is holding.
 *
 * They carry the canonical spelling of their company, which is also what makes a conflicted domain
 * honest: the drift is on the generated rows around a name someone actually wrote down.
 */
const ANCHOR_PEOPLE: { person: Person; domain: string }[] = [
  ...COMPANIES.map((c) => ({ person: c.contact, domain: c.domain })),
  { person: KESTREL_APPLICANT, domain: KESTREL_APPLICANT.email.split("@")[1] as string },
];

export const ANCHOR_COUNT = ANCHOR_PEOPLE.length;

/** 800, and the three numbers it is made of. The demo says the figure out loud. */
export const TOTAL_CONTACTS = BASE_COUNT + DUP_COUNT + ANCHOR_COUNT;

function buildAnchors(rng: Rng, firstIndex: number): SeedContact[] {
  return ANCHOR_PEOPLE.map(({ person, domain }, i) => {
    const [first = person.name, ...rest] = person.name.split(" ");
    const org: Company | undefined = companyByDomain(domain);
    return {
      id: rng.id("ct", firstIndex + i),
      first_name: first,
      last_name: rest.join(" "),
      email: person.email,
      phone: `+1${rng.int(200, 989)}${rng.int(200, 989)}${rng.int(1000, 9999)}`,
      company: org?.name ?? domain,
      domain,
      title: person.title,
      city: org?.city ?? rng.pick(CITIES),
      last_activity_at: monthsBefore(rng.int(0, STALE_MONTHS - 1), 27, rng),
      created_at: monthsBefore(rng.int(STALE_MONTHS, 54), 27, rng),
    } satisfies SeedContact;
  });
}

/** The four shapes a confident duplicate takes, then the four a merely plausible one takes. */
const CONFIDENT = ["initials", "domain_shift", "diacritics", "swapped"] as const;
const UNCERTAIN = ["same_name", "diacritics_only", "swapped_soft", "initials_soft"] as const;

const ACCENTS: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú",
  n: "ñ", s: "š", c: "ç",
};

/** Accent the last vowel we can reach, so `Ines` becomes `Ines` with an accent, not a new name. */
function accent(value: string): string {
  for (let i = value.length - 1; i > 0; i--) {
    const swapped = ACCENTS[(value[i] as string).toLowerCase()];
    if (swapped) return value.slice(0, i) + swapped + value.slice(i + 1);
  }
  return value;
}

/** The trailing digits that make each seeded email unique; the twin has to reuse them. */
function localSuffix(email: string): string {
  return email.split("@")[0]?.match(/\d+$/)?.[0] ?? "";
}

function randomPhone(rng: Rng): string {
  return `+1${rng.int(200, 989)}${rng.int(200, 989)}${rng.int(1000, 9999)}`;
}

function buildTwin(source: SeedContact, index: number, rng: Rng): SeedContact {
  const recipe =
    index < CONFIDENT_PAIRS
      ? (CONFIDENT[index % CONFIDENT.length] as string)
      : (UNCERTAIN[(index - CONFIDENT_PAIRS) % UNCERTAIN.length] as string);

  const twin: SeedContact = {
    ...source,
    id: rng.id("ct", BASE_COUNT + index + 1),
    title: rng.pick(TITLES),
    last_activity_at: monthsBefore(rng.int(0, 30), 27, rng),
    created_at: monthsBefore(rng.int(6, 40), 27, rng),
  };
  const local = `${localOf(source.first_name, source.last_name)}${localSuffix(source.email)}`;

  switch (recipe) {
    case "initials":
      twin.first_name = `${source.first_name.slice(0, 1)}.`;
      break;
    case "domain_shift":
      twin.email = `${local}@new-${source.domain}`;
      break;
    case "diacritics":
      twin.first_name = accent(source.first_name);
      break;
    case "swapped":
      twin.first_name = source.last_name;
      twin.last_name = source.first_name;
      break;
    case "same_name":
      twin.email = `${localOf(source.first_name, source.last_name)}@personal.invalid`;
      twin.phone = randomPhone(rng);
      break;
    case "diacritics_only":
      twin.first_name = accent(source.first_name);
      twin.email = `${localOf(source.first_name, source.last_name)}@mailbox.invalid`;
      break;
    case "swapped_soft":
      twin.first_name = source.last_name;
      twin.last_name = source.first_name;
      twin.email = `${local}@old-${source.domain}`;
      twin.phone = randomPhone(rng);
      break;
    case "initials_soft":
      twin.first_name = `${source.first_name.slice(0, 1)}.`;
      twin.email = `${localOf(source.first_name, source.last_name)}@mailbox.invalid`;
      break;
  }
  return twin;
}

/**
 * Mess the formats up after the twins exist, so defects land on both halves of some pairs.
 *
 * `pool` is the ids a defect may be drawn from. The anchors are not in it: they are the rows
 * another app is holding by name and address, and a defect injected into one of them would make
 * the two tabs disagree about who the person is.
 */
function injectDefects(rows: SeedContact[], rng: Rng, pool: readonly string[]): void {
  const ids = [...pool];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const take = (n: number) => rng.sample(ids, n);

  for (const id of take(PHONE_DEFECTS)) {
    const row = byId.get(id);
    if (row) row.phone = messify(row.phone, rng.pick(["dashed", "spaced", "parens", "dotted"]));
  }
  for (const id of take(46)) {
    const row = byId.get(id);
    if (row) row.company = rng.bool() ? `${row.company}  ` : `  ${row.company}`;
  }
  for (const id of take(38)) {
    const row = byId.get(id);
    if (row) {
      row.first_name = row.first_name.toLowerCase();
      row.last_name = row.last_name.toLowerCase();
    }
  }
  for (const id of take(34)) {
    const row = byId.get(id);
    if (row) row.email = row.email.toUpperCase();
  }
  for (const id of take(STALE_COUNT)) {
    const row = byId.get(id);
    if (row) row.last_activity_at = monthsBefore(rng.int(STALE_MONTHS + 1, 44), 27, rng);
  }
}

export interface SeedResult {
  contacts: SeedContact[];
  pairs: SeedPair[];
  /** Domains carrying more than one spelling of the same company. */
  conflictDomains: string[];
}

/** Domains where the company name is written more than one way (whitespace aside). */
function findConflictDomains(contacts: SeedContact[]): string[] {
  const byDomain = new Map<string, Set<string>>();
  for (const c of contacts) {
    const set = byDomain.get(c.domain) ?? new Set<string>();
    set.add(c.company.trim());
    byDomain.set(c.domain, set);
  }
  return [...byDomain.entries()].filter(([, set]) => set.size > 1).map(([domain]) => domain);
}

export function buildSeed(): SeedResult {
  const orgRng = rngFor(APP_ID, "orgs");
  const baseRng = rngFor(APP_ID, "contacts");
  const dupRng = rngFor(APP_ID, "duplicates");
  const defectRng = rngFor(APP_ID, "defects");
  const anchorRng = rngFor(APP_ID, "anchors");

  const orgs = buildOrgs(orgRng);
  const contacts = buildBase(baseRng, orgs);

  const sources = dupRng.sample(
    contacts.map((c) => c.id),
    DUP_COUNT,
  );
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const twinned: { source: SeedContact; twin: SeedContact }[] = [];
  sources.forEach((sourceId, index) => {
    const source = byId.get(sourceId);
    if (!source) return;
    const twin = buildTwin(source, index, dupRng);
    twinned.push({ source, twin });
    contacts.push(twin);
  });

  // The anchors join after the twins are drawn: a written-down person is not a re-entry of a
  // generated one, and the pair sampler must not be able to pick one as a duplicate source.
  const generated = contacts.map((c) => c.id);
  contacts.push(...buildAnchors(anchorRng, BASE_COUNT + DUP_COUNT + 1));

  injectDefects(contacts, defectRng, generated);

  const pairs: SeedPair[] = twinned.map(({ source, twin }, index) => {
    const { confidence, evidence } = scorePair(source, twin);
    return {
      id: `pair_${String(index + 1).padStart(3, "0")}`,
      // The original record is kept; the twin is the accidental re-entry.
      keep_id: source.id,
      drop_id: twin.id,
      confidence,
      evidence,
    };
  });

  return { contacts, pairs, conflictDomains: findConflictDomains(contacts) };
}
