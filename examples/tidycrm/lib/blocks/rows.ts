import "server-only";

/**
 * One contact, as the sheet carries it, and the sentence that says why.
 *
 * Every flag is a stored, indexed column: `phone_ok`, `is_stale`, `conflict`,
 * `in_open_pair`. Nothing here is inferred at read time, so a mark on the print
 * is always something somebody could go and check. The clause is assembled from
 * the same flags, so the words and the dots cannot disagree.
 */
import { STALE_MONTHS } from "../constants";
import { displayName } from "../db";
import type { Contact } from "../types";
import {
  ZONE_IDS,
  type BkRow,
  type DeviationKind,
  type ZoneId,
} from "@/components/blocks/model";

/** A record is checked when it carries no outstanding deviation. Stored flags only. */
export function isChecked(c: Contact): boolean {
  return (
    c.in_open_pair === 0 &&
    c.phone_ok === 1 &&
    c.conflict === 0 &&
    (c.is_stale === 0 || c.stale_flagged === 1)
  );
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

export function clauseFor(kind: DeviationKind, n: number, name: string): string {
  switch (kind) {
    case "duplicate":
      return `${n} identity ${plural(n, "pair has", "pairs have")} never been adjudicated`;
    case "conflict":
      // `n` is the deviation's own count, which for this kind is spellings. Reading the
      // count rather than a second figure is what stops the words and the number drifting.
      return `“${name}” is spelled ${n} ways on this domain`;
    case "phone":
      return `${n} ${plural(n, "number is", "numbers are")} not stored as +1XXXXXXXXXX`;
    case "stale":
      return `${n} ${plural(n, "record has", "records have")} no activity for over ${STALE_MONTHS} months`;
  }
}

export function toRow(c: Contact, changed: Record<string, number>): BkRow {
  return {
    id: c.id,
    name: displayName(c),
    email: c.email,
    phone: c.phone,
    company: c.company,
    title: c.title,
    city: c.city,
    lastActivityAt: c.last_activity_at,
    phoneOk: c.phone_ok === 1,
    isStale: c.is_stale === 1,
    staleFlagged: c.stale_flagged === 1,
    conflict: c.conflict === 1,
    inOpenPair: c.in_open_pair === 1,
    changed: changed[c.id] ?? 0,
  };
}

/** Which zone letter a block lands in, from its position in the ident order. */
export function zoneFor(index: number, total: number): ZoneId {
  const per = Math.ceil(total / ZONE_IDS.length);
  const slot = Math.min(ZONE_IDS.length - 1, Math.floor(index / per));
  return ZONE_IDS[slot] ?? "D";
}
