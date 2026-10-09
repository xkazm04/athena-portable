/**
 * The playbook reader — README section 14; ADR 0040. The shipped set is read from the repository's
 * `playbooks/` directory, the same files the Python bench reads, so these tests also pin that the
 * glob reaches them.
 */
import { expect, test } from "vitest";

import {
  PLAYBOOKS,
  clock,
  evidenceCurrent,
  loadPlaybooks,
  parseEvidence,
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

test("a playbook's evidence is read leniently, beside its bench, with the thumbnail's URL", () => {
  const dir = "../../../../playbooks/x/";
  const [p] = loadPlaybooks(
    { [`${dir}playbook.json`]: { id: "x", title: "X" } },
    { [`${dir}bench.json`]: { run_at: "2026-10-07T00:00:00Z" } },
    {
      [`${dir}evidence.json`]: {
        default: {
          schema: 1,
          captured_at: "2026-10-09T10:00:00Z",
          bench_run_at: "2026-10-07T00:00:00Z",
          narration: { text: "X, narrated.", engine: "kokoro", voice: "af_heart", duration_s: 71.2 },
          video: { path: "evidence/x/evidence.mp4", bytes: 9, duration_s: 71.2 },
          thumbnail: { path: "playbooks/x/thumb.jpg", bytes: 48000 },
        },
      },
    },
    { [`${dir}thumb.jpg`]: "/assets/thumb-x.jpg" },
    true,
  );
  expect(p.evidence?.narration.text).toBe("X, narrated.");
  expect(p.evidence?.thumbnailUrl).toBe("/assets/thumb-x.jpg");
  expect(p.evidence?.videoUrl).toBe("/evidence/x/evidence.mp4");
  expect(evidenceCurrent(p)).toBe(true);
  // No index: no evidence, and nothing claimed current.
  const [bare] = loadPlaybooks({ [`${dir}playbook.json`]: { id: "x" } }, {});
  expect(bare.evidence).toBeNull();
  expect(evidenceCurrent(bare)).toBe(false);
});

test("a film is a URL only where a dev server serves it, and only under evidence/", () => {
  const raw = { video: { path: "evidence/x/evidence.mp4" } };
  expect(parseEvidence(raw, "", false)?.videoUrl).toBeNull();
  expect(parseEvidence(raw, "", true)?.videoUrl).toBe("/evidence/x/evidence.mp4");
  for (const path of ["../secret.mp4", "C:/evidence/x/evidence.mp4", "evidence/../x/evidence.mp4", "playbooks/x/thumb.jpg"]) {
    expect(parseEvidence({ video: { path } }, "", true)?.videoUrl, path).toBeNull();
  }
  // Garbage reads as empty fields, never as a throw.
  const odd = parseEvidence({ narration: "nope", video: 3 });
  expect(odd?.narration.text).toBe("");
  expect(odd?.video.durationS).toBe(0);
  expect(parseEvidence(null)).toBeNull();
});

test("the shipped evidence names the bench run it filmed and a repo-relative film", () => {
  for (const p of PLAYBOOKS.filter((b) => b.evidence !== null)) {
    expect(p.evidence?.schema, p.id).toBe(1);
    expect(p.evidence?.benchRunAt, p.id).not.toBe("");
    expect(p.evidence?.video.path, p.id).toBe(`evidence/${p.id}/evidence.mp4`);
    expect(p.evidence?.thumbnail.path, p.id).toBe(`playbooks/${p.id}/thumb.jpg`);
    expect(p.evidence?.thumbnailUrl, p.id).not.toBe("");
  }
});

test("a film's length reads as a clock", () => {
  expect(clock(71.4)).toBe("1:11");
  expect(clock(59.6)).toBe("1:00");
  expect(clock(5)).toBe("0:05");
});
