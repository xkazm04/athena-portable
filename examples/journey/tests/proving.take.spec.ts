/**
 * docs/demo.md section 5 ("proving" segment) — a live, small, hosted Gauntlet, on camera.
 *
 * The recorder boots `python -m athena.proving.server --hosted` itself (`src/proving.ts`), opens its
 * trigger page and plays the script's `proving` acts beat by beat, exactly as the take plays the
 * journey: a beat's actions fire, and the beat is held for `max(clip, settle) + breath`. What is new
 * is the cue. A live run is not paced by the film, so a beat with `cue` first waits for that event
 * to show on the page — `first_call` for the first call line the event stream delivers, `end` for
 * the run's end line — and the time spent waiting is written to `take/proving.take.json` as a
 * speed-up range. Compose plays those ranges faster and labels them; every beat is real time.
 *
 * It spends money: a `small` hosted Gauntlet is cents of Nemotron and no Claude (ADR 0039), under
 * the server's own daily caps. So it never runs from a bare `playwright test`, only when named:
 *
 *   JOURNEY_SCRIPT=script/proving.en.json pnpm exec playwright test tests/proving.take.spec.ts
 *
 * The judge token is minted per take and never printed; the page's token field is a password
 * field, so the video shows dots. A run that does not start (no key, cap spent, busy) fails the
 * beat with the page's own message and the take carries on, as the journey take does, and fails
 * at the end with every broken beat named.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { startProving, stopProving, type ProvingServer } from "../src/proving.ts";
import {
  TAKE_DIR,
  actsOf,
  captionOf,
  holdMsOf,
  loadDurations,
  loadScript,
  scriptPath,
  type Beat,
} from "../src/script.ts";
import { MIN_SPEEDUP_MS, writeSegmentTake, type Mark, type Speedup } from "../src/segment-take.ts";

const WIDTH = 1440;
const HEIGHT = 900;
const VIDEO = join(TAKE_DIR, "proving.webm");
const OFFSETS = join(TAKE_DIR, "proving.take.json");
/** How long a cue may take. A small hosted Gauntlet ends in minutes; this is the ceiling. */
const CUE_TIMEOUT_MS = Number(process.env.PROVING_CUE_TIMEOUT_MS ?? 15 * 60 * 1000);

const script = loadScript();
const durations = loadDurations(script);
const acts = actsOf(script, "proving");

test.skip(acts.length === 0, `${scriptPath()} has no proving acts`);

/** The cues a beat may wait on, as page conditions. The page is the only witness the film has. */
const CUES: Record<string, string> = {
  started: "#feed .ln.sys",
  first_call: "#feed .ln.call:not(.err)",
  end: "#feed .ln.end",
};

async function perform(page: Page, server: ProvingServer, step: string): Promise<void> {
  const [verb, ...rest] = step.split(":");
  const arg = rest.join(":");
  if (verb === "goto") {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.locator("#status-pills .pill").first().waitFor();
  } else if (verb === "scroll") {
    await page.locator(arg).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  } else if (verb === "fill-token") {
    await page.locator("#token").scrollIntoViewIfNeeded();
    await page.locator("#token").pressSequentially(server.token, { delay: 18 });
  } else if (verb === "pick") {
    const [name, value] = arg.split("=");
    await page.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
  } else if (verb === "start") {
    const answer = page.waitForResponse((r) => r.url().endsWith("/runs") && r.request().method() === "POST");
    await page.locator("#start").click();
    const response = await answer;
    if (!response.ok()) {
      throw new Error(`the run did not start: HTTP ${response.status()} ${(await page.locator("#start-msg").textContent()) ?? ""}`);
    }
  } else {
    throw new Error(`unknown proving step: ${step}`);
  }
}

test(`the proving segment: ${acts.flatMap((a) => a.beats).length} beats, paced on the live run`, async ({ browser }) => {
  test.setTimeout(CUE_TIMEOUT_MS * 2 + 5 * 60 * 1000);
  mkdirSync(TAKE_DIR, { recursive: true });
  const server = await startProving((line) => console.log(`[proving] ${line}`));
  const marks: Mark[] = [];
  const speedups: Speedup[] = [];
  const notes: string[] = [];
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: TAKE_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  const contextAt = Date.now();
  const page = await context.newPage();
  try {
    for (const act of acts) {
      const factor = act.speedup ?? 4;
      for (const beat of act.beats as readonly Beat[]) {
        let error: string | undefined;
        if (beat.cue !== undefined) {
          const selector = CUES[beat.cue];
          const waitedFrom = Date.now();
          try {
            if (selector === undefined) throw new Error(`unknown cue ${beat.cue}`);
            await page.locator(selector).first().waitFor({ timeout: CUE_TIMEOUT_MS });
          } catch (caught) {
            error = `cue ${beat.cue}: ${(caught as Error).message.split("\n")[0]}`;
          }
          const waited = Date.now() - waitedFrom;
          if (waited >= MIN_SPEEDUP_MS) {
            speedups.push({ start_ms: waitedFrom - contextAt, end_ms: Date.now() - contextAt, factor, waiting_for: beat.cue });
          }
          console.log(`cue ${beat.cue}: ${(waited / 1000).toFixed(1)} s`);
        }
        const startedAt = Date.now();
        if (error === undefined) {
          try {
            for (const step of beat.do ?? []) await perform(page, server, step);
          } catch (caught) {
            error = (caught as Error).message.split("\n")[0];
          }
        }
        if (error !== undefined) console.error(`beat ${beat.id} failed: ${error}`);
        const remaining = holdMsOf(beat, script, durations) - (Date.now() - startedAt);
        if (remaining > 0) await page.waitForTimeout(remaining);
        marks.push({
          id: beat.id,
          start_ms: startedAt - contextAt,
          end_ms: Date.now() - contextAt,
          caption: captionOf(beat),
          ...(error === undefined ? {} : { error }),
        });
      }
    }
    const end = page.locator(CUES.end ?? "").first();
    if (await end.count()) notes.push(`end line: ${(await end.textContent()) ?? ""}`);
    notes.push(`tally: ${(await page.locator("#tally").textContent()) ?? ""}`);
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      await video.saveAs(VIDEO);
      rmSync(await video.path(), { force: true });
    }
    writeSegmentTake(OFFSETS, {
      segment: "proving",
      video: "proving.webm",
      width: WIDTH,
      height: HEIGHT,
      script: scriptPath(),
      video_offset_uncertainty_ms: 300,
      beats: marks,
      speedups,
      notes,
    });
    await stopProving(server);
  }
  console.log(`proving: ${VIDEO}\noffsets: ${OFFSETS}\n${notes.join("\n")}`);
  const broken = marks.filter((mark) => mark.error !== undefined);
  expect(broken.map((mark) => `${mark.id}: ${mark.error ?? ""}`).join("\n"), `${broken.length} beat(s) errored`).toBe("");
});
