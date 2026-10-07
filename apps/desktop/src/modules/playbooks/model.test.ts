/**
 * The replay's pure helpers — README section 14; ADR 0040. A bench run's trace is grouped into
 * portal visits for the rail, each turn coloured by what it did, and the money tallied as it plays.
 */
import { expect, test } from "vitest";

import type { TraceTurn } from "@/lib/playbooks";

import { foundBy, readsOf, turnState, visitsOf } from "./model";

const turn = (portal: string, over: Partial<TraceTurn> = {}): TraceTurn => ({
  portal,
  user: "",
  continued: false,
  said: "",
  saidChars: 0,
  reads: [],
  cards: [],
  ...over,
});

test("consecutive turns in one portal are one visit; a return is a new one", () => {
  const visits = visitsOf([turn("A"), turn("A"), turn("B"), turn("A")]);
  expect(visits).toEqual([
    { portal: "A", from: 0, to: 1 },
    { portal: "B", from: 2, to: 2 },
    { portal: "A", from: 3, to: 3 },
  ]);
  expect(visitsOf([])).toEqual([]);
});

test("a turn is coloured by its worst card, then by whether it read", () => {
  const card = (outcome: TraceTurn["cards"][number]["outcome"]) => ({
    action: "file",
    key: "K",
    outcome,
    valueUsd: 10,
  });
  expect(turnState(turn("A", { cards: [card("correct"), card("trap")] }))).toBe("wrong");
  expect(turnState(turn("A", { cards: [card("neutral")] }))).toBe("filed");
  expect(turnState(turn("A", { reads: ["list"] }))).toBe("read");
  expect(turnState(turn("A"))).toBe("spoke");
});

test("the tally counts right cards only, up to the turn shown", () => {
  const trace = [
    turn("A", { cards: [{ action: "f", key: "1", outcome: "correct", valueUsd: 75 }] }),
    turn("A", { cards: [{ action: "f", key: "2", outcome: "trap", valueUsd: 40 }] }),
    turn("B", { cards: [{ action: "f", key: "3", outcome: "correct", valueUsd: 0.1 }] }),
  ];
  expect(foundBy(trace, 0)).toBe(75);
  expect(foundBy(trace, 1)).toBe(75);
  expect(foundBy(trace, 2)).toBe(75.1);
});

test("reads are named in words, each once with its count", () => {
  expect(readsOf(turn("A", { reads: ["list_stops", "search_mail", "list_stops"] }))).toEqual([
    { name: "list stops", times: 2 },
    { name: "search mail", times: 1 },
  ]);
});
