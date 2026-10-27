/**
 * @vitest-environment jsdom
 *
 * Her surface, mounted — ADR 0026, README sections 3.1 and 3.5.
 *
 * What `views.test.tsx`'s static markup cannot prove: what survives a re-render. A screen reader
 * voices a change inside a live region it is already watching, and a region mounted with its text
 * already in it is silent on most readers (accessibility, live-region-architecture), so the
 * region must be the same element from one sentence to the next. And a card's capture belongs to
 * that card: while the next card's is read, the last one's picture is not shown under its id.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { CaptureRead } from "./capture";
import type { CompanionModel } from "./model";

/** Each read waits until the test answers it, by capture id. */
const reads = new Map<string, (read: CaptureRead) => void>();
vi.mock("./capture", () => ({
  readCapture: (id: string) => new Promise<CaptureRead>((done) => reads.set(id, done)),
}));

const { fixtures } = await import("./fixtures");
const { default: CompanionView } = await import("./views");

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

function show(model: CompanionModel): void {
  act(() => root.render(createElement(CompanionView, { model })));
}

const region = () => host.querySelector<HTMLElement>('[role="status"][aria-live="polite"].aw-sr');

test("what she says is written into the one live region she started with, so it is voiced", () => {
  const base = fixtures.seal();
  show({ ...base, say: { n: 1, text: "A decision is waiting on you. Press A to approve, D to decline." } });
  const first = region();
  expect(first).not.toBeNull();
  show({ ...base, say: { n: 2, text: "Sending your answer." } });
  // The same element, watched since it mounted: the new sentence is a change inside it.
  expect(region()).toBe(first);
  expect(first!.textContent).toBe("Sending your answer.");
});

test("the same sentence said twice is a change inside the region, not a string left as it was", () => {
  const base = fixtures.seal();
  const text = "The decision is still waiting. Open her again when you are ready.";
  show({ ...base, say: { n: 1, text } });
  const said = region()!.firstChild;
  show({ ...base, say: { n: 2, text } });
  expect(region()!.textContent).toBe(text);
  // A new node with the same words: a reader hears it again, where an unchanged string is dropped.
  expect(region()!.firstChild).not.toBe(said);
});

test("while the next card's capture is read, the last card's picture is not shown under the new id (ADR 0066)", async () => {
  const base = fixtures.slip();
  const onCard = (id: string, capture: string): CompanionModel => ({
    ...base,
    cards: [{ ...base.cards[0], id, capture: { kind: "shot", id: capture } }],
  });
  show(onCard("apr_a", "cap_a"));
  await act(async () => reads.get("cap_a")!({ src: "data:image/png;base64,AAAA", problem: null }));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  // The first card left (it expired, or was answered elsewhere) and the next one is on the slip.
  show(onCard("apr_b", "cap_b"));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("Reading the capture…");
  await act(async () => reads.get("cap_b")!({ src: "data:image/png;base64,BBBB", problem: null }));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,BBBB");
  expect(host.textContent).toContain("page capture cap_b");
});

test("flipping a decision card moves focus to the face turned toward the person, and back (a11y)", () => {
  show(fixtures.slip());
  const press = (act_: string) => act(() => host.querySelector<HTMLButtonElement>(`[data-act="${act_}"]`)!.click());
  const front = () => host.querySelector(".sl-front")!;
  const back = () => host.querySelector(".sl-back")!;
  host.querySelector<HTMLButtonElement>('[data-act="read"]')!.focus();
  press("read");
  expect(document.activeElement?.getAttribute("data-act")).toBe("front");
  expect(front().hasAttribute("inert")).toBe(true);
  expect(front().getAttribute("aria-hidden")).toBe("true");
  expect(back().hasAttribute("inert")).toBe(false);
  press("front");
  expect(document.activeElement?.getAttribute("data-act")).toBe("read");
  expect(front().hasAttribute("inert")).toBe(false);
  expect(back().hasAttribute("inert")).toBe(true);
});
