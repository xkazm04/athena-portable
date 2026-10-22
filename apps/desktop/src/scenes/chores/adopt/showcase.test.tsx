// @vitest-environment jsdom
/**
 * The showcase claims dollars only where the answer key still holds — ADR 0125.
 *
 * A rehearsal on a world shaped by renames alone shows what it found in dollars; one whose rows or
 * date the shape changed shows no dollar figure, says why, and counts the cards it proposed
 * against the recorded run's.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTrace } from "@/lib/playbooks";

import Showcase from "./showcase";
import type { ShowcaseEvent } from "./state";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const card = (key: string, value: number) => ({
  action: "request_refund",
  key,
  outcome: "correct",
  value_usd: value,
});

const RAW = [
  { portal: "Gmail", user: "Start.", said: "Reading.", reads: [], cards: [] },
  {
    portal: "Delta",
    user: "",
    said: "Filed two.",
    reads: [],
    cards: [card("DL1", 212), card("DL2", 40)],
  },
];

const RECORDED = parseTrace([
  { portal: "Postwren", user: "Start.", said: "Reading.", reads: [], cards: [card("A", 1)] },
]);

const done = (over: Partial<ShowcaseEvent>): ShowcaseEvent => ({
  kind: "adopt.showcase",
  seq: 1,
  status: "done",
  turn: 2,
  total: 2,
  trace: RAW,
  found_usd: null,
  found_reason: "",
  detail: "",
  ...over,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(showcase: ShowcaseEvent) {
  act(() =>
    root.render(
      <Showcase
        recorded={RECORDED}
        portals={{}}
        showcase={showcase}
        onStart={() => {}}
      />,
    ),
  );
}

const text = (sel: string) => host.querySelector(sel)?.textContent ?? "";

describe("the rehearsal's figure", () => {
  it("shows the dollars when the world was shaped by renames alone", () => {
    render(done({ found_usd: 252 }));
    expect(text(".ad-show__label")).toContain(
      "Rehearsal on invented data shaped like your case — nothing was sent",
    );
    expect(text(".ad-show__n")).toBe("$252");
    expect(text(".ad-show__found")).toContain("found in the rehearsal, on invented data");
  });

  it("claims no dollar figure when the shape changed rows or today, and counts cards", () => {
    render(done({ found_usd: null, found_reason: "shaped" }));
    expect(text(".ad-show__label")).toContain(
      "Rehearsal on invented data shaped like your case — nothing was sent",
    );
    const found = text(".ad-show__found");
    expect(text(".ad-show__n")).toBe("2 cards");
    expect(found).toContain("proposed in the rehearsal, against 1 card in the recorded run");
    expect(found).toContain(
      "Your case changed rows the answer key was written for, so no dollar figure is claimed",
    );
    expect(host.textContent).not.toMatch(/\$\d/);
  });

  it("claims no dollar figure even if a shaped event carried one", () => {
    render(done({ found_usd: 252, found_reason: "shaped" }));
    expect(host.textContent).not.toContain("$252");
  });
});
