import "server-only";

/**
 * Tables into databases, and the database's own figures.
 *
 * Worst first inside a database, so the tables that need attention land in the
 * cluster slots nearest the front of the picture and are never the occluded
 * ones. That ordering is the only reason L0 reads at a glance rather than
 * needing to be turned, and it is also the order the L1 cells arrive in, so the
 * dot a reader was looking at is the cell they end up on.
 */
import {
  DATABASES,
  type BkDatabase,
  type BkTable,
  type DatabaseId,
} from "@/components/blocks/model";

export function buildDatabases(tables: (BkTable & { database: DatabaseId })[]): BkDatabase[] {
  return DATABASES.map((meta) => {
    const mine = tables
      .filter((t) => t.database === meta.id)
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
      id: meta.id,
      name: meta.name,
      blurb: meta.blurb,
      span:
        sizes.length === 0
          ? "no tables"
          : `${Math.min(...sizes)} to ${Math.max(...sizes)} records per table`,
      tables: mine,
      records,
      checked,
      coverage: records === 0 ? 1 : checked / records,
      changed: mine.reduce((n, t) => n + t.changed, 0),
      deviationTotal: mine.reduce((n, t) => n + t.deviationTotal, 0),
      attention: mine.filter((t) => t.attention).length,
      clear: mine.filter((t) => t.deviationTotal === 0).length,
      faulty: mine.filter((t) => t.deviationTotal > 0).length,
    } satisfies BkDatabase;
  });
}
