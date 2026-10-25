/**
 * What the daemon ran itself at an approval - a core, connector or setup tool - read off the
 * answer's `tool.result` events (`POST /decisions/<id>`). Such a call comes back with no row for
 * the page to run, so without this nothing was outstanding and she fell silent after the person
 * said yes. Each event is already a result row (call id, name, ok, output, error, tier, ms) less
 * its kind; it rides the next request like a page's result, with a line for the transcript.
 *
 * Its own module, loaded only when an approval needs it: the run store is first-frame code. The
 * re-ask of a card whose page moved (`staleOf`, `reaskLine`) and the merge of the daemon's
 * pending rows into the cards (`mergeCards`, run after `GET /decisions` answered) live here for the
 * same reason: neither runs in the first frame.
 */
import type { DecisionRequested } from "@/lib/events";

import type { BindingRefusal, TranscriptEntry } from "./run";

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

/**
 * Which cards can no longer run where they were proposed (ADR 0103): card id to `moved` (the bound
 * tab reloaded or navigated since) or `closed` (it is gone). An unbound card, or one whose tab
 * still holds its document, has no entry. `refused` is the run store's own binding check, read
 * against the tabs as they are now - the same check an approval makes.
 */
export function staleOf(
  cards: readonly DecisionRequested[],
  refused: (card: DecisionRequested) => BindingRefusal | null,
): Record<string, BindingRefusal["why"]> {
  const out: Record<string, BindingRefusal["why"]> = {};
  for (const card of cards) {
    const why = refused(card)?.why;
    if (why) out[card.id] = why;
  }
  return out;
}

/**
 * The fixed line a re-ask sends in place of words the person did not type (as the run store's
 * continuation line does): what could not run, and that it is to be proposed again on the page as
 * it is now, so every new card is bound to the current document and shown again.
 */
export function reaskLine(actions: readonly string[]): string {
  return `(these could not run because the page they were proposed on changed since: ${actions.join(", ")}; propose them again on the page as it is now)`;
}

/**
 * A card from a `GET /decisions` row. A pending row may lack what the stream carried (the rationale,
 * the capture), so the card is built from what the row has: its action and parameters at minimum.
 */
export function cardFromRow(row: Record<string, unknown>): DecisionRequested | null {
  if (typeof row.id !== "string" || row.id === "") return null;
  const options = Array.isArray(row.options)
    ? row.options.flatMap((o: unknown) => {
        if (typeof o === "string") return [{ id: o, label: o }];
        if (typeof o === "object" && o !== null && typeof (o as { id?: unknown }).id === "string") {
          const { id, label } = o as { id: string; label?: unknown };
          return [{ id, label: typeof label === "string" ? label : id }];
        }
        return [];
      })
    : [];
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    kind: "decision.requested",
    id: row.id,
    decision_kind: text(row.decision_kind) || "approve",
    action: text(row.action) || "a request from an app",
    params:
      typeof row.params === "object" && row.params !== null && !Array.isArray(row.params)
        ? (row.params as Record<string, unknown>)
        : {},
    rationale: text(row.rationale) || text(row.summary),
    options: options.length
      ? options
      : [
          { id: "approve", label: "approve" },
          { id: "decline", label: "decline" },
        ],
    expires_at: text(row.expires_at),
    origin: text(row.origin),
    surface: text(row.surface),
    capture_id: typeof row.capture_id === "string" ? row.capture_id : null,
    tab_id: countOf(row.tab_id),
    tab_nav: countOf(row.tab_id) === null ? null : countOf(row.tab_nav),
  };
}

/** A tab id or a navigation count off a wire row: a non-negative integer, else `null`. */
function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The union of the stream's cards and the daemon's pending rows. A card the stream gave is kept
 * as it is, with only its empty fields filled from the row; a pending row with no card gets one,
 * unless `skip` says it has already been answered or is being answered.
 */
export function mergeCards(
  current: readonly DecisionRequested[],
  pending: ReadonlyArray<Record<string, unknown>>,
  skip: (id: string) => boolean,
): DecisionRequested[] {
  const rows = new Map<string, DecisionRequested>();
  for (const row of pending) {
    const card = cardFromRow(row);
    if (card) rows.set(card.id, card);
  }
  const have = new Set(current.map((c) => c.id));
  const kept = current.map((card) => {
    const row = rows.get(card.id);
    if (!row) return card;
    return {
      ...card,
      rationale: card.rationale || row.rationale,
      origin: card.origin || row.origin,
      surface: card.surface || row.surface,
      expires_at: card.expires_at || row.expires_at,
      params: Object.keys(card.params).length ? card.params : row.params,
      // The binding is the row's: a card from the stream that lacks it takes the row's.
      tab_id: card.tab_id ?? row.tab_id,
      tab_nav: card.tab_id != null ? card.tab_nav : row.tab_nav,
    };
  });
  const added = [...rows.values()].filter((card) => !have.has(card.id) && !skip(card.id));
  return added.length ? [...kept, ...added] : kept;
}
