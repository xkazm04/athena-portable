/**
 * The playbook reader — README section 14; ADR 0040. The shipped set is read from the repository's
 * `playbooks/` directory, the same files the Python bench reads, so these tests also pin that the
 * glob reaches them.
 */
import { describe, expect, test } from "vitest";

import { PLAYBOOKS } from "./playbooks.shipped";

import {
  clock,
  evidenceCurrent,
  loadPlaybooks,
  parseEvidence,
  minutes,
  parsePlaybook,
  parseRanking,
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

test("a playbook's evidence is read leniently, beside its bench, and an old thumbnail is not read", () => {
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
    true,
  );
  expect(p.evidence?.narration.text).toBe("X, narrated.");
  expect(p.evidence).not.toHaveProperty("thumbnail");
  expect(p.evidence).not.toHaveProperty("thumbnailUrl");
  expect(p.evidence?.videoUrl).toBe("/evidence/x/evidence.mp4");
  expect(evidenceCurrent(p)).toBe(true);
  // No index: no evidence, and nothing claimed current.
  const [bare] = loadPlaybooks({ [`${dir}playbook.json`]: { id: "x" } }, {});
  expect(bare.evidence).toBeNull();
  expect(evidenceCurrent(bare)).toBe(false);
});

test("a film is a URL only where a dev server serves it, and only under evidence/", () => {
  const raw = { video: { path: "evidence/x/evidence.mp4" } };
  expect(parseEvidence(raw, false)?.videoUrl).toBeNull();
  expect(parseEvidence(raw, true)?.videoUrl).toBe("/evidence/x/evidence.mp4");
  for (const path of ["../secret.mp4", "C:/evidence/x/evidence.mp4", "evidence/../x/evidence.mp4", "playbooks/x/thumb.jpg"]) {
    expect(parseEvidence({ video: { path } }, true)?.videoUrl, path).toBeNull();
  }
  // Garbage reads as empty fields, never as a throw.
  const odd = parseEvidence({ narration: "nope", video: 3 });
  expect(odd?.narration.text).toBe("");
  expect(odd?.video.durationS).toBe(0);
  expect(parseEvidence(null)).toBeNull();
});

test("the shipped evidence names the bench run it shows, and a film only where it has one", () => {
  for (const p of PLAYBOOKS.filter((b) => b.evidence !== null)) {
    expect([1, 2, 3], p.id).toContain(p.evidence?.schema);
    // A still the index lists is a still this build carries.
    for (const s of p.evidence?.story ?? []) expect(s.url, `${p.id}: ${s.caption}`).not.toBe("");
    expect(p.evidence?.benchRunAt, p.id).not.toBe("");
    // Schema 3 (ADR 0137): the drawing and up to four turns; the film is left out until the films pass.
    if (p.evidence?.schema === 3) {
      expect(p.evidence.story.length, p.id).toBeGreaterThanOrEqual(1);
      expect(p.evidence.story.length, p.id).toBeLessThanOrEqual(5);
      expect(p.evidence.story[0], p.id).toMatchObject({ caption: "How it runs", turn: null });
      expect(["", `evidence/${p.id}/evidence.mp4`], p.id).toContain(p.evidence.video.path);
    } else {
      expect(p.evidence?.video.path, p.id).toBe(`evidence/${p.id}/evidence.mp4`);
    }
  }
});

test("a playbook names its area and its job from the taxonomy; a missing or unknown one reads as none", () => {
  const tagged = parsePlaybook({ id: "x", category: "freight", job: "recover" });
  expect(tagged?.category).toBe("freight");
  expect(tagged?.job).toBe("recover");
  const bare = parsePlaybook({ id: "x" });
  expect(bare?.category).toBeNull();
  expect(bare?.job).toBeNull();
  // Unknown or the wrong type: none, and the playbook is still read.
  for (const [category, job] of [["shipping", "refund"], [3, ["recover"]], ["Freight", "RECOVER"]]) {
    const odd = parsePlaybook({ id: "x", title: "X", category, job });
    expect(odd?.title).toBe("X");
    expect(odd?.category).toBeNull();
    expect(odd?.job).toBeNull();
  }
});

