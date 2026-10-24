/** The Devices level's states — ADR 0140 (UX/UI spec: every state renders), ADR 0139 words. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DevicesLevel from "./devices";
import { DEVICES_NOW, PATHS, deviceFixtures, fixtures } from "./fixtures";
import MindView from "./view";

const html = (fixture: string) => renderToStaticMarkup(<DevicesLevel model={deviceFixtures[fixture]!} />);

describe("every state renders", () => {
  for (const id of Object.keys(deviceFixtures)) {
    it(id, () => {
      expect(html(id).length).toBeGreaterThan(0);
    });
  }

  it("inside the Mind level, under its own name", () => {
    const h = renderToStaticMarkup(
      <MindView model={fixtures.typical!} path={PATHS.devices!} go={() => {}} devices={deviceFixtures.typical!} />,
    );
    expect(h).toContain(">Devices<");
    expect(h).toContain("Your other computers");
  });
});

describe("loading and failing", () => {
  it("says it is reading, and says it could not read, as two different facts", () => {
    expect(html("loading")).toContain("Reading the devices");
    const failed = html("unreadable");
    expect(failed).toContain("could not read");
    expect(failed).toContain("the daemon did not answer");
    expect(failed).not.toContain("No other device is paired yet");
  });
});

describe("this computer", () => {
  it("names the private network's state in plain words", () => {
    expect(html("empty")).toContain("Private network: Not set up");
    expect(html("signed-out")).toContain("Private network: Signed out");
    expect(html("typical")).toContain("Private network: Ready");
  });
});

describe("the phone", () => {
  it("is off by default, and with the beacon on shows the address and the code to open on the phone", () => {
    expect(html("empty")).toContain('role="switch" aria-checked="false"');
    const on = html("beacon-on");
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("http://100.64.0.7:17491/m/#claim=pair_0000000000c1.abc");
    expect(on).toContain("7Q4-K2P");
  });
});

describe("a pending request", () => {
  it("cannot be approved in its first moment, with the reason said", () => {
    const fresh = html("pending-new");
    expect(fresh).toContain("Kitchen phone asks to be let in");
    expect(fresh).toContain("Approve wakes in a moment");
    expect(fresh).not.toContain('data-armed="1"');
  });

  it("arms after the delay", () => {
    const armed = html("pending-armed");
    expect(armed).toContain('data-armed="1"');
    expect(armed).not.toContain("Approve wakes in a moment");
  });

  it("offers only what was asked, each ticked", () => {
    const h = html("pending-armed");
    expect(h.match(/role="checkbox" aria-checked="true"/g)).toHaveLength(2);
    expect(h).toContain("talk to Athena here");
    expect(h).toContain("answer approvals");
    expect(h).not.toContain(">share memory<");
  });

  it("is an empty state when nothing waits", () => {
    expect(html("typical")).toContain("No requests");
  });
});

describe("the peers", () => {
  it("lists each with its grants, last seen and memory, a missing memory as a dash", () => {
    const h = html("typical");
    expect(h).toContain("Laptop");
    expect(h).toContain("talk to Athena here, answer approvals, share memory");
    expect(h).toContain("2 min ago");
    expect(h).toContain("ok, 42 pulled");
    expect(h).toContain(">-<");
    expect(h).toContain("never");
    expect(h.match(/>Revoke</g)).toHaveLength(2);
  });

  it("gives each computer, and no phone, a box to send a message, with what came back", () => {
    const h = html("typical");
    expect(h).toContain("Send a message to Laptop");
    expect(h).not.toContain("Send a message to Kitchen phone");
    expect(h).toContain("Two invoices are due on Friday.");
  });

  it("says a sleeping computer under its box", () => {
    expect(html("peer-offline")).toContain("Athena on Laptop is asleep");
  });

  it("is an empty table sentence when nothing is paired", () => {
    expect(html("empty")).toContain("No other device is paired yet");
  });
});

describe("set up with Athena", () => {
  it("is shown, disabled with its reason, until the setup conversation is wired", () => {
    expect(html("empty")).toContain("Coming next");
  });

  it("is a live button once it is", () => {
    const model = { ...deviceFixtures.empty!, setup: () => {} };
    expect(renderToStaticMarkup(<DevicesLevel model={model} />)).not.toContain("Coming next");
  });
});

describe("the seams to the setup conversation (WP5)", () => {
  const phoneWindow = {
    ok: true,
    pairing_id: "pair_0000000000f1",
    code: "7Q4K2P",
    url: "http://100.64.0.7:17491/m/#claim=pair_0000000000f1.n",
    expires_at: "2026-10-24T12:05:00Z",
  };

  it("shows the code and the address of a window Athena opened, beacon on or not", () => {
    const base = deviceFixtures.empty!;
    const model = { ...base, state: { ...base.state, opened: { phone: phoneWindow, pc: { ...phoneWindow, url: null } } } };
    const out = renderToStaticMarkup(<DevicesLevel model={model} />);
    expect(out).toContain(phoneWindow.url);
    expect(out).toContain("7Q4K2P");
  });

  it("offers the private network's computers as the join form's address, phones and offline ones left out", () => {
    const base = deviceFixtures.empty!;
    const overlay = {
      ok: true,
      state: "up" as const,
      self_ip: "100.64.0.9",
      peers: [
        { name: "study", ip: "100.101.7.8", os: "windows", online: true },
        { name: "pixel", ip: "100.101.7.9", os: "android", online: true },
        { name: "attic", ip: "100.101.7.10", os: "linux", online: false },
      ],
      showing: 3,
      total: 25,
      footer: "(showing 3 of 25)",
    };
    const out = renderToStaticMarkup(<DevicesLevel model={{ ...base, state: { ...base.state, overlay } }} />);
    expect(out).toContain("study (100.101.7.8)");
    expect(out).not.toContain("pixel");
    expect(out).not.toContain("attic");
    expect(out).toContain("(showing 3 of 25)");
    // Not read (an older daemon): the field is there to type in, and no pick list.
    expect(html("empty")).not.toContain("On your private network:");
  });

  it("says why the setup conversation did not open, under its button", () => {
    const base = deviceFixtures.empty!;
    const model = { ...base, setup: () => {}, state: { ...base.state, errors: { setup: "Athena is not running here yet." } } };
    expect(renderToStaticMarkup(<DevicesLevel model={model} />)).toContain("Athena is not running here yet.");
  });
});

it("reads the fixtures' fixed clock", () => {
  expect(deviceFixtures.typical!.now).toBe(DEVICES_NOW);
});
