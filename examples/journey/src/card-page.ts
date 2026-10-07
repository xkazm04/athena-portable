/**
 * docs/demo.md section 5 ("card" segment) — a title or chapter card, as a whole document.
 *
 * The same idiom as `record-page.ts`: the runner sets this on its own page and the recorder films
 * it, so a card is HTML in the repository rather than a frame drawn in an editor. One kicker, one
 * line, an optional figure, an optional sub-line; dark, quiet, nothing that could be read as a
 * logo. The numbers a results card leads with are typed into the script by hand, from README
 * section 9, and the card shows them exactly as the script states them.
 */
import type { Card } from "./script.ts";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: #0b0e14; color: #f2f4f8;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .card { height: 100vh; display: flex; flex-direction: column; justify-content: center;
    padding: 0 140px; gap: 18px; animation: rise .6s ease-out both; }
  .kicker { font-size: 18px; letter-spacing: .14em; text-transform: uppercase; color: #8fd0ff; font-weight: 700; }
  .stat { font-size: 148px; line-height: 1; font-weight: 800; letter-spacing: -.04em;
    font-variant-numeric: tabular-nums; }
  h1 { font-size: 56px; line-height: 1.12; margin: 0; letter-spacing: -.02em; max-width: 1100px; }
  .sub { font-size: 24px; line-height: 1.4; color: #97a3b8; margin: 0; max-width: 1050px; }
  .rule { width: 72px; height: 4px; background: #8fd0ff; border-radius: 2px; }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
`;

/** One card, as a whole document the runner sets on the page. */
export function cardPage(card: Card): string {
  const stat = card.stat ? `<div class="stat">${escape(card.stat)}</div>` : "";
  const sub = card.sub ? `<p class="sub">${escape(card.sub)}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(card.kicker)}</title><style>${STYLE}</style></head><body>
    <section class="card"><div class="kicker">${escape(card.kicker)}</div><div class="rule"></div>${stat}<h1>${escape(card.title)}</h1>${sub}</section>
  </body></html>`;
}
