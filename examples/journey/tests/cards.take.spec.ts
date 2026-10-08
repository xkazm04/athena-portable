/**
 * docs/demo.md section 5 ("card" segment) — every title and chapter card of the script, on camera.
 *
 * One context, one page, one video, exactly as the take: each `card` act's beats are set on the
 * page in script order and held for `max(clip, settle) + breath`, and their offsets land in
 * `take/cards.take.json`. Compose cuts each act's stretch out of the one video, so a card that is
 * the film's third act and a card that is its fifth are both here, in order, with nothing between.
 *
 * Run it with `JOURNEY_SCRIPT=script/proving.en.json pnpm exec playwright test tests/cards.take.spec.ts`.
 * `CARDS_ONLY=T1,R5` renders just those beats — a look at one card costs seconds, not a film.
 */
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { cardPage } from "../src/card-page.ts";
import { TAKE_DIR, captionOf, holdMsOf, loadDurations, loadScript, scriptPath, segmentBeatsOf } from "../src/script.ts";
import { writeSegmentTake, type Mark } from "../src/segment-take.ts";

const WIDTH = 1440;
const HEIGHT = 900;
const VIDEO = join(TAKE_DIR, "cards.webm");
const OFFSETS = join(TAKE_DIR, "cards.take.json");

const script = loadScript();
const durations = loadDurations(script);
const only = new Set((process.env.CARDS_ONLY ?? "").split(",").map((id) => id.trim()).filter(Boolean));
const beats = segmentBeatsOf(script, "card").filter((beat) => only.size === 0 || only.has(beat.id));

test.skip(beats.length === 0, `${scriptPath()} has no card beats${only.size ? ` named ${[...only].join(",")}` : ""}`);

test(`cards: ${beats.length} card beat(s), held at the pace of the narration`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  mkdirSync(TAKE_DIR, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: TAKE_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  const contextAt = Date.now();
  const page = await context.newPage();
  // The first frame of a Playwright video is white until a document paints; a dark blank first
  // keeps the head of the segment from flashing when compose cuts into it.
  await page.setContent(`<!doctype html><body style="margin:0;background:#0b0e14"></body>`);
  const marks: Mark[] = [];
  for (const beat of beats) {
    const startedAt = Date.now();
    await page.setContent(cardPage(beat.card ?? { kicker: "", title: beat.line }));
    const remaining = holdMsOf(beat, script, durations) - (Date.now() - startedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    marks.push({ id: beat.id, start_ms: startedAt - contextAt, end_ms: Date.now() - contextAt, caption: captionOf(beat) });
  }
  const video = page.video();
  await context.close();
  if (video) {
    await video.saveAs(VIDEO);
    rmSync(await video.path(), { force: true });
  }
  writeSegmentTake(OFFSETS, {
    segment: "card",
    video: "cards.webm",
    width: WIDTH,
    height: HEIGHT,
    script: scriptPath(),
    video_offset_uncertainty_ms: 300,
    beats: marks,
    speedups: [],
  });
  console.log(`cards: ${VIDEO}\noffsets: ${OFFSETS}`);
  expect(marks.length).toBe(beats.length);
});