describe("the storyboard", () => {
  const dir = "../../../../playbooks/x/";
  const index = (over: Record<string, unknown>) => ({
    schema: 2,
    playbook: "x",
    bench_run_at: "2026-10-07T00:00:00Z",
    video: { path: "evidence/x/evidence.mp4" },
    ...over,
  });
  const load = (evidence: unknown, stories: Record<string, unknown> = {}) =>
    loadPlaybooks(
      { [`${dir}playbook.json`]: { id: "x", title: "X" } },
      {},
      { [`${dir}evidence.json`]: evidence },
      false,
      stories,
    )[0].evidence?.story;

  test("schema 2 reads each still in order, with its bundled URL, caption and turn", () => {
    const story = load(
      index({
        story: [
          { path: "playbooks/x/story/01.webp", caption: "Abstract", turn: null, bytes: 9 },
          { path: "playbooks/x/story/02.webp", caption: "Turn 3 - Portal: find the invoices", turn: 3 },
          { path: "playbooks/x/story/03.webp", caption: "What she filed" },
        ],
      }),
      {
        [`${dir}story/01.webp`]: "/assets/01-x.webp",
        [`${dir}story/02.webp`]: { default: "/assets/02-x.webp" },
        [`${dir}story/03.webp`]: "/assets/03-x.webp",
      },
    );
    expect(story).toEqual([
      { url: "/assets/01-x.webp", caption: "Abstract", turn: null },
      { url: "/assets/02-x.webp", caption: "Turn 3 - Portal: find the invoices", turn: 3 },
      { url: "/assets/03-x.webp", caption: "What she filed", turn: null },
    ]);
  });

  test("a still the build does not carry keeps its row with an empty URL", () => {
    const story = load(index({ story: [{ path: "playbooks/x/story/01.webp", caption: "Abstract" }] }));
    expect(story).toEqual([{ url: "", caption: "Abstract", turn: null }]);
  });

  test("a row with no caption, or a path that is not this playbook's story/NN.webp, is dropped", () => {
    const story = load(
      index({
        story: [
          { path: "playbooks/x/story/01.webp", caption: "" },
          { path: "playbooks/x/story/02.webp" },
          { path: "playbooks/y/story/03.webp", caption: "Another playbook's" },
          { path: "playbooks/x/thumb.jpg", caption: "Not a still" },
          { path: "playbooks/x/story/4.webp", caption: "One digit" },
          { path: "playbooks/x/story/../05.webp", caption: "Climbs out" },
          { path: "/playbooks/x/story/06.webp", caption: "Absolute" },
          "nope",
          { path: "playbooks/x/story/07.webp", caption: "Kept", turn: 0 },
        ],
      }),
    );
    expect(story).toEqual([{ url: "", caption: "Kept", turn: null }]);
  });

  test("schema 3 reads the drawing and the turns, with no film and no thumbnail", () => {
    const story = load(
      {
        schema: 3,
        playbook: "x",
        captured_at: "2026-10-23T12:00:00Z",
        bench_run_at: "2026-10-07T00:00:00Z",
        story: [
          { n: 1, path: "playbooks/x/story/01.webp", caption: "How it runs", kind: "drawing", bytes: 9 },
          { n: 2, path: "playbooks/x/story/02.webp", caption: "Turn 1 - Office: start here", kind: "turn", turn: 1 },
        ],
      },
      { [`${dir}story/01.webp`]: "/assets/01-x.webp", [`${dir}story/02.webp`]: "/assets/02-x.webp" },
    );
    expect(story).toEqual([
      { url: "/assets/01-x.webp", caption: "How it runs", turn: null },
      { url: "/assets/02-x.webp", caption: "Turn 1 - Office: start here", turn: 1 },
    ]);
  });

  test("schema 1, or an index without a story, reads as no storyboard", () => {
    const rows = [{ path: "playbooks/x/story/01.webp", caption: "Abstract" }];
    expect(load(index({ schema: 1, story: rows }))).toEqual([]);
    expect(load(index({}))).toEqual([]);
    expect(load(index({ story: "nope" }))).toEqual([]);
    expect(parseEvidence({ schema: 2, story: rows })?.story).toEqual([{ url: "", caption: "Abstract", turn: null }]);
  });
});

