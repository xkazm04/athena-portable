/**
 * @vitest-environment jsdom
 *
 * The slip's front, for a card about a record the turn already read: what she read about it (a
 * dispute, how old it is) and when, on the face the person signs, not one level down.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { TranscriptEntry } from "@/stores/run";

import { fixtures } from "./fixtures";
import type { CompanionModel } from "./model";
import { Slip } from "./slip";
import { buildContext } from "./translate";
import { describeDecision } from "./translate/decision";
import data from "./translate/sessions.fixture.json";

const chase = (data as { sessions: { id: string; entries: Omit<TranscriptEntry, "id">[] }[] }).sessions.find((s) => s.id === "chase-overdue")!;
const turn = buildContext(chase.entries.map((e, i) => ({ ...e, id: `c-${i}` })));

function slipAbout(id: string): CompanionModel {
  const base = fixtures.slip();
  const words = describeDecision({ action: "host.ledgerbox.send_reminder", params: { id } }, turn, "", { reversible: false, side_effects: "external" });
  return { ...base, cards: base.cards.map((c, i) => (i === 0 ? { ...c, words } : c)) };
}

const front = (model: CompanionModel) => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(Slip, { model })), "text/html");
  return doc.querySelector(".sl-front")!;
};

test("standing case 5: the front of a card about a disputed invoice shows the dispute and when she read it", () => {
  const note = front(slipAbout("inv_137")).querySelector("[data-standing-note]");
  expect(note).not.toBeNull();
  expect(note!.getAttribute("role")).toBe("note");
  expect(note!.textContent).toContain("Client says the second revision was out of scope.");
  expect(note!.textContent).toContain("As she read it at 09:41: Read the inbox in Ledgerbox");
});

test("standing: a record read without a note shows only the quiet as-of line, and an unread one nothing", () => {
  const plain = front(slipAbout("inv_118"));
  expect(plain.querySelector("[data-standing-note]")).toBeNull();
  expect(plain.querySelector("[data-standing-asof]")?.textContent).toContain("As she read it at 09:41");
  const unread = front(slipAbout("inv_999"));
  expect(unread.querySelector("[data-standing-note], [data-standing-asof]")).toBeNull();
});

test("the back of an unflipped card is inert, so Tab never lands on a button nobody can see", () => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(Slip, { model: fixtures.slip() })), "text/html");
  const back = doc.querySelector(".sl-back")!;
  expect(back.getAttribute("aria-hidden")).toBe("true");
  expect(back.querySelectorAll("button").length).toBeGreaterThan(0);
  expect(back.hasAttribute("inert")).toBe(true);
  expect(doc.querySelector(".sl-front")!.hasAttribute("inert")).toBe(false);
});
