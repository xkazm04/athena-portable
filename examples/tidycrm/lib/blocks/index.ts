/**
 * Builds the one dataset The Blocks reads (design 4.6.4).
 *
 * Read once per request in a server module and handed down as plain props, so
 * moving from the sheet to a zone to a table is a transform and never a fetch.
 *
 * Everything here is derived from four exported queries — `segmentRows`,
 * `listOpenPairs`, `allDomainSpellings` and `revisionCounts` — plus the activity
 * log for the revision number, and every one of them is asked exactly once per
 * request. No SQL is written here and no figure is invented: the four deviations
 * are read from stored, indexed flags and one grouped spelling count, and a
 * pair's confidence is the sum of its rules' hand-set weights, not a prediction.
 *
 * What a single row looks like, and the sentence that says why it is marked,
 * lives in `blocks/rows.ts`. This file is the assembly: rows into blocks,
 * blocks into zones, zones into one sheet.
 */
import "server-only";

import {
  allDomainSpellings,
  conflictsBetween,
  countActivity,
  countOpenPairs,
  listOpenPairs,
  revisionCounts,
  segmentRows,
} from "../db";
import type { Contact, MergePair } from "../types";
import { clauseFor, isChecked, toRow, zoneFor } from "./rows";
import { sheetTotals } from "./totals";
import { buildZones } from "./zones";
import {
  DEVIATION_KINDS,
  PAIR_SAMPLE,
  RecordMark,
  ROW_SAMPLE,
  type BkPair,
  type BkSheet,
  type BkTable,
  type Deviation,
  type DeviationKind,
  type ZoneId,
} from "@/components/blocks/model";

export function buildSheet(): BkSheet {
  const rows = segmentRows("all");
  const openPairs = listOpenPairs(200);
  const changed = revisionCounts();

  // One grouped statement for all 46 domains rather than one statement each: the sheet is the
  // only caller that wants every domain at once, and it wants them on every request.
  const spellings = allDomainSpellings();

  const byDomain = new Map<string, Contact[]>();
  for (const row of rows) {
    const list = byDomain.get(row.domain);
    if (list) list.push(row);
    else byDomain.set(row.domain, [row]);
  }

  const byId = new Map<string, Contact>(rows.map((r) => [r.id, r]));
  const domainOf = new Map<string, string>(rows.map((r) => [r.id, r.domain]));
  const pairsByDomain = new Map<string, MergePair[]>();
  for (const pair of openPairs) {
    const domain = domainOf.get(pair.keep_id) ?? domainOf.get(pair.drop_id);
    if (!domain) continue;
    const list = pairsByDomain.get(domain);
    if (list) list.push(pair);
    else pairsByDomain.set(domain, [pair]);
  }

  // Idents are assigned by descending record count then domain, so BLK-07 names
  // the same block on every machine and the zone letters are a size banding.
  const ordered = [...byDomain.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const tables: (BkTable & { zone: ZoneId })[] = ordered.map(([domain, members], index) => {
    const spelling = spellings[domain] ?? [];
    const name = spelling[0]?.company ?? members[0]?.company ?? domain;
    const sorted = [...members].sort(
      (a, b) => b.last_activity_at.localeCompare(a.last_activity_at) || a.id.localeCompare(b.id),
    );

    const counts: Record<DeviationKind, number> = {
      duplicate: 0,
      conflict: 0,
      phone: 0,
      stale: 0,
    };
    for (const c of sorted) {
      if (c.in_open_pair === 1) counts.duplicate += 1;
      if (c.phone_ok === 0) counts.phone += 1;
      if (c.is_stale === 1 && c.stale_flagged === 0) counts.stale += 1;
    }

    const pairs = pairsByDomain.get(domain) ?? [];
    // A duplicate deviation is counted in pairs, not records: two rows are one
    // unresolved identity, not two problems.
    if (pairs.length > 0) counts.duplicate = pairs.length;
    // And a conflict deviation is counted in spellings, not records, for the same
    // reason: one domain spelled four ways is one disagreement, not fifteen. It is
    // also the figure its own clause prints, so the two cannot drift apart.
    counts.conflict = spelling.length > 1 ? spelling.length : 0;

    const deviations: Deviation[] = DEVIATION_KINDS.filter((k) => counts[k] > 0).map((kind) => ({
      kind,
      count: counts[kind],
      clause: clauseFor(kind, counts[kind], name),
    }));

    const checked = sorted.filter(isChecked).length;
    const outstanding = sorted.filter((c) => !isChecked(c));

    // The example rows are the deviant ones, worst first, because the dossier
    // exists to show the problem and a clean row is not the problem.
    const sample = [...outstanding, ...sorted.filter(isChecked)].slice(0, ROW_SAMPLE);

    // Both records are already in `rows` - that is how the pair found its block - so the
    // preview is a lookup and a pure comparison, not three more statements per pair.
    const previews: BkPair[] = pairs.slice(0, PAIR_SAMPLE).flatMap((pair) => {
      const keep = byId.get(pair.keep_id);
      const drop = byId.get(pair.drop_id);
      if (!keep || !drop) return [];
      return [
        {
          id: pair.id,
          confidence: pair.confidence,
          keep: toRow(keep, changed),
          drop: toRow(drop, changed),
          conflicts: conflictsBetween(keep, drop),
          evidence: pair.evidence,
        },
      ];
    });

    return {
      zone: zoneFor(index, ordered.length),
      ident: `BLK-${String(index + 1).padStart(2, "0")}`,
      domain,
      name,
      records: sorted.length,
      checked,
      outstanding: sorted.length - checked,
      coverage: sorted.length === 0 ? 1 : checked / sorted.length,
      changed: sorted.reduce((n, c) => n + (changed[c.id] ?? 0), 0),
      deviations,
      deviationTotal: deviations.reduce((sum, d) => sum + d.count, 0),
      attention: pairs.length > 0,
      spellings: spelling,
      rows: sample.map((c) => toRow(c, changed)),
      rowsHidden: Math.max(0, sorted.length - sample.length),
      pairs: previews,
      pairsHidden: Math.max(0, pairs.length - previews.length),
      // The same stored flags `isChecked` reads, one code per record. An
      // unadjudicated pair outranks a plain deviation because no rule may
      // resolve it, and the cube colours it apart for exactly that reason.
      marks: sorted.map((c) =>
        c.in_open_pair === 1
          ? RecordMark.Unadjudicated
          : isChecked(c)
            ? RecordMark.Clean
            : RecordMark.Deviates,
      ),
      ids: sorted.map((c) => c.id),
      outstandingIds: outstanding.map((c) => c.id),
      staleIds: sorted
        .filter((c) => c.is_stale === 1 && c.stale_flagged === 0)
        .map((c) => c.id),
      phoneIds: sorted.filter((c) => c.phone_ok === 0).map((c) => c.id),
      why:
        deviations.length === 0
          ? "Every record in this block carries no outstanding deviation."
          : `${deviations.map((d) => d.clause).join("; ")}.`,
    };
  });

  const zones = buildZones(tables);
  // Both figures are the true totals; `shown` is what the capped list actually carried.
  return sheetTotals(
    zones,
    tables,
    { total: countOpenPairs(), shown: openPairs.length },
    countActivity(),
  );
}
