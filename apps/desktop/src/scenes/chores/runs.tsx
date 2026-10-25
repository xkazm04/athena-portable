/**
 * "Your runs" on a chore's topic page — ADR 0124.
 *
 * A case's runs come back to it as receipts the daemon folds from the case's conversation
 * (`GET /adopt/cases/<proj>/runs`): the cards filed and what became of them, the calls that may have
 * completed, the dollars the approved cards asked for and what the ledger recorded. Every number says
 * where it came from; a run with nothing in it is not drawn as zeros, it is said. A card's parameters
 * are the page's, untrusted: they are shown as text in a fenced block, never as markup. The answer
 * outlives a move (`./reads.ts`, ADR 0159) and a refresh that fails says so over the last receipts.
 */
import type { Receipt, ReceiptCard, RunsReply } from "@/lib/adopt";

import type { AdoptDeps } from "./adopt/deps";
import { why } from "./adopt/session";
import { dayOf } from "./adopt/state";
import { readKey, useRead } from "./reads";

/** Why a read did not answer: the daemon is not running, or what it said. */
export interface Failure {
  offline: boolean;
  detail: string;
}

export function failureOf(error: unknown): Failure {
  const w = why(error);
  return { offline: w.reason === "offline", detail: w.detail || w.reason };
}

/** The line said over a last answer a refresh could not replace, or "" when it is fresh. */
export function staleLine(what: string, state: { stale?: Failure }): string {
  if (!state.stale) return "";
  return state.stale.offline
    ? `${what} could not be refreshed: the daemon is not running. This is the last answer it gave.`
    : `${what} could not be refreshed: ${state.stale.detail}. This is the last answer it gave.`;
}

/** What the page knows of one case's runs. */
export type RunsState =
  | { kind: "looking" }
  | { kind: "found"; open: Receipt | null; receipts: Receipt[]; footer: string; refreshing?: boolean; stale?: Failure }
  | ({ kind: "failed" } & Failure);

/** One case's runs: the last answer at once after a move, asked again behind it (ADR 0159). */
export function useRuns(deps: AdoptDeps, caseId: string): RunsState {
  const client = deps.client;
  const state = useRead<RunsReply>(readKey(client, `runs|${caseId}`), () => client.runs(caseId));
  switch (state.kind) {
    case "looking":
      return state;
    case "failed":
      return { kind: "failed", ...failureOf(state.error) };
    case "found": {
      const { open, receipts, footer } = state.value;
      const found = { kind: "found" as const, open, receipts, footer, refreshing: state.refreshing };
      return state.refreshFailed === undefined ? found : { ...found, stale: failureOf(state.refreshFailed) };
    }
  }
}

/** The one line "Your runs" says when it has no receipt to show, or "" when it has. */
export function runsLine(state: RunsState): string {
  switch (state.kind) {
    case "looking":
      return "Looking for your runs…";
    case "failed":
      return state.offline
        ? "Your runs could not be looked up: the daemon is not running."
        : `Your runs could not be looked up: ${state.detail}`;
    case "found":
      return state.open || state.receipts.length
        ? ""
        : "No run yet. Start it for real with her; when you press done, the run comes back here as a receipt.";
  }
}

export const dollars = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What became of the run's cards, naming only the states it has, and where the count is from. */
export function cardsLine(r: Receipt): string {
  if (!r.cards_total) return "No card was filed in this run.";
  const parts = [
    r.approved ? `${r.approved} approved (${r.consumed} let through by the gate)` : "",
    r.declined ? `${r.declined} declined` : "",
    r.expired ? `${r.expired} expired unanswered` : "",
    r.pending ? `${r.pending} still waiting` : "",
  ].filter(Boolean);
  return `${parts.join(", ")}: of the ${plural(r.cards_total, "card")} filed in this run, from the approval table.`;
}

/** The dollars the approved cards asked for; never what came back. */
export function askedLine(r: Receipt): string {
  if (r.asked_usd === null) return r.approved ? "No card you approved named an amount." : "";
  return `${dollars(r.asked_usd)} asked, from ${plural(r.asked_cards, "card")} you approved (each card's own amount).`;
}

