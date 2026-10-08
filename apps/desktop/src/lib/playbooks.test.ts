/**
 * The playbook reader — README section 14; ADR 0040. The shipped set is read from the repository's
 * `playbooks/` directory, the same files the Python bench reads, so these tests also pin that the
 * glob reaches them.
 */
import { expect, test } from "vitest";

import {
  PLAYBOOKS,
  loadPlaybooks,
  minutes,
  onTheEdge,
  parsePlaybook,
  speedup,
  usd,
} from "./playbooks";

test("the shipped playbooks are bundled, each with its edge and economics", () => {
  expect(PLAYBOOKS.length).toBeGreaterThan(0);
  for (const p of PLAYBOOKS) {
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.command.length).toBeGreaterThan(0);
    expect(p.edge.difficulty).toBeGreaterThanOrEqual(1);
    expect(p.economics.sources.every((s) => s.url.startsWith("https://"))).toBe(true);
  }
});

test("a playbook with a bench reads its score; one without says nothing measured", () => {
  const raw = { id: "x", title: "X", edge: { difficulty: 4, usefulness: 5 } };
  expect(parsePlaybook(raw)?.bench).toBeNull();
  const benched = parsePlaybook(raw, {
    run_at: "2026-10-07T00:00:00Z",
    wall_s: 120,
    cost_usd: 1.5,
    verdict: { word: "exceeds", reasons: [] },
    score: { eligible: 2, found: 2, value_total_usd: 10, value_found_usd: 10, false_claims: 0 },
    cards: [{ action: "file", key: "A", outcome: "correct", value_usd: 5 }, { outcome: "nonsense" }],
  });
  expect(benched?.bench?.found).toBe(2);
  expect(benched?.bench?.cards.map((c) => c.outcome)).toEqual(["correct", "other"]);
  expect(benched !== null && onTheEdge(benched)).toBe(true);
});

test("a playbook without an id is dropped, and the order is hardest-and-most-useful first", () => {
  const list = loadPlaybooks(
    {
      "a/playbook.json": { default: { id: "low", title: "Low", edge: { difficulty: 2, usefulness: 2 } } },
      "b/playbook.json": { default: { id: "high", title: "High", edge: { difficulty: 5, usefulness: 4 } } },
      "c/playbook.json": { default: { title: "No id" } },
    },
    { "b/bench.json": { default: { verdict: { word: "meets" } } } },
  );
  expect(list.map((p) => p.id)).toEqual(["high", "low"]);
  expect(list[0].bench?.verdict.word).toBe("meets");
  expect(list[1].bench).toBeNull();
});

test("money, minutes and speed read the way a person says them", () => {
  expect(usd(359.78)).toBe("$359.78");
  expect(usd(4940.5)).toBe("$4,941");
  expect(usd(34.99)).toBe("$34.99");
  expect(usd(5000)).toBe("$5,000");
  expect(minutes(2)).toBe("2 min");
  expect(minutes(300)).toBe("5 h");
  expect(minutes(0.25)).toBe("15 s");
  expect(speedup(300, 2)).toBe("150× faster");
  expect(speedup(45, 27)).toBe("1.7× faster");
  expect(speedup(0, 2)).toBe("");
});
