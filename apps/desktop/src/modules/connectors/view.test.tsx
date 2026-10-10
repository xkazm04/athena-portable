/**
 * The Connectors surface is two layers (ADR 0029): the overview reads, the layer writes. Rendered
 * with `renderToStaticMarkup`, no shell, as every module test here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { RECONNECTED_DETAIL, RECORDS_NOTICE, fixtureIds, fixtures } from "./fixtures";
import { entry } from "./index";
import { sealSentence } from "./model";
import ConnectorsView from "./view";

const OVERVIEWS = ["empty", "typical", "heavy", "degraded", "unreadable", "unreachable", "needs-reauth", "flow-failed"];

test("no overview renders a field, a text area or a switch: nothing on it writes", () => {
  for (const fixture of OVERVIEWS) {
    const html = renderToStaticMarkup(entry.preview(fixture));
    expect(html, fixture).not.toMatch(/<input|<textarea|role="radiogroup"/);
    expect(html, fixture).not.toContain('role="dialog"');
  }
});

test("every connector is a tile with its emblem, inked only when it is connected", () => {
  const html = renderToStaticMarkup(entry.preview("typical"));
  expect(html.match(/class="tile /g)?.length).toBe(2);
  expect(html.match(/emblem emblem--done/g)?.length).toBe(1);
});

test("a connected connector's layer holds the decisions; an unconnected one's holds the way in", () => {
  const notion = renderToStaticMarkup(entry.preview("open-notion"));
  expect(notion).toContain('role="dialog"');
  expect(notion).toContain("Allowed page ids");
  expect(notion).toContain("Disconnect");
  const gmail = renderToStaticMarkup(entry.preview("open-gmail"));
  expect(gmail).toContain("Connect with Google");
  // Its decisions are shown as they stand, but locked (item 13), and it offers no Disconnect.
  expect(gmail).toContain("Allowed recipients");
  expect(gmail).not.toContain(">Disconnect</button>");
});

// -- item 10: no blanket "sealed" ---------------------------------------------------------------------

/** Every fixture, plus every layer of every fixture, as markup. */
function everyRender(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const id of fixtureIds) {
    out.push([id, renderToStaticMarkup(entry.preview(id))]);
    for (const row of fixtures[id].rows) {
      out.push([`${id}/${row.id}`, renderToStaticMarkup(<ConnectorsView model={fixtures[id]} initialOpen={row.id} />)]);
    }
  }
  return out;
}

const html = (text: string) => text.replace(/'/g, "&#x27;");

test("the surface never says a credential is sealed, and says encrypted only in a rung that is", () => {
  const rungs = (["keyring", "dpapi", "file"] as const).map((k) => html(sealSentence(k)));
  for (const [where, markup] of everyRender()) {
    expect(markup, where).not.toMatch(/\bseal(ed|s)?\b/i);
    let rest = markup;
    for (const rung of rungs) rest = rest.split(rung).join("");
    expect(rest, where).not.toMatch(/(?<!not )encrypted/i);
  }
});

test("a layer names its rung, and the owner-only file says plainly that it is not encrypted", () => {
  // `heavy` keeps Notion in a file and Gmail in the keystore.
  const notion = renderToStaticMarkup(<ConnectorsView model={fixtures.heavy} initialOpen="notion" />);
  expect(notion).toContain(`The credential is ${html(sealSentence("file"))}.`);
  expect(notion).toContain("it is not encrypted");
  const reconnected = renderToStaticMarkup(entry.preview("open-reconnected"));
  expect(reconnected).toContain("readable by any program running as you");
});

// -- item 11: the records notice ------------------------------------------------------------------------

test("the records notice is a banner at the top, verbatim, with nothing that dismisses it", () => {
  const markup = renderToStaticMarkup(entry.preview("records-unreadable"));
  expect(markup).toContain(RECORDS_NOTICE);
  const at = markup.indexOf("connectors__notice");
  const grid = markup.indexOf("connectors-grid");
  expect(at).toBeGreaterThan(-1);
  // Above the tiles, and the banner itself holds no button of any kind.
  expect(at).toBeLessThan(grid);
  const banner = markup.slice(at, grid);
  expect(banner).toContain('role="alert"');
  expect(banner).toContain(RECORDS_NOTICE);
  expect(banner).not.toMatch(/<button|dismiss|aria-label="close"/i);
  // No other fixture shows it.
  expect(renderToStaticMarkup(entry.preview("typical"))).not.toContain("connectors__notice");
});

test("while the notice stands, no tile implies connected", () => {
  const markup = renderToStaticMarkup(entry.preview("records-unreadable"));
  // `typical` underneath: Notion's record says connected.
  expect(markup).not.toContain("emblem--done");
  expect(markup).not.toMatch(/>connected</);
  expect(markup).not.toMatch(/\d of \d connected/);
  expect(markup).not.toContain("writes off");
  expect(markup).toContain(">unconfirmed<");
  expect(markup).toContain("connections unconfirmed");
  expect(markup).toContain("Shown as not connected because the connections file could not be read");
  expect(markup).not.toContain("Nothing is stored");
  // Its layer still lets the person disconnect what the record holds.
  const layer = renderToStaticMarkup(entry.preview("open-records-unreadable"));
  expect(layer).toContain("Disconnect");
  expect(layer).toContain("cannot be confirmed while the notice above stands");
});

// -- item 12: a connect's own word on the layer ------------------------------------------------------

test("after a connect the layer shows the health detail as a note, never as an error", () => {
  const markup = renderToStaticMarkup(entry.preview("open-reconnected"));
  expect(markup).toContain(`<p class="typo-caption connector__note" role="note">${RECONNECTED_DETAIL}</p>`);
  expect(markup).not.toContain('role="alert"');
  expect(markup).not.toContain("problem-note");
  // The overview's tile is the plain standing, not the detail.
  const overview = renderToStaticMarkup(
    <ConnectorsView model={fixtures["open-reconnected"]} initialOpen={null} />,
  );
  expect(overview).not.toContain(RECONNECTED_DETAIL);
});

// -- item 13: the switches wait for a connection -------------------------------------------------------

test("the writes switch and the list are locked with the reason while not connected, and free once connected", () => {
  const reason = "Connect Gmail first; the switches apply to the account you connect.";
  const gmail = renderToStaticMarkup(entry.preview("open-gmail"));
  expect(gmail).toContain(reason);
  expect(gmail).toMatch(/role="radiogroup" aria-label="Gmail writes" aria-disabled="true"/);
  expect(gmail).toMatch(/<textarea[^>]*aria-label="Allowed recipients"[^>]*disabled=""/);
  expect(gmail).toContain(`title="${reason}" aria-label="${reason}"`);

  const notion = renderToStaticMarkup(entry.preview("open-notion"));
  expect(notion).not.toContain("the switches apply to the account you connect");
  expect(notion).toMatch(/role="radiogroup" aria-label="Notion writes"(?! aria-disabled)/);
  expect(notion).not.toMatch(/<textarea[^>]*disabled=""/);
});
