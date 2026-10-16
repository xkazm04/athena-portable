/**
 * Tests for the Accounts depth's view — README sections 3.5 and 4, ADR 0021, 0062 and 0087.
 *
 * Every fixture is rendered at the root, and every open state of the old module at its place in
 * the depth. Each parity capability and each safety rule of the Connectors module is asserted to
 * be present and wired (`renderToStaticMarkup`, no shell); the two-press confirms, Enter-sends and
 * Escape-cancels are driven in `interact.test.tsx`, which needs a DOM.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";
import { RECONNECTED_DETAIL, RECORDS_NOTICE } from "@/modules/connectors/fixtures";
import { sealSentence } from "@/modules/connectors/model";

import { PLACES, fixtureIds, fixtures } from "./fixtures";
import { entry } from "./index";
import AccountsView from "./view";

const noGo = () => {};
const ROOT: Path = { root: "accounts" };

const draw = (fixture: string, at: Path = ROOT) =>
  renderToStaticMarkup(entry.preview(fixture, { path: at, go: noGo }));
const place = (name: string) => draw(PLACES[name]!.fixture, PLACES[name]!.path);
/** The markup escapes an apostrophe; the model's sentences do not. */
const esc = (text: string) => text.replace(/'/g, "&#x27;");

describe("every fixture renders", () => {
  for (const id of fixtureIds) {
    it(`${id} at the field`, () => {
      const html = draw(id);
      expect(html).toContain('class="accounts"');
      expect(html).toMatch(/accounts__marquee|problem-note|Asking the daemon/);
    });
  }
  for (const [name, p] of Object.entries(PLACES)) {
    it(`place ${name}`, () => {
      expect(place(name), name).toContain(`data-level="${p.path.sub ? "allowlist" : "item"}"`);
    });
  }
  it("is drawn by the registered scene under its own root", () => {
    expect(entry.root).toBe("accounts");
    expect(fixtureIds[0]).toBe("typical");
  });
});

describe("the field: standing by shape and word", () => {
  it("draws one card per account with its drawing, and links it by id", () => {
    const html = draw("typical");
    expect(html.match(/class="card focus-ring"/g)).toHaveLength(2);
    expect(html).toContain('data-go="gmail"');
    expect(html).toContain('data-go="notion"');
    expect(html.match(/class="glyph account-art"/g)).toHaveLength(2);
    // Drawn, not borrowed: generic marks, and the scene says so.
    expect(html).toContain("not the services&#x27; own marks");
  });

  it("names the centre in display type, and the count of what is connected", () => {
    const html = draw("typical");
    expect(html).toContain('<h1 class="accounts__marquee">Accounts</h1>');
    expect(html).toContain("1 of 2 connected");
  });

  it("gives each standing its word and its own shape", () => {
    const seen = (fixture: string) => draw(fixture);
    expect(seen("typical")).toContain(">not connected<");
    expect(seen("typical")).toContain(">connected<");
    expect(seen("needs-reauth")).toContain(">needs reconnecting<");
    expect(seen("refused")).toContain(">switched off<");
    expect(seen("heavy")).toMatch(/>broken \(\d+ min ago\)</);
    expect(seen("records-unreadable")).toContain(">unconfirmed<");
    const shapes = ["connected", "not-connected", "needs-reauth", "off", "broken", "unconfirmed"].map((s) => {
      const body = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../art/accounts.tsx"), "utf8");
      return [s, body.includes(`standing === "${s}"`)] as const;
    });
    for (const [s, has] of shapes) expect(has, `a shape for ${s}`).toBe(true);
    // The mark carries its standing, so a test and a screen reader can tell them apart.
    expect(seen("typical")).toContain('data-standing="connected"');
    expect(seen("needs-reauth")).toContain('data-standing="needs-reauth"');
  });

  it("marks each connector's chips: reads, writes as gated, and writes on or off once connected", () => {
    const html = draw("typical");
    expect(html).toContain("2 reads");
    expect(html).toContain("1 write, gated");
    expect(html).toContain("2 writes, gated");
    expect(html).toContain("writes off");
    expect(draw("heavy")).toContain("writes on");
  });

  it("shows a busy word on the row, not a spinner alone", () => {
    expect(draw("heavy")).toContain("saving…");
    expect(draw("refused")).toContain("connecting…");
  });
});

describe("the records notice", () => {
  const html = draw("records-unreadable");

  it("is a banner at the top, verbatim, in an alert, with nothing that dismisses it", () => {
    const at = html.indexOf("accounts__notice");
    const field = html.indexOf('class="reach"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(field);
    const banner = html.slice(at, field);
    expect(banner).toContain('role="alert"');
    expect(banner).toContain(RECORDS_NOTICE);
    expect(banner).not.toMatch(/<button|dismiss|aria-label="close"/i);
  });

  it("makes every row read unconfirmed and none read connected", () => {
    expect(html).toContain(">unconfirmed<");
    expect(html).not.toContain('data-standing="connected"');
    expect(html).not.toMatch(/>connected</);
    expect(html).not.toMatch(/\d of \d connected/);
    expect(html).toContain("connections unconfirmed");
    expect(html).not.toContain("writes off");
  });

  it("stands at the account too, and says why the record cannot be confirmed", () => {
    const item = place("open-records-unreadable");
    expect(item).toContain(RECORDS_NOTICE);
    expect(item).toContain("cannot be confirmed while the notice above stands");
    // The record's own fact still lets the person disconnect what it holds.
    expect(item).toContain("Disconnect");
  });

  it("is absent when the vault says nothing", () => {
    expect(draw("typical")).not.toContain("accounts__notice");
    expect(place("open-notion")).not.toContain("accounts__notice");
  });
});

describe("connect by token and by OAuth", () => {
  it("a token account offers a password field that Enter sends, and says it is shown once", () => {
    const html = draw("empty", { root: "accounts", item: "notion" });
    expect(html).toContain("Integration token");
    expect(html).toMatch(/type="password"[^>]*autoComplete|autoComplete="off"[^>]*type="password"|type="password"/);
    expect(html).toContain("Pasted once, probed against the service, then stored on this machine. It is never shown again.");
    expect(html).toContain(">Connect<");
    expect(html).toContain("Paste the token first.");
  });

  it("an OAuth account asks for the pair and names the consent step", () => {
    const html = place("open-gmail");
    expect(html).toContain("Client id");
    expect(html).toContain("Client secret");
    expect(html).toContain("Connect with Google");
    expect(html).toContain("Your browser opens Google");
    expect(html).toContain("Paste the client id first.");
    expect(html).toContain('aria-label="Steps to connect"');
    expect(html).toContain("Consent");
  });

  it("while the consent page is open it says which phase, and links back to it", () => {
    const waiting = place("open-consenting");
    expect(waiting).toContain("waiting for consent");
    expect(waiting).toContain("Open the consent page again");
    expect(waiting).toContain("A consent page is open; finish it in the browser first.");
    expect(waiting).toContain('aria-current="step"');
    expect(place("open-exchanging")).toContain("exchanging the code");
  });

  it("a failed consent is said, with the provider's reason verbatim", () => {
    const html = place("open-flow-failed");
    expect(html).toContain("The consent did not complete.");
    expect(html).toContain("the provider refused: access_denied");
    expect(html).toContain('role="alert"');
  });

  it("a connected account offers no connect form", () => {
    const html = place("open-notion");
    expect(html).not.toContain("Integration token");
    expect(html).not.toContain("Connect with Google");
  });

  it("carries the guide for getting the credential, as steps", () => {
    const html = place("open-gmail");
    expect(html).toContain("How to connect");
    expect(html).toContain('class="guide__steps"');
  });
});

describe("disconnect, health, the seal and the switches", () => {
  it("offers Disconnect once, only where something is stored; the confirm is not shown yet", () => {
    for (const name of ["open-notion", "open-reauth", "open-records-unreadable"]) {
      const html = place(name);
      expect(html, name).toContain(">Disconnect</button>");
      expect(html, name).not.toContain("Yes, disconnect");
    }
    expect(place("open-gmail")).not.toContain(">Disconnect<");
  });

  it("says how the credential rests, and the file rung says it is not encrypted", () => {
    expect(place("open-notion")).toContain(esc(`The credential is ${sealSentence("dpapi")}.`));
    const file = place("open-heavy-notion");
    expect(file).toContain(esc(`The credential is ${sealSentence("file")}.`));
    expect(file).toContain("it is not encrypted");
    expect(place("open-heavy-gmail")).toContain(esc(sealSentence("keyring")));
  });

  it("never says sealed, and says encrypted only in a rung that is", () => {
    const rungs = (["keyring", "dpapi", "file"] as const).map((k) => esc(sealSentence(k)));
    const every = [...fixtureIds.map((id) => draw(id)), ...Object.keys(PLACES).map(place)];
    for (const markup of every) {
      expect(markup).not.toMatch(/\bseal(ed|s)?\b/i);
      let rest = markup;
      for (const rung of rungs) rest = rest.split(rung).join("");
      expect(rest).not.toMatch(/(?<!not )encrypted/i);
    }
  });

  it("shows the last probe's age and Check now on a connected account", () => {
    const html = place("open-notion");
    expect(html).toContain("Last checked 2 h ago.");
    expect(html).toContain("Check now");
  });

  it("shows a connect's own word as a note, never an error", () => {
    const html = place("open-reconnected");
    expect(html).toContain(`role="note">${RECONNECTED_DETAIL}</p>`);
    expect(html).not.toContain("problem-note");
    // The field's card is the plain standing, not the detail.
    expect(draw("reconnected")).not.toContain(RECONNECTED_DETAIL);
  });

  it("has an on and off switch for a connected account, named for it", () => {
    const html = place("open-notion");
    expect(html).toContain('role="radiogroup" aria-label="Notion switch"');
    expect(html).toContain("Athena may call it");
  });

  it("states the writes hint and locks the writes switch with the reason until connected", () => {
    const reason = "Connect Gmail first; the switches apply to the account you connect.";
    const locked = place("open-gmail");
    expect(locked).toContain(reason);
    expect(locked).toMatch(/role="radiogroup" aria-label="Gmail writes" aria-disabled="true"/);
    expect(locked).toContain("Writes run after your approval, to the list below.");

    const free = place("open-notion");
    expect(free).toMatch(/role="radiogroup" aria-label="Notion writes"(?! aria-disabled)/);
    expect(free).toContain("Writes run after your approval, to the list below.");
    expect(free).not.toContain("the switches apply to the account you connect");
  });
});

describe("what it yields", () => {
  it("lists reads, and marks every write GATED and no read", () => {
    const html = place("open-notion");
    expect(html).toContain("<code");
    for (const read of ["search", "read_page"]) expect(html).toContain(`>${read}</code>`);
    for (const write of ["append_to_page", "create_page"]) expect(html).toContain(`>${write}</code>`);
    expect(html.match(/GATED/g)).toHaveLength(2);
    const reads = html.slice(html.indexOf("Reads"), html.indexOf("Writes</span>"));
    expect(reads).not.toContain("GATED");
  });
  it("says none when a side is empty rather than leaving a hole", () => {
    expect(place("open-gmail").match(/GATED/g)).toHaveLength(1);
  });
});

describe("per-row busy and error", () => {
  it("names the refusal on the account that was refused, in the daemon's words", () => {
    const html = place("open-refused");
    expect(html).toContain("Gmail refused.");
    expect(html).toContain("recipient is not an address: ap@");
    expect(html).toContain('role="alert"');
  });
  it("a refusal on one account is not shown on another", () => {
    expect(draw("flow-failed", { root: "accounts", item: "gmail" })).not.toContain("Notion refused.");
    expect(draw("flow-failed", { root: "accounts", item: "notion" })).toContain("Notion refused.");
  });
  it("disables a switch while the row is busy, with the word", () => {
    const html = place("open-heavy-notion");
    expect(html).toContain("saving…");
    expect(html).toMatch(/aria-label="Notion switch" aria-disabled="true"/);
  });
});

describe("unreadable, unreachable and waiting for the daemon", () => {
  it("says the daemon is not running, and draws no accounts", () => {
    const html = draw("degraded");
    expect(html).toContain("Athena&#x27;s daemon is not running, so the vault cannot be asked.");
    expect(html).toContain("daemon_offline");
    expect(html).not.toContain('class="reach"');
  });
  it("says the list could not be read, who refused it, and the reason verbatim", () => {
    const daemon = draw("unreadable");
    expect(daemon).toContain("The connector list could not be read.");
    expect(daemon).toContain("unknown_ref: no route for GET /connectors");
    expect(daemon).toContain("The daemon refused the list; the reason above is its own.");
    const client = draw("unreachable");
    expect(client).toContain("Illegal invocation");
    expect(client).toContain("The request never reached the daemon");
    expect(client).not.toContain("The daemon refused the list");
  });
  it("is not an empty field when the list is unreadable", () => {
    expect(draw("unreadable")).not.toContain("The daemon lists no connectors.");
  });
  it("says an unknown account is not found instead of crashing", () => {
    const html = place("unknown-account");
    expect(html).toContain("No such account");
    expect(html).toContain("Back to the accounts");
  });
});

describe("the allow-list level", () => {
  it("lists every entry with a Remove that names it, and a draft box with Add", () => {
    const html = place("allowlist-notion");
    expect(html).toContain("Allowed page ids");
    for (const id of ["0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"]) {
      expect(html).toContain(`>${id}</code>`);
      expect(html).toContain(`aria-label="Remove ${id}"`);
    }
    expect(html).toContain(">Add<");
    expect(html).toContain("A draft until you press Add");
    expect(html).toContain("3 allowed. A write to anything else is refused.");
  });
  it("says so when the list is empty, and that every write is refused", () => {
    const html = place("allowlist-empty");
    expect(html).toContain("None yet, so every write is refused. One page id per line.");
  });
  it("is locked, with the reason, until the account is connected", () => {
    const html = place("allowlist-gmail-locked");
    expect(html).toContain("Connect Gmail first; the switches apply to the account you connect.");
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });
  it("is offered from the account, announcing a truncated peek", () => {
    expect(place("open-notion")).toContain("Edit the page ids");
    expect(place("open-gmail")).toContain("Edit the recipients");
    expect(place("open-heavy-gmail")).toContain("(showing 3 of 5)");
  });
  it("has a way back", () => {
    expect(place("allowlist-notion")).toContain("Back to Notion");
  });
});

describe("the scene's own rules", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(path.join(dir, "accounts.css"), "utf8");
  const source = readFileSync(path.join(dir, "view.tsx"), "utf8");

  it("uses no literal colour", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
  it("sets no text under 12px", () => {
    for (const m of css.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)) {
      const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
      expect(px, m[0]).toBeGreaterThanOrEqual(12);
    }
  });
  it("animates only transform and opacity, with no filter and no frame callback", () => {
    expect(css).not.toMatch(/filter\s*:|backdrop-filter|animation:[^;]*(width|height|top|left)/);
    expect(source).not.toMatch(/requestAnimationFrame|setInterval/);
  });
  it("lets the consent ring breathe in and out rather than snap back from its widest each cycle", () => {
    // From scale 0.7 at full opacity to 1.25 at 0.35 and then a jump straight back: a visible
    // pop every 1.6s for as long as the consent page is open. `alternate` plays the way back.
    const pulse = css.slice(css.indexOf(".consent__pulse {"), css.indexOf("}", css.indexOf(".consent__pulse {")));
    expect(pulse).toMatch(/animation:\s*consent-pulse\b[^;]*\binfinite\b[^;]*\balternate\b|animation:\s*consent-pulse\b[^;]*\balternate\b[^;]*\binfinite\b/);
  });
  it("eases the connect rail's steps as they pass, with no rule that styles nothing", () => {
    const step = css.slice(css.indexOf(".stages__step {"), css.indexOf("}", css.indexOf(".stages__step {")));
    expect(step).toMatch(/transition:[^;]*border-color var\(--duration-fast\)/);
    expect(css).not.toMatch(/content:\s*none/);
    expect(css).not.toMatch(/transition:\s*all/);
  });
  it("holds no store, no fetch and no Tauri: a view is a function of its model", () => {
    expect(source).not.toMatch(/@\/stores|@tauri-apps|fetch\(/);
  });
  it("renders the same markup twice from the same model", () => {
    const a = renderToStaticMarkup(<AccountsView model={fixtures.typical!} path={ROOT} go={noGo} />);
    const b = renderToStaticMarkup(<AccountsView model={fixtures.typical!} path={ROOT} go={noGo} />);
    expect(a.replace(/field-«[^»]*»/g, "")).toBe(b.replace(/field-«[^»]*»/g, ""));
  });
});
