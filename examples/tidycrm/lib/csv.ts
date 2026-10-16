/** CSV for the export view. Pure; no server imports, so the route and the UI agree on the shape. */
import type { Contact } from "./types";

const COLUMNS = [
  "id", "first_name", "last_name", "email", "phone", "company", "domain", "title", "city",
  "last_activity_at", "created_at", "phone_ok", "is_stale", "stale_flagged", "conflict",
  "in_open_pair", "merged_into",
] as const;

export const CSV_COLUMNS: readonly string[] = COLUMNS;

/**
 * A cell a spreadsheet would evaluate on open: it leads with `=`, `+`, `-` or `@` (or their
 * full-width forms, which some applications fold), or with a tab or a line break.
 */
const FORMULA_LEAD = /^[=+\-@\t\r\n＝＋－＠]/;
/** Data that merely starts like one: a signed number, or a phone written `+1 870 555 8230`. */
const SIGNED_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const PHONE = /^\+\d[\d ().-]*$/;

/**
 * Two layers, in this order. First the spreadsheet: a formula-shaped text cell gets a leading `'`
 * so it opens as text. A company name is whatever `resolve_company` was told, and the file goes to
 * whoever the campaign is handed to, so `=HYPERLINK(...)` must not arrive as a live formula. No
 * guard is safe for every application - a re-saved file can lose the quote - so this is a
 * mitigation at export, not a promise. Then RFC 4180: quote anything containing a comma, a quote
 * or a newline, and double the inner quotes. Guarding after quoting would hide the trigger.
 */
function cell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text =
    FORMULA_LEAD.test(raw) && !SIGNED_NUMBER.test(raw) && !PHONE.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Contact[]): string {
  const head = COLUMNS.join(",");
  const body = rows.map((row) => COLUMNS.map((c) => cell(row[c])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

export function exportFilename(segment: string): string {
  return `tidycrm-${segment}.csv`;
}
