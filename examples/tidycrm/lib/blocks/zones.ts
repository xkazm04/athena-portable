import "server-only";

/**
 * Blocks into zones, and the zone's own figures.
 *
 * Worst first inside a zone, so the blocks that need attention land in the
 * lattice slots nearest the front of the cube and are never the occluded ones.
 * That ordering is the only reason the plate reads at a glance rather than
 * needing to be turned.
 */
import { ZONE_IDS, type BkTable, type BkZone, type ZoneId } from "@/components/blocks/model";

export function buildZones(tables: (BkTable & { zone: ZoneId })[]): BkZone[] {
  return ZONE_IDS.map((id) => {
    // Worst first inside a zone, so the blocks that need attention land in the
    // lattice slots nearest the front and are never the occluded ones.
    const mine = tables
      .filter((t) => t.zone === id)
      .sort(
        (a, b) =>
          b.deviationTotal - a.deviationTotal ||
          Number(b.attention) - Number(a.attention) ||
          a.ident.localeCompare(b.ident),
      );
    const records = mine.reduce((n, t) => n + t.records, 0);
    const checked = mine.reduce((n, t) => n + t.checked, 0);
    const sizes = mine.map((t) => t.records);
    return {
      id,
      span:
        sizes.length === 0
          ? "no blocks"
          : `${Math.min(...sizes)} to ${Math.max(...sizes)} records per block`,
      tables: mine,
      records,
      checked,
      coverage: records === 0 ? 1 : checked / records,
      changed: mine.reduce((n, t) => n + t.changed, 0),
      deviationTotal: mine.reduce((n, t) => n + t.deviationTotal, 0),
      attention: mine.filter((t) => t.attention).length,
      clear: mine.filter((t) => t.deviationTotal === 0).length,
    } satisfies BkZone;
  });
}