test("a film's length reads as a clock", () => {
  expect(clock(71.4)).toBe("1:11");
  expect(clock(59.6)).toBe("1:00");
  expect(clock(5)).toBe("0:05");
});

describe("the ranking the bench commits (ADR 0056, 0128)", () => {
  const RANKING = {
    schema: 1,
    ranked: [
      {
        rank: 1,
        playbook: "a",
        score: 10.45,
        money: { annual_usd: 10000 },
        minutes: { times_per_year: 12, saved_per_year: 2806.3 },
        bench: { run_at: "T1", runs: { n: 3, exceeds: 3 } },
      },
    ],
    unranked: [{ playbook: "b", why: "short in 2 of 4 comparable runs" }],
  };

  test("parseRanking: a ranked row's place, year and pool, an unranked row's why, and garbage as an empty map", () => {
    const m = parseRanking(RANKING);
    expect(m.get("a")).toEqual({
      position: 1,
      score: 10.45,
      annualUsd: 10000,
      savedMinutesYear: 2806.3,
      runAt: "T1",
      runs: { n: 3, exceeds: 3 },
      unranked: null,
    });
    expect(m.get("b")).toMatchObject({ position: null, unranked: "short in 2 of 4 comparable runs" });
    expect(m.size).toBe(2);
    for (const raw of [null, "x", 3, [], { ranked: "nope" }]) expect(parseRanking(raw).size).toBe(0);
    const nameless = parseRanking({ ranked: [{ rank: 1, playbook: 7 }, "row", { rank: 2 }], unranked: [{ why: "w" }] });
    expect(nameless.size).toBe(0);
  });

  test("loadPlaybooks attaches each rank by id, null where the ranking says nothing or ranks an older run", () => {
    const dir = (id: string) => `../../../../playbooks/${id}/`;
    const show = (id: string) => ({ [`${dir(id)}playbook.json`]: { id, title: id } });
    const bench = (id: string, runAt: string) => ({ [`${dir(id)}bench.json`]: { run_at: runAt, verdict: { word: "exceeds" } } });
    const stale = { ...RANKING, ranked: [...RANKING.ranked, { ...RANKING.ranked[0], playbook: "c", bench: { run_at: "T0" } }] };
    const list = loadPlaybooks(
      { ...show("a"), ...show("b"), ...show("c"), ...show("d") },
      { ...bench("a", "T1"), ...bench("b", "T1"), ...bench("c", "T2"), ...bench("d", "T1") },
      {},
      false,
      {},
      { default: stale },
    );
    const rank = (id: string) => list.find((p) => p.id === id)!.rank;
    expect(rank("a")?.position).toBe(1);
    expect(rank("b")?.unranked).toBe("short in 2 of 4 comparable runs");
    // c's row ranks the run of T0; its bench.json holds the run of T2: an older ranking is not borrowed.
    expect(rank("c")).toBeNull();
    expect(rank("d")).toBeNull();
    // Without a ranking every rank is null, as before the desktop read one.
    expect(loadPlaybooks(show("a"), bench("a", "T1"))[0].rank).toBeNull();
  });

  test("shipped (guard): every ranked playbook's pool is the one the desktop works out from its bench.json", () => {
    const ranked = PLAYBOOKS.filter((p) => p.rank?.position != null);
    expect(ranked.length).toBeGreaterThan(80);
    for (const p of ranked) expect(p.rank!.runs, p.id).toEqual(p.bench!.runs);
  });
});
