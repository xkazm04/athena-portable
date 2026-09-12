/**
 * The companies the three example apps have in common: one studio's world.
 *
 * Ledgerbox invoices them, TidyCRM keeps the people who work at them, and
 * Hirelane sees their staff apply. Until this file existed the three seeds drew
 * names from the same word list and produced three different Kestrels — Labs in
 * the books, Partners in the CRM, Works in an application — so nothing could be
 * remembered from one app to the next. Now every seed reads this list, and the
 * email DOMAIN is the key that joins them: TidyCRM already treats a domain as a
 * block's identity, an invoice's contact is on it, and an applicant's current
 * employer resolves to it.
 *
 * The names are Ledgerbox's fifteen clients, which were the only hand-written
 * set. The other two apps used to generate theirs; they now start from these
 * and generate the rest.
 *
 * `.example` is reserved for exactly this and will never resolve.
 */
export interface Person {
  name: string;
  title: string;
  /** On the company's domain: the same string in every app that shows this person. */
  email: string;
}

export interface Company {
  name: string;
  /** Lower-case, hyphenated, on `.example`. The cross-app key. */
  domain: string;
  city: string;
  /** The billing contact: Ledgerbox addresses invoices and chases to them, TidyCRM holds them. */
  contact: Person;
}

/**
 * The one studio whose books, pipeline and contact list the three apps are. Every app shows this
 * name in its shell and sends from this domain, so the demo reads as one owner moving between
 * three tabs, not three products.
 */
export const STUDIO = {
  name: "Halden Studio",
  domain: "halden.example",
  owner: { name: "Mira Halden", title: "Founder", email: "mira@halden.example" },
  /** The shared inbox reminders and scheduling mail go out from. */
  inbox: "hello@halden.example",
} as const;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The domain a company name resolves to, everywhere. */
export function companyDomain(name: string): string {
  return `${slug(name)}.example`;
}

function person(name: string, title: string, domain: string): Person {
  const [first = "sam", last = "quinn"] = name.toLowerCase().split(" ");
  return { name, title, email: `${first}.${last}@${domain}` };
}

function company(name: string, city: string, contactName: string, contactTitle: string): Company {
  const domain = companyDomain(name);
  return { name, domain, city, contact: person(contactName, contactTitle, domain) };
}

export const COMPANIES: readonly Company[] = [
  company("Pinegrove Collective", "Sheffield", "Rosa Duarte", "Studio manager"),
  company("Northbank Supply", "Bristol", "Hal Whitlock", "Accounts payable"),
  company("Kestrel Labs", "Cambridge", "Ines Kaur", "Finance lead"),
  company("Marlow & Vine", "Manchester", "Cleo Ferrer", "Partner"),
  company("Halcyon Works", "Glasgow", "Nils Eriksen", "Operations lead"),
  company("Brightwater Group", "Leeds", "Gita Haddad", "Head of marketing"),
  company("Ironwood Studio", "Norwich", "Luc Barros", "Founder"),
  company("Solstice Partners", "London", "Tova Lindqvist", "Managing partner"),
  company("Verdant Supply", "Exeter", "Faris Mbeki", "Procurement"),
  company("Copperline Industries", "Newport", "Pia Novak", "Finance"),
  company("Ashfield Works", "Derby", "Dev Chan", "Owner"),
  company("Longitude Labs", "Plymouth", "Yara Silva", "Office manager"),
  company("Quarry House", "Bath", "Jonas Gould", "Bookkeeper"),
  company("Tideline Press", "Whitstable", "Elin Voss", "Publisher"),
  company("Foxglove Studio", "York", "Sami Reyes", "Creative director"),
];

/**
 * People who appear in more than one app under the same name and email, so a fact remembered in
 * one tab is checkable in the next. These are the demo's cross-app threads (README section 1):
 *
 * - `KESTREL_APPLICANT` works at Kestrel Labs, a client Ledgerbox chases in act 1. In act 2 they
 *   apply to Hirelane's backend role as one of the six borderline applicants. TidyCRM holds them
 *   as a Kestrel contact. Athena may name the relationship as context; nothing may score on it.
 * - Solstice Partners' contact (`companyByName("Solstice Partners").contact`) paid 80% and went
 *   quiet in act 1; in act 3 Athena leaves them out of the campaign export for the same reason.
 * - Pinegrove Collective pays as "PINEGROVE COOP" on the bank statement (act 1) and is spelled
 *   "Pinegrove Coop" by some TidyCRM records (act 3). One alias, learned once.
 */
export const KESTREL_APPLICANT: Person = person("Wren Okafor", "Platform engineer", companyDomain("Kestrel Labs"));

/** The bank-statement alias Pinegrove Collective pays under, and the CRM spelling that matches it. */
export const PINEGROVE_ALIAS = { bank: "PINEGROVE COOP", crm: "Pinegrove Coop" } as const;

/** The client to leave out of a chase and a campaign alike: paid 80%, went quiet. */
export const QUIET_CLIENT = "Solstice Partners";

const BY_DOMAIN = new Map(COMPANIES.map((c) => [c.domain, c]));
const BY_NAME = new Map(COMPANIES.map((c) => [c.name, c]));

export function companyByDomain(domain: string): Company | undefined {
  return BY_DOMAIN.get(domain);
}

export function companyByName(name: string): Company | undefined {
  return BY_NAME.get(name);
}
