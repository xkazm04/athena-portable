/**
 * What the daemon ran itself at an approval - a core, connector or setup tool - read off the
 * answer's `tool.result` events (`POST /decisions/<id>`). Such a call comes back with no row for
 * the page to run, so without this nothing was outstanding and she fell silent after the person
 * said yes. Each event is already a result row (call id, name, ok, output, error, tier, ms) less
 * its kind; it rides the next request like a page's result, with a line for the transcript.
 *
 * Its own module, loaded only when an approval needs it: the run store is first-frame code.
 */
import type { TranscriptEntry } from "./run";

/** One carried result: the row for the next request, and its transcript entry. */
export interface RanRow {
  row: Record<string, unknown>;
  entry: TranscriptEntry;
}

export function ranRows(events: ReadonlyArray<Record<string, unknown>>): RanRow[] {
  return events
    .filter((e) => e.kind === "tool.result" && typeof e.call_id === "string")
    .map((e) => {
      const row: Record<string, unknown> = { ...e };
      delete row.kind;
      const ok = row.ok === true;
      const said = String((ok ? row.output : (row.error ?? row.output)) ?? "").split("\n")[0]!.slice(0, 160);
      const tier = typeof row.tier === "number" ? row.tier : 1;
      return { row, entry: { id: String(row.call_id), kind: "tool", text: `${String(row.name)} → ${said}`, tier, ok } };
    });
}
