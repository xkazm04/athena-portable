/** Tests for the Apps scene's view — README section 3.4 and 3.5, ADR 0029, 0063, 0087 and 0088. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, test } from "vitest";

import type { Path } from "@/depth/model";

import { PATHS, SPACES, fixtureIds, fixtures } from "./fixtures";
import AppsView from "./view";

const go = () => {};
const html = (fixture: string, path: Path = PATHS.field!) =>
  renderToStaticMarkup(<AppsView model={fixtures[fixture]!} path={path} go={go} />);

describe("every fixture renders at every level", () => {
  for (const id of fixtureIds) {
    for (const [name, path] of Object.entries(PATHS)) {
      it(`${id} at ${name}`, () => {
        expect(html(id, path).length).toBeGreaterThan(0);
      });
    }
  }
});

describe("the field", () => {
  it("shows each registered app as a button that says its standing in words", () => {
    const h = html("typical");
    expect(h).toContain("localhost:3004, ready. Open its layer.");
    expect(h).toContain("crm.example.test, not acting. Open its layer.");
    expect(h.match(/class="apps__orb focus-ring"/g)).toHaveLength(3);
  });

  it("says how many are registered and how many are open", () => {
    const h = html("typical");
    expect(h).toContain("3 registered");
    expect(h).toContain("3 open");
  });

  it("lists every open page, each with a way to close it", () => {
    const h = html("typical");
    expect(h).toContain("Open pages");
    expect(h).toContain('aria-label="Close Invoices — March"');
  });

  it("marks the focused page for a reader who cannot see the border, and only that one", () => {
    const h = html("typical");
    const focused = (h.match(/data-focused="true"/g) ?? []).length;
    expect(focused).toBeGreaterThan(0);
    expect(h.match(/aria-current="true"/g) ?? []).toHaveLength(focused);
  });

  it("leads with one sentence, an Enter hint and the engine's standing on a first run", () => {
    const h = html("first-run");
    expect(h).toContain("Type the address of an app you use, for example your invoicing tool.");
    expect(h).toContain("Press Enter to open it");
    expect(h).toContain("Setup: Engine: Claude Code, ready.");
    expect(h).toContain("apps__register--lead");
    expect(h).not.toContain('placeholder="invoicing.example.test"');
  });

  it("says plainly when none is registered, and that the origins table has not answered", () => {
    expect(html("empty")).toContain("No app is registered yet. Register one, or open a page and switch it on.");
    expect(html("degraded")).toContain("The origins table has not answered yet.");
  });

  it("gives the store's own words when the origins table refused, never a paraphrase", () => {
    const h = html("apps-unread");
    expect(h).toContain("store_list: origins: database is locked");
    expect(h).toContain("The origins table did not answer. Apps still open; their standing is not shown.");
    expect(h).toContain("could not be read");
  });

  it("gives the shell's words when the tab list is unread", () => {
    expect(html("degraded")).toContain("the shell has not answered tabs_list yet");
  });

  it("keeps the honest copy about registering", () => {
    expect(html("typical")).toContain("nothing is done there until you approve it");
  });

  it("shows a standing by its word as well as its shape, never by colour alone", () => {
    const h = html("heavy");
    for (const word of ["ready", "read only", "reading", "not acting", "not opened"]) expect(h).toContain(word);
  });
});

describe("one app", () => {
  const h = html("typical", PATHS.app);

  it("holds the switch, Forget and Open, with the old words", () => {
    expect(h).toContain("Athena may act here");
    expect(h).toContain("Off, every call on this app is refused by the gate.");
    expect(h).toContain('role="radiogroup"');
    expect(h).toContain("Forget this app");
    expect(h).toContain("Show the page");
  });

  it("asks twice before forgetting: the first press has not forgotten, the words are on the second", () => {
    expect(h).not.toContain("Yes, forget");
    expect(h).toContain("The origin, its switch and its pinned classes go.");
  });

  it("states tools, pinned classes and when it was last seen", () => {
    expect(h).toContain("3 over webmcp-polyfill");
    expect(h).toContain("Pinned classes");
    expect(h).toContain("Last seen");
  });

  it("lists the tools the open page registered, as links to the next level", () => {
    expect(h).toContain("List invoices");
    expect(h).toContain("pinned GATED");
  });

  it("says a page with no tools of its own is reached through her generic hands, gated on first sight (ADR 0065)", () => {
    expect(html("no-bridge", PATHS.app)).toContain(
      "Athena reaches it through her generic hands, gated on first sight",
    );
  });

  it("says an app that is not open has nothing to list until it is", () => {
    const crm = html("typical", { root: "apps", item: "https://crm.example.test" });
    expect(crm).toContain("Open the page and Athena asks it what it has registered.");
    expect(crm).toContain("Open the page");
  });

  it("draws a page that is open on an origin nobody registered, with the one way to register it", () => {
    const bare = html("typical", { root: "apps", item: "http://example.test" });
    expect(bare).toContain("Open page, not registered");
    expect(bare).toContain("Register this app");
  });

  it("says the drawing is a drawing", () => {
    expect(h).toContain("Stylised drawing, not the app.");
  });
});

describe("one tool", () => {
  const h = html("typical", PATHS.tool);

  it("shows what the page said, verbatim, and says they are claims", () => {
    expect(h).toContain("Send the drafted reminder to the customer");
    expect(h).toContain("external");
    expect(h).toContain("claims, never permissions");
  });

  it("never states a class: that is the gate's answer", () => {
    expect(h).toContain("Whether Athena may run this");
    expect(h).not.toMatch(/\bAUTO\b|\bREAD\b/);
    expect(h).toContain("GATED"); // only as the person's own pin
  });

  it("says so when the page no longer offers the tool", () => {
    const gone = html("typical", { root: "apps", item: "http://localhost:3004", sub: { kind: "tool", arg: "nope" } });
    expect(gone).toContain("not offering that tool right now");
  });
});

test("a place that names nothing says so, with a way back", () => {
  const h = html("typical", PATHS.missing);
  expect(h).toContain("No such app");
  expect(h).toContain("Back to the apps");
});

describe("an app's projects (ADR 0225)", () => {
  it("lists the projects that pair it as chips into their level, and offers the others", () => {
    const h = html("typical", PATHS.app);
    expect(h).toContain("In projects");
    expect(h).toContain('aria-label="Open the project Month-end close"');
    expect(h).not.toContain('aria-label="Open the project Client outreach"');
    expect(h).toContain("Add to project");
  });

  it("says when it is in no project, and offers no adding when there is no other project", () => {
    const none = { ...fixtures.typical!, spaces: { ...SPACES, list: [] } };
    const h = renderToStaticMarkup(<AppsView model={none} path={PATHS.app!} go={go} />);
    expect(h).toContain("In no project.");
    expect(h).not.toContain("Add to project");
  });
});
