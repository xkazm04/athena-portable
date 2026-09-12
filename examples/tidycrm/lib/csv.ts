/** CSV for the export view. Pure; no server imports, so the route and the UI agree on the shape. */
import type { Contact } from "./types";

const COLUMNS = [
  "id", "first_name", "last_name", "email", "phone", "company", "domain", "title", "city",
  "last_activity_at", "created_at", "phone_ok", "is_stale", "stale_flagged", "conflict",
  "in_open_pair", "merged_into",
] as const;

export const CSV_COLUMNS: readonly string[] = COLUMNS;

/** RFC 4180: quote anything containing a comma, a quote or a newline; double the inner quotes. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
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
