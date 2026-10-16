/**
 * @vitest-environment jsdom
 *
 * Her surface, mounted — ADR 0026, README sections 3.1 and 3.5.
 *
 * What `views.test.tsx`'s static markup cannot prove: what survives a re-render. A screen reader
 * voices a change inside a live region it is already watching, and a region mounted with its text
 * already in it is silent on most readers (accessibility, live-region-architecture), so the
 * region must be the same element from one sentence to the next.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";

import { fixtures } from "./fixtures";
import type { CompanionModel } from "./model";
import CompanionView from "./views";

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
