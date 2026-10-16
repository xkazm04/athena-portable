/**
 * docs/demo.md section 2, act 4 ("The record") — the ledger, the declines and the facts, as a page.
 *
 * Act 4 is the only act with nothing to film: the record is a table in Node, not a view in an
 * application, and putting it on screen by scrolling a terminal would say the wrong thing about
 * where it lives. So the runner renders it itself, into the same context and the same video, as
 * views of one document — every row, then the two declines, then the three facts with the rows
 * they cite, then the title card. The two-minute cut has one beat where the long take has three,
 * so it has a fifth view (`record`) that says the same three things on one screen.
 *
 * It is the runner's own page, exactly as the strip is the runner's own UI, and it is built from
 * `Ledger` and `Brain` rather than from a copy: a number on screen that is not the number in the
 * record would be the one thing act 4 exists to disprove.
 */
import type { Brain } from "./brain.ts";
import type { Ledger, LedgerRow } from "./ledger.ts";

export type RecordView = "ledger" | "declines" | "facts" | "record" | "title";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tierLabel(row: LedgerRow): string {
  return row.tier === 1 ? "1 · page" : row.tier === 2 ? "2 · hand" : "3 · connector";
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0e14; color: #f2f4f8;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { padding: 84px 40px 32px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.01em; }
  .sub { color: #97a3b8; font-size: 15px; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th { text-align: left; color: #8fd0ff; font-size: 11px; letter-spacing: .07em; text-transform: uppercase;
    padding: 0 12px 8px 0; border-bottom: 1px solid #2b3446; }
  td { padding: 5px 12px 5px 0; border-bottom: 1px solid #161c28; white-space: nowrap; }
  td.mono, th.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  tr.denied td { background: #2a1518; color: #ffc9c9; }
  tr.denied td:first-child { box-shadow: inset 3px 0 0 #ff7a7a; padding-left: 9px; }
  .gated { color: #ffd79a; font-weight: 700; }
  .auto { color: #8aa0bd; }
  .counts { display: flex; gap: 28px; margin: 0 0 20px; }
  .counts div { font-size: 13px; color: #97a3b8; }
  .counts b { display: block; font-size: 28px; color: #f2f4f8; font-weight: 700; line-height: 1.2; }
  .facts { display: flex; flex-direction: column; gap: 14px; max-width: 1000px; }
  .fact { border: 1px solid #33405a; border-left: 4px solid #8fd0ff; border-radius: 10px; padding: 14px 16px; }
  .fact .claim { font-size: 17px; line-height: 1.35; }
  .fact .cites { margin-top: 8px; font-size: 12px; color: #97a3b8;
    font-family: ui-monospace, Menlo, Consolas, monospace; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: start; }
  .split h2 { font-size: 13px; letter-spacing: .07em; text-transform: uppercase; color: #8fd0ff;
    margin: 0 0 10px; font-weight: 700; }
  .split table td, .split table th { white-space: nowrap; }
  .denied-only { margin-top: 22px; }
  .title { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
  .title h1 { font-size: 72px; letter-spacing: -.03em; }
  .title p { font-size: 22px; color: #97a3b8; margin: 0; }
`;

function ledgerTable(ledger: Ledger, highlight: boolean): string {
  const head = ["#", "app", "tier", "tool", "class", "outcome", "reason", "approval", "target"];
  const rows = ledger.rows
    .map((row) => {
      const denied = highlight && row.reason === "user_denied";
      const cells = [
        String(row.seq),
        row.app,
        tierLabel(row),
        row.tool,
        row.cls === "GATED" ? `<span class="gated">GATED</span>` : `<span class="auto">AUTO</span>`,
        row.outcome,
        row.reason ?? "—",
        row.approval ?? "—",
        row.target ?? "—",
      ];
      const body = cells
        .map((cell, index) => `<td class="${index === 0 || index > 6 ? "mono" : ""}">${index === 4 ? cell : escape(cell)}</td>`)
        .join("");
      return `<tr class="${denied ? "denied" : ""}">${body}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * The two-minute cut's single record beat (`script/cut.en.json`, R1).
 *
 * The long take reads the record in three views because it has thirty-five seconds to do it in.
 * The cut has one beat, so the same three things have to be true of one screen: how much happened
 * and where — grouped by app and by tier, because "a hundred rows" is the shape of the claim and
 * not a hundred legible rows — the two declines in full, and the facts with what they cite. The
 * numbers are read off `Ledger` and `Brain` exactly as the other views read them.
 */
function groupedTable(ledger: Ledger): string {
  const keys = new Map<string, { app: string; tier: number; calls: number; gated: number; refused: number }>();
  for (const row of ledger.rows) {
    const key = `${row.app}\u0000${row.tier}`;
    const held = keys.get(key) ?? { app: row.app, tier: row.tier, calls: 0, gated: 0, refused: 0 };
    held.calls += 1;
    if (row.cls === "GATED") held.gated += 1;
    if (row.outcome === "refused") held.refused += 1;
    keys.set(key, held);
  }
  const head = ["app", "tier", "calls", "gated", "refused"];
  const body = [...keys.values()]
    .sort((a, b) => (a.tier - b.tier === 0 ? a.app.localeCompare(b.app) : a.tier - b.tier))
    .map(
      (group) =>
        `<tr><td>${escape(group.app)}</td><td class="mono">${
          group.tier === 1 ? "1 · page" : group.tier === 2 ? "2 · hand" : "3 · connector"
        }</td><td class="mono">${group.calls}</td><td class="mono gated">${group.gated}</td><td class="mono">${
          group.refused === 0 ? "—" : group.refused
        }</td></tr>`,
    )
    .join("");
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

/** The declined rows, in full and highlighted: the whole of what the audience is asked to read. */
function deniedTable(ledger: Ledger): string {
  const head = ["#", "app", "tool", "class", "outcome", "reason", "approval"];
  const body = ledger
    .withReason("user_denied")
    .map(
      (row) =>
        `<tr class="denied"><td class="mono">${row.seq}</td><td>${escape(row.app)}</td><td class="mono">${escape(
          row.tool,
        )}</td><td><span class="gated">${row.cls}</span></td><td>${escape(row.outcome)}</td><td class="mono">${escape(
          row.reason ?? "—",
        )}</td><td class="mono">${escape(row.approval ?? "—")}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function factCards(ledger: Ledger, brain: Brain): string {
  return `<div class="facts">${brain.facts
    .map(
      (fact) =>
        `<div class="fact"><div class="claim">${escape(fact.claim)}</div>
           <div class="cites">${escape(fact.id)} · learned in ${escape(fact.learnedIn)} · cites ledger ${fact.cites
             .map((seq) => `#${seq} ${escape(ledger.rows[seq - 1]?.tool ?? "?")}`)
             .join(", ")}</div></div>`,
    )
    .join("")}</div>`;
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/**
 * The declines view's headline, from the ledger's own count.
 *
 * It printed "Two declines" whatever the record held, beside a counter that said otherwise; this
 * page exists so that no number on screen is one the record does not hold (the header above).
 */
export function declinesHeading(count: number): string {
  return `${COUNT_WORDS[count] ?? String(count)} decline${count === 1 ? "" : "s"}`;
}

/** The sentence under it. Two reads exactly as the long take narrates it ("Both recorded as ..."). */
export function declinesSub(count: number): string {
  const vocabulary = "<code>user_denied</code> is a reason from the closed set";
  if (count === 0) return "Nothing was declined in this run.";
  if (count === 1) return `Recorded as the user's decision, not as an error — ${vocabulary}, and nothing moved on the page.`;
  if (count === 2) return `Both recorded as the user's decision, not as errors — ${vocabulary}, and nothing moved on either page.`;
  return `Each recorded as the user's decision, not as an error — ${vocabulary}, and nothing moved on any of the pages.`;
}

/** One of the five views of the record, as a whole document the runner sets on the page. */
export function recordPage(view: RecordView, ledger: Ledger, brain: Brain): string {
  const denied = ledger.withReason("user_denied");
  const gated = ledger.rows.filter((row) => row.cls === "GATED");
  const body =
    view === "title"
      ? `<div class="title"><h1>Athena</h1><p>Your agent, in the apps you already have.</p></div>`
      : view === "record"
        ? `<main><h1>Everything she did is one table</h1>
             <p class="sub">${ledger.rows.length} calls: her own tools on the page, her hands on a page nobody instrumented, and her connectors — every one of them classed by the same gate.</p>
             <div class="counts">
               <div><b>${ledger.rows.length}</b>calls</div>
               <div><b>${gated.length}</b>gated</div>
               <div><b>${ledger.rows.filter((row) => row.tier === 2).length}</b>hands (tier 2)</div>
               <div><b>${ledger.connectorWrites().length}</b>connector writes (tier 3)</div>
               <div><b>${denied.length}</b>declined</div>
               <div><b>${brain.facts.length}</b>facts learned</div>
             </div>
             <div class="split">
               <div><h2>By app and tier</h2>${groupedTable(ledger)}
                 <div class="denied-only"><h2>Declined — your decision, not an error</h2>${deniedTable(ledger)}</div>
               </div>
               <div><h2>What she now knows</h2>${factCards(ledger, brain)}</div>
             </div></main>`
        : view === "facts"
        ? `<main><h1>What she now knows</h1>
             <p class="sub">${brain.facts.length} facts, each citing the ledger row it was learned from. A fact that cites no live episode is refused at write.</p>
             <div class="facts">${brain.facts
               .map(
                 (fact) =>
                   `<div class="fact"><div class="claim">${escape(fact.claim)}</div>
                      <div class="cites">${escape(fact.id)} · learned in ${escape(fact.learnedIn)} · cites ledger ${fact.cites
                        .map((seq) => `#${seq} ${escape(ledger.rows[seq - 1]?.tool ?? "?")}`)
                        .join(", ")}</div></div>`,
               )
               .join("")}</div></main>`
        : view === "declines"
          ? `<main><h1>${declinesHeading(denied.length)}</h1>
               <p class="sub">${declinesSub(denied.length)}</p>
               <div class="counts">
                 <div><b>${denied.length}</b>declined</div>
                 <div><b>${gated.length}</b>gated calls</div>
                 <div><b>${ledger.rows.length}</b>rows in all</div>
               </div>
               ${ledgerTable(ledger, true)}</main>`
          : `<main><h1>Everything she did is one table</h1>
               <p class="sub">${ledger.rows.length} rows: every call, its app, the tier it happened at, whether it was gated, and what the answer was.</p>
               <div class="counts">
                 <div><b>${ledger.rows.length}</b>calls</div>
                 <div><b>${gated.length}</b>gated</div>
                 <div><b>${ledger.connectorWrites().length}</b>connector writes</div>
                 <div><b>${brain.facts.length}</b>facts learned</div>
               </div>
               ${ledgerTable(ledger, false)}</main>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>The record</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}
