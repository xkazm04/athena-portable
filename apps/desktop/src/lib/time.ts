/**
 * Store and daemon timestamps, read as what they are: UTC (README section 3.5, UAT finding uat-1).
 *
 * The store writes `2026-10-01 10:08:07` and the daemon's ledger writes `...T10:08:07` with no zone
 * marker. `new Date("2026-10-01 10:08:07")` reads that as the *viewer's local* time, so a user in
 * UTC+2 saw "2 h ago" for something done seconds earlier and a Record whose clock was two hours off.
 * Every timestamp that crosses from the store or the daemon into a view goes through
 * {@link parseStamp}; a view never calls `new Date` on a stored string.
 */

/** A zone marker at the end: `Z`, `+02:00`, `+0200` or `+02`. */
const HAS_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Parse a stored stamp as UTC when it carries no zone, and as written when it does.
 * `null` when it cannot be read, so a caller shows the raw string rather than a made-up time.
 */
export function parseStamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text === "") return null;
  // `2026-10-01 10:08:07` -> `2026-10-01T10:08:07`, then mark the zone we know it is.
  const iso = text.replace(" ", "T");
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso;
  const withZone = HAS_ZONE.test(dated.slice(10)) ? dated : `${dated}Z`;
  const at = new Date(withZone);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "just now", "3 min ago", "2 h ago", "4 d ago", or the local date; the raw string when unreadable. */
export function whenAgo(raw: string, now: number = Date.now()): string {
  if (!raw) return "never";
  const at = parseStamp(raw);
  if (at === null) return raw;
  const minutes = Math.round((now - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return at.toLocaleDateString();
}

/** The clock time in the viewer's own zone, `HH:MM`; the raw string when unreadable. */
export function clockOf(raw: string): string {
  const at = parseStamp(raw);
  if (at === null) return raw;
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