/** What the ledger recorded for the run's conversation. */
export function costLine(r: Receipt): string {
  if (!r.calls) return "The ledger holds no row for this run.";
  const minutes = (r.ms / 60000).toFixed(1);
  const failed = r.errors ? `, ${r.errors} of them failed or refused` : "";
  const floor = r.unpriced ? ` (${plural(r.unpriced, "row")} unpriced, so at least this)` : "";
  return `${dollars(r.cost_usd)}${floor} and ${minutes} min, over ${plural(r.calls, "ledger row")}${failed}.`;
}

/** The run's name: when it closed, and its first and last activity (UTC, from the records). */
function title(r: Receipt): string {
  const hours = `${r.first_at.slice(11, 16)}–${r.last_at.slice(11, 16)} UTC`;
  if (!r.until) return `Running now${r.first_at ? `, since ${dayOf(r.first_at)} ${hours}` : ""}`;
  const closed = dayOf(r.closed_at || r.until);
  if (!r.first_at) return `Run closed ${closed}`;
  const day = dayOf(r.first_at) === closed ? "" : `${dayOf(r.first_at)} `;
  return `Run closed ${closed} · active ${day}${hours}`;
}

function Card({ card }: { card: ReceiptCard }) {
  const shown = Object.entries(card.params)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const more = card.more_params ? `\n(and ${plural(card.more_params, "more parameter")})` : "";
  return (
    <li className="pa-run__card">
      <span className="pa-run__action">{card.action}</span>
      <span className="pa-run__status">{card.status === "approved" && card.consumed ? "approved, let through" : card.status}</span>
      {shown ? (
        <pre className="pa-run__params" aria-label={`What the page proposed for ${card.action}`}>
          {shown + more}
        </pre>
      ) : null}
    </li>
  );
}

function ReceiptView({ r }: { r: Receipt }) {
  const asked = askedLine(r);
  return (
    <li className="pa-run">
      <span className="pa-case__title">{title(r)}</span>
      <p className="pa-run__line">{cardsLine(r)}</p>
      {asked ? <p className="pa-run__line">{asked}</p> : null}
      {r.notes_total ? (
        <div className="pa-run__line">
          <p>{`${plural(r.notes_total, "call")} may have completed: the answer never came, so check before asking again.`}</p>
          <ul className="pa-run__cards">
            {r.notes.map((n) => (
              <li key={n.episode_id}>
                <pre className="pa-run__params" aria-label="What the record says">
                  {n.text}
                </pre>
              </li>
            ))}
          </ul>
          {r.notes_footer ? <p className="pa-muted">{r.notes_footer}</p> : null}
        </div>
      ) : null}
      <p className="pa-run__line">{`Spent: ${costLine(r)}`}</p>
      {r.cards.length ? (
        <ul className="pa-run__cards">
          {r.cards.map((c) => (
            <Card key={c.id} card={c} />
          ))}
        </ul>
      ) : null}
      {r.cards_footer ? <p className="pa-muted">{r.cards_footer}</p> : null}
    </li>
  );
}

/** "Your runs" for one saved case. */
export default function Runs({ deps, caseId }: { deps: AdoptDeps; caseId: string }) {
  const state = useRuns(deps, caseId);
  const shown = state.kind === "found" ? [...(state.open ? [state.open] : []), ...state.receipts] : [];
  return (
    <div className="pa-runs" aria-label="Your runs">
      <h4 className="pa-kpi__label">Your runs</h4>
      {shown.length ? (
        <ul className="pa-cases" aria-busy={state.kind === "found" && state.refreshing ? true : undefined}>
          {shown.map((r) => (
            <ReceiptView key={`${r.since}|${r.until}`} r={r} />
          ))}
        </ul>
      ) : (
        <p className="pa-muted" role="status">
          {runsLine(state)}
        </p>
      )}
      {state.kind === "found" && state.stale ? (
        <p className="pa-muted" role="status">
          {staleLine("Your runs", state)}
        </p>
      ) : null}
      {state.kind === "found" && state.footer ? <p className="pa-muted">{state.footer}</p> : null}
    </div>
  );
}
