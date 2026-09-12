/**
 * The four normalisation rules `normalize_fields` offers, as pure functions.
 *
 * Every change they produce is recorded in the `revisions` table, which is what makes the action
 * reversible per record (design 4.6.4) and therefore AUTO rather than gated.
 */
export const RULES = [
  "phone_e164",
  "trim_whitespace",
  "title_case_names",
  "lowercase_email",
] as const;
export type NormalizeRule = (typeof RULES)[number];

export const RULE_LABELS: Record<NormalizeRule, string> = {
  phone_e164: "Phone to +1XXXXXXXXXX",
  trim_whitespace: "Collapse stray whitespace",
  title_case_names: "Capitalise names",
  lowercase_email: "Lowercase email",
};

export const RULE_HINTS: Record<NormalizeRule, string> = {
  phone_e164: "Rewrites 10- and 11-digit numbers; leaves anything else alone.",
  trim_whitespace: "Trims the ends and squeezes runs of spaces inside a value.",
  title_case_names: "First and last name only, and only when the value is all one case.",
  lowercase_email: "The local part of an address is case-sensitive in theory, never in practice.",
};

/** Fields a rule may touch, in the order the UI lists them. */
export const NORMALIZABLE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "company",
  "city",
] as const;
export type NormalizableField = (typeof NORMALIZABLE_FIELDS)[number];

export type Normalizable = Record<NormalizableField, string>;

export interface FieldChange {
  field: NormalizableField;
  from: string;
  to: string;
  /** Every rule that contributed, so the revision row explains itself. */
  rules: NormalizeRule[];
}

const E164 = /^\+1\d{10}$/;

/** True when a phone is already stored the one way this app considers correct. */
export function isE164(phone: string): boolean {
  return E164.test(phone.trim());
}

/** `(415) 555-0134` -> `+14155550134`. Returns the input untouched if it is not a NANP number. */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone;
}

function squeeze(value: string): string {
  return value.trim().replace(/\s{2,}/g, " ");
}

/** Only touches a value that is uniformly cased; a deliberate `McCabe` survives. */
function titleCase(value: string): string {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return value;
  return value.replace(/\p{L}[\p{L}'’-]*/gu, (word) => {
    const head = word.slice(0, 1);
    return head.toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
  });
}

function applyRule(field: NormalizableField, value: string, rule: NormalizeRule): string {
  switch (rule) {
    case "phone_e164":
      return field === "phone" ? toE164(value) : value;
    case "trim_whitespace":
      return squeeze(value);
    case "title_case_names":
      return field === "first_name" || field === "last_name" ? titleCase(value) : value;
    case "lowercase_email":
      return field === "email" ? value.toLowerCase() : value;
  }
}

/**
 * What the selected rules would change on one record. Rules are applied in `RULES` order and the
 * result is folded to one change per field, so a value cleaned by two rules yields one revision.
 */
export function planChanges(row: Normalizable, rules: NormalizeRule[]): FieldChange[] {
  const ordered = RULES.filter((r) => rules.includes(r));
  const changes: FieldChange[] = [];
  for (const field of NORMALIZABLE_FIELDS) {
    const from = row[field];
    let current = from;
    const fired: NormalizeRule[] = [];
    for (const rule of ordered) {
      const next = applyRule(field, current, rule);
      if (next !== current) fired.push(rule);
      current = next;
    }
    if (current !== from) changes.push({ field, from, to: current, rules: fired });
  }
  return changes;
}

const FIELD_LABELS: Record<NormalizableField, string> = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  city: "City",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field as NormalizableField] ?? field;
}
