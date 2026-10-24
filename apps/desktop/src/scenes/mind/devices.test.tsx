/**
 * @vitest-environment jsdom
 *
 * The Devices level's states — ADR 0140 (UX/UI spec: every state renders), ADR 0139 words,
 * fleet-surfaces WP3 (the constellation, its drawer, and the wizard that grows from a '+' node).
 *
 * Most of it is a static render of a fixture, opened where a person would have clicked; the last
 * block drives the real tree, for what a static render cannot show: the press that mints a phone's
 * window, Escape folding the wizard back into its node with the focus returned, Tab kept inside,
 * and an approval moving the wizard on to Done. The QR encoder is WP2's and is faked here, so these
 * tests prove the drawing and its fallback, not the encoding (`qr.test.ts` holds that).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADD_SPOT, SKY, orbitSpots, skyNodes } from "./constellation";
import DevicesLevel, { joinPicks, type DevicesModel, type DevicesOpening } from "./devices";
import { DEVICES_NOW, PATHS, deviceFixtures, fixtures } from "./fixtures";
import MindView from "./view";
import { groupCode, wizardStep } from "./wizard";

vi.mock("./qr", () => ({
  // A stand-in matrix: 21 modules, a diagonal weave. Too long a text is refused as the real one is.
  qrMatrix: (text: string) => {
    if (text.length > 200) throw new RangeError("too long for version 10");
    return Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x + y) % 3 === 0));
  },
}));

const render = (model: DevicesModel, opening?: DevicesOpening) => renderToStaticMarkup(<DevicesLevel model={model} opening={opening} />);
const html = (fixture: string, opening?: DevicesOpening) => render(deviceFixtures[fixture]!, opening);
const count = (h: string, needle: string) => h.split(needle).length - 1;

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
    expect(h).toContain("Your devices, around this computer");
  });

  it("no Mind level says its drawing is a stylised one any more", () => {
    for (const item of ["engine", "brain", "look", "data", "mic", "devices"]) {
      const h = renderToStaticMarkup(
        <MindView model={fixtures.typical!} path={{ root: "mind", item }} go={() => {}} devices={deviceFixtures.typical!} />,
      );
      expect(h, item).not.toContain("Stylised drawing");
      expect(h, item).not.toContain("mind__stylised");
    }
  });
});

describe("loading and failing", () => {
  it("says it is reading, and says it could not read, as two different facts", () => {
    expect(html("loading")).toContain("Reading the devices");
    const failed = html("unreadable");
    expect(failed).toContain("could not read");
    expect(failed).toContain("the daemon did not answer");
    expect(failed).not.toContain('class="sky"');
  });

  it("keeps the drawing when a later read fails, with the problem above it", () => {
    const base = deviceFixtures.typical!;
    const h = render({ ...base, state: { ...base.state, problem: "the daemon did not answer" } });
    expect(h).toContain("may be out of date");
    expect(h).toContain("Read again");
    expect(h).toContain('class="sky"');
  });
});

describe("the constellation", () => {
  it("alone: this computer at the centre, the two '+' nodes, and one sentence inviting to pair", () => {
    const h = html("empty");
    expect(h).toContain("cnode--self");
    expect(h).toContain("Study PC");
    expect(count(h, "cnode cnode--add")).toBe(2);
    expect(h).toContain("+ phone");
    expect(h).toContain("+ PC");
    expect(h).toContain("Only this computer so far");
    expect(h).not.toContain("cnode--peer");
    expect(h).not.toContain("sky__legend");
  });

  it("draws each peer with its presence: lit, dim, broken, or not checked", () => {
    const h = html("typical");
    expect(h).not.toContain("Only this computer so far");
    for (const presence of ["online", "asleep", "unreachable", "none"]) {
      expect(count(h, `data-presence="${presence}"`), presence).toBe(1);
    }
    // The lines: one flowing for the online one, a broken one in two pieces for the one out of reach.
    expect(count(h, "sky__flow")).toBe(1);
    expect(h).toMatch(/data-state="unreachable"><line[^>]*><\/line><line/);
    // Each node says it in its accessible name, and in its caption.
    expect(h).toContain('aria-label="Laptop, computer, online. Show its details."');
    expect(h).toContain("Studio PC, computer, asleep · seen 2 h ago.");
    expect(h).toContain("Attic tower, computer, out of reach · seen 2 d ago.");
    expect(h).toContain("Kitchen phone, phone, not seen yet.");
    expect(h).toContain("Memory synced 1 min ago");
    expect(h).toContain("sky__legend");
  });

  it("says the private network's state at the centre, in plain words", () => {
    expect(html("empty")).toContain("network not set up");
    expect(html("signed-out")).toContain("network signed out");
    expect(html("typical")).toContain("network ready");
  });

  it("puts a waiting request on the orbit as a pulsing node that wants to join", () => {
    const h = html("pending-new");
    expect(h).toContain("cnode cnode--pending");
    expect(h).toContain("wants to join");
    expect(h).toContain('aria-label="Kitchen phone, a phone, wants to join. Answer it."');
    expect(h).toContain('class="sky__link" data-state="pending"');
  });

  it("draws a computer this one asked to join as a dotted node", () => {
    const h = html("typical");
    expect(h).toContain("cnode cnode--joining");
    expect(h).toContain("Office PC");
    expect(h).toContain("asked to join it");
  });

  it("places the nodes by a stable order, one alone at the top of the orbit", () => {
    expect(orbitSpots(1)).toEqual([{ x: SKY.cx, y: SKY.cy - SKY.ry }]);
    expect(orbitSpots(3)).toEqual(orbitSpots(3));
    const view = deviceFixtures.typical!.state.view!;
    const reversed = { ...view, peers: [...view.peers].reverse() };
    expect(skyNodes(reversed).map((n) => n.key)).toEqual(skyNodes(view).map((n) => n.key));
    expect(skyNodes(view).map((n) => n.role)).toEqual(["peer", "peer", "peer", "peer", "joining"]);
    // The '+' nodes sit below the centre, in the gap the arc leaves.
    expect(ADD_SPOT.phone.y).toBeGreaterThan(SKY.cy);
    expect(ADD_SPOT.pc.y).toBeGreaterThan(SKY.cy);
  });

  it("says the same in a list a screen reader reads, one item per node", () => {
    const h = html("typical");
    const list = h.slice(h.indexOf('class="devices__sr"'), h.indexOf("</ul>", h.indexOf('class="devices__sr"')));
    expect(count(list, "<li>")).toBe(1 + 4 + 1);
    expect(list).toContain("Laptop: computer, online. May talk to Athena here, answer approvals, share memory.");
  });

  it("is never the phone's pairing address, even with a window open", () => {
    expect(html("beacon-on")).not.toContain("claim=");
  });
});

describe("a node's drawer", () => {
  it("for a computer: kind, presence and when, last seen, grants, memory, its message box and Revoke", () => {
    const h = html("typical", { selected: "dev_0000000000a2" });
    expect(h).toContain('class="cdrawer"');
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain(">Computer<");
    expect(h).toContain(">Online<");
    expect(h).toMatch(/checked (just now|1 min ago)/);
    expect(h).toContain("2 min ago");
    expect(h).toContain("talk to Athena here, answer approvals, share memory");
    expect(h).toContain("ok, 42 pulled");
    expect(h).toContain("Send a message to Laptop");
    expect(h).toContain("Two invoices are due on Friday.");
    expect(count(h, ">Revoke<")).toBe(1);
  });

  it("for a phone: never probed, no memory, no message box", () => {
    const h = html("typical", { selected: "dev_0000000000a3" });
    expect(h).toContain("Not probed (a phone)");
    expect(h).toContain(">-<");
    expect(h).toContain("never");
    expect(h).not.toContain("Send a message to Kitchen phone");
  });

  it("says a sleeping computer under its box", () => {
    expect(html("peer-offline", { selected: "dev_0000000000a2" })).toContain("Athena on Laptop is asleep");
  });

  it("for this computer: its name to rename, the private network, and the phone's switch", () => {
    const off = html("empty", { selected: "self" });
    expect(off).toContain("Its name");
    expect(off).toContain(">Rename<");
    expect(off).toContain("Private network: Not set up");
    expect(off).toContain('role="switch" aria-checked="false"');
    expect(html("signed-out", { selected: "self" })).toContain("Private network: Signed out");
    const on = html("beacon-on", { selected: "self" });
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("Listening at 100.64.0.7:17491");
  });

  it("for a request: the approve card, which cannot be approved in its first moment", () => {
    const fresh = html("pending-new", { selected: "pair_0000000000b1" });
    expect(fresh).toContain("Kitchen phone asks to be let in");
    expect(fresh).toContain("Approve wakes in a moment");
    expect(fresh).not.toContain('data-armed="1"');
    const armed = html("pending-armed", { selected: "pair_0000000000b1" });
    expect(armed).toContain('data-armed="1"');
    expect(armed).not.toContain("Approve wakes in a moment");
    // Only what was asked, each ticked: grants narrow, never widen.
    expect(armed.match(/role="checkbox" aria-checked="true"/g)).toHaveLength(2);
    expect(armed).not.toContain(">share memory<");
  });

  it("for this computer's own ask: where it stands", () => {
    expect(html("typical", { selected: "pair_0000000000e1" })).toContain("waiting for the person there to approve");
  });

  it("is not there for a node that went away", () => {
    expect(html("typical", { selected: "dev_gone" })).not.toContain('class="cdrawer"');
  });
});

describe("the wizard: a phone", () => {
  it("scans: the QR, the code in two halves, and the ring at three minutes of five", () => {
    const h = html("pairing-phone", { wizard: "phone" });
    expect(h).toContain('role="dialog"');
    expect(h).toContain('data-step="code"');
    expect(h).toContain('<svg class="qr"');
    expect(h).toContain('aria-label="The QR code that pairs your phone"');
    expect(h).toContain("7Q4-K2P");
    expect(h).toContain('class="lens"');
    expect(h).toContain('stroke-dasharray="60.00 100"');
    expect(h).toContain("3:00 left");
    expect(h).toMatch(/aria-current="step"[^>]*>.*?Scan/);
    // The sky dims behind it and takes no focus.
    expect(h).toMatch(/class="sky" data-dim="1"[^>]*inert/);
    // It grows from the '+ phone' node.
    expect(h).toMatch(/transform-origin:\s*36\.\d+% 8\d\.\d+%/);
  });

  it("puts the address, a claim credential, on its one line and nowhere else", () => {
    const h = html("pairing-phone", { wizard: "phone" });
    const url = deviceFixtures["pairing-phone"]!.state.opened.phone!.url!;
    expect(count(h, url)).toBe(1);
    expect(h).toContain(`<code class="cwizard__url">${url}</code>`);
    for (const m of h.matchAll(/(title|aria-label|aria-description|alt)="([^"]*)"/g)) {
      expect(m[2], m[0]).not.toContain("claim=");
    }
  });

  it("shows the code alone when the encoder cannot draw the address", () => {
    const base = deviceFixtures["pairing-phone"]!;
    const phone = { ...base.state.opened.phone!, url: `http://100.64.0.7:17491/m/#claim=${"x".repeat(240)}` };
    const h = render({ ...base, state: { ...base.state, opened: { phone } } }, { wizard: "phone" });
    expect(h).not.toContain('<svg class="qr"');
    expect(h).toContain('<span class="lens__code">7Q4-K2P</span>');
    expect(h).toContain("The picture cannot be drawn here");
  });

  it("greys out when the window ran out, and offers a new code", () => {
    const h = html("pairing-expired", { wizard: "phone" });
    expect(h).toContain('data-expired="1"');
    expect(h).toContain("This code ran out.");
    expect(h).toContain(">New code<");
    // A dead window's address is not offered any more.
    expect(h).not.toContain("claim=");
  });

  it("offers to show a code when none is open (after a reload, say)", () => {
    const h = html("empty", { wizard: "phone" });
    expect(h).toContain(">Show a code<");
    expect(h).not.toContain('<svg class="qr"');
  });

  it("says why there is no address when the listener cannot bind", () => {
    const base = deviceFixtures["pairing-phone"]!;
    const phone = { ...base.state.opened.phone!, url: null };
    const h = render({ ...base, state: { ...base.state, opened: { phone } } }, { wizard: "phone" });
    expect(h).toContain("cannot listen for the phone");
    expect(h).toContain("7Q4-K2P");
  });

  it("moves on to Approve by itself when the phone asks", () => {
    const h = html("pairing-requested", { wizard: "phone" });
    expect(h).toContain('data-step="approve"');
    expect(h).toContain("Kitchen phone wants to join");
    expect(h).toMatch(/aria-current="step"[^>]*>.*?Approve/);
    expect(h).toContain('data-armed="1"');
  });
});

describe("the wizard: a computer", () => {
  it("starts with the choice of which side shows the code", () => {
    const h = html("typical", { wizard: "pc" });
    expect(h).toContain('data-step="choose"');
    expect(h).toContain("Show a code on this PC");
    expect(h).toContain("Join another PC");
  });

  it("shows this computer's code and address, with the same ring", () => {
    const h = html("pairing-pc", { wizard: "pc", branch: "show" });
    expect(h).toContain('data-step="code"');
    expect(h).toContain("M7K-Q2X");
    expect(h).toContain("100.64.0.7");
    expect(h).toContain('stroke-dasharray="80.00 100"');
  });

  it("joins: the private network's computers to pick from, phones and offline ones left out", () => {
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
    const h = render({ ...base, state: { ...base.state, overlay } }, { wizard: "pc", branch: "join" });
    expect(h).toContain('data-step="join"');
    expect(h).toContain('role="grid"');
    expect(h).toContain(">study<");
    expect(h).toContain("100.101.7.8");
    expect(h).not.toContain("pixel");
    expect(h).not.toContain("attic");
    expect(h).toContain("(showing 3 of 25)");
    expect(h).toContain(">Ask to join<");
    // Not read (an older daemon): the address is typed, and there is no pick list.
    expect(html("empty", { wizard: "pc", branch: "join" })).not.toContain('role="grid"');
    expect(joinPicks(null)).toEqual({ rows: [], footer: "" });
  });

  it("moves on to Approve when the computer it joined asks back", () => {
    const base = deviceFixtures.typical!;
    const view = base.state.view!;
    const back = { pairing_id: "pair_0000000000f9", name: "Office PC", kind: "pc" as const, requested_grants: ["chat" as const], expires_at: "2026-10-24T12:10:00Z", pair_back: true };
    const model = { ...base, state: { ...base.state, view: { ...view, pending: [back] } } };
    const h = render(model, { wizard: "pc", branch: "join" });
    expect(h).toContain('data-step="approve"');
    expect(h).toContain("Office PC, which this computer joined, asks to be let in here too");
  });
});

describe("the wizard's step is read from the mirror", () => {
  const state = deviceFixtures["pairing-requested"]!.state;
  it("is Done once the answered request has left the list", () => {
    const answered = { pairingId: "pair_0000000000c1", name: "Kitchen phone", choice: "approve" as const };
    expect(wizardStep("phone", null, state, answered).step).toBe("approve");
    const gone = { ...state, view: { ...state.view!, pending: [] } };
    expect(wizardStep("phone", null, gone, answered)).toEqual({ step: "done", pending: null });
    expect(wizardStep("phone", null, gone, null).step).toBe("code");
  });

  it("reads a code as two halves, and leaves anything else as it is", () => {
    expect(groupCode("7Q4K2P")).toBe("7Q4-K2P");
    expect(groupCode("7Q4-K2P")).toBe("7Q4-K2P");
  });
});

describe("set up with Athena", () => {
  it("is shown, disabled with its reason, until the setup conversation is wired", () => {
    expect(html("empty")).toContain("Coming next");
  });

  it("is a live button once it is", () => {
    expect(render({ ...deviceFixtures.empty!, setup: () => {} })).not.toContain("Coming next");
  });

  it("says why the setup conversation did not open, under its button", () => {
    const base = deviceFixtures.empty!;
    const model = { ...base, setup: () => {}, state: { ...base.state, errors: { setup: "Athena is not running here yet." } } };
    expect(render(model)).toContain("Athena is not running here yet.");
  });
});

it("reads the fixtures' fixed clock", () => {
  expect(deviceFixtures.typical!.now).toBe(DEVICES_NOW);
});

// -- driven -------------------------------------------------------------------------------------

describe("driven", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function withSpies(model: DevicesModel) {
    const actions = { ...model.actions, openPairing: vi.fn(async () => {}), answer: vi.fn(async () => {}) };
    return { ...model, actions };
  }
  const show = (model: DevicesModel) => act(() => root.render(<DevicesLevel model={model} />));
  const byLabel = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label^="${label}"]`)!;
  const press = (el: Element) => act(() => (el as HTMLElement).click());
  const key = (el: Element, k: string, shift = false) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
    });

  it("'+ phone' opens the wizard and asks for a window; Escape folds it back, the focus on the node", () => {
    const model = withSpies(deviceFixtures.empty!);
    show(model);
    press(byLabel("Add a phone"));
    expect(model.actions.openPairing).toHaveBeenCalledWith("phone");
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(host.querySelector(".sky")!.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.id).toBe("cwizard-title");

    key(dialog, "Escape");
    expect(dialog.getAttribute("data-closing")).toBe("1");
    act(() => {
      dialog.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".sky")!.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(byLabel("Add a phone"));
  });

  it("does not mint a second window while the first is live", () => {
    const model = withSpies(deviceFixtures["pairing-phone"]!);
    // The fixture's clock is in the past of the real one: give the window a far end.
    const phone = { ...model.state.opened.phone!, expires_at: "2999-01-01T00:00:00Z" };
    show({ ...model, state: { ...model.state, opened: { phone } } });
    press(byLabel("Add a phone"));
    expect(model.actions.openPairing).not.toHaveBeenCalled();
    expect(host.querySelector("svg.qr")).not.toBeNull();
  });

  it("keeps Tab inside the wizard", () => {
    show(withSpies(deviceFixtures.typical!));
    press(byLabel("Add a computer"));
    const dialog = host.querySelector('[role="dialog"]')!;
    const stops = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const last = stops[stops.length - 1]!;
    act(() => last.focus());
    key(dialog, "Tab");
    expect(document.activeElement).toBe(stops[0]);
    key(dialog, "Tab", true);
    expect(document.activeElement).toBe(last);
  });

  it("a computer's choice to show a code asks for a window", () => {
    const model = withSpies(deviceFixtures.typical!);
    show(model);
    press(byLabel("Add a computer"));
    const tile = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show a code on this PC"))!;
    press(tile);
    expect(model.actions.openPairing).toHaveBeenCalledWith("pc");
  });

  it("approving in the wizard moves it to Done once the request leaves the list", () => {
    const base = withSpies(deviceFixtures["pairing-requested"]!);
    show(base);
    press(byLabel("Add a phone"));
    const approve = [...host.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    press(approve);
    expect(base.actions.answer).toHaveBeenCalledWith("pair_0000000000c1", "approve");
    const after = { ...base, state: { ...base.state, view: { ...base.state.view!, pending: [] } } };
    show(after);
    expect(host.querySelector('[role="dialog"]')!.getAttribute("data-step")).toBe("done");
    expect(host.textContent).toContain("Kitchen phone is in");
  });

  it("a node opens its drawer and a second press closes it", () => {
    show(withSpies(deviceFixtures.typical!));
    press(byLabel("Laptop"));
    expect(host.querySelector(".cdrawer")).not.toBeNull();
    press(byLabel("Laptop"));
    expect(host.querySelector(".cdrawer")).toBeNull();
  });
});
