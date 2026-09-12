/**
 * README section 1 — the setup both runs of the journey share.
 *
 * There are two ways to play the four acts now: `tests/journey.spec.ts` asserts them as fast as
 * the apps answer, and `tests/take.spec.ts` plays the same beats on camera at the pace of the
 * narration (docs/demo.md section 1). Everything that is the *same* in both — what the studio's
 * notes page is called, what "every tool but these is AUTO" means, how a beat waits for a page
 * that is still moving — lives here, so the take cannot drift into asserting something softer
 * than the journey does.
 *
 * Nothing here knows about the camera. The strip, the script and the pacing are the take's
 * (`src/strip.ts`, `src/script.ts`), and this file is what both of them stand on.
 */
import { expect } from "@playwright/test";

import type { AppSpec } from "./apps.ts";
import type { Surface } from "./surface.ts";

/** The Notion page the studio keeps its weekly record on — the only parent a write may reach. */
export const STUDIO_NOTES = "page_studio";

/**
 * Re-read until the page has caught up with a write, or give up and let the assertion fail.
 *
 * These applications answer their read tools from what the page is currently showing rather than
 * from a fresh query — which is the right design for a page whose tools are its own interface, and
 * means a write needs a render before the next read reflects it. An agent that re-reads
 * immediately sees the state before its own call.
 *
 * So: bounded retries, and the *last* answer is the one returned, so a genuine failure still
 * reports the real value rather than a timeout with nothing in it.
 */
export async function eventually<T>(
  read: () => Promise<T>,
  settled: (value: T) => boolean,
  attempts = 20,
  intervalMs = 150,
): Promise<T> {
  let last = await read();
  for (let attempt = 0; attempt < attempts && !settled(last); attempt += 1) {
    await new Promise((resume) => setTimeout(resume, intervalMs));
    last = await read();
  }
  return last;
}

/**
 * Exactly the tools this act names are GATED, and everything else the *page* registers is AUTO.
 *
 * The hands are excluded and asserted separately: they are on every surface now, they are the
 * shell's rather than the page's, and README section 3.3 holds them to a different rule.
 */
export function assertClasses(surface: Surface, app: AppSpec): void {
  const own = surface.names().filter((name) => !surface.isHand(name));
  expect(own.length, `${app.id} registered tools`).toBeGreaterThan(0);
  expect(own.filter((name) => surface.classOf(name) === "GATED").sort()).toEqual([...app.gated].sort());
  for (const name of own) {
    if (!app.gated.includes(name)) expect(surface.classOf(name), `${name} should be AUTO`).toBe("AUTO");
  }
}

/** The eight hands are on every page, and every one of them is GATED on first sight. */
export function assertHands(surface: Surface): void {
  const hands = surface.names().filter((name) => surface.isHand(name));
  expect(hands.sort()).toEqual([
    "page_click",
    "page_fill",
    "page_find",
    "page_read",
    "page_scroll",
    "page_select",
    "page_submit",
    "page_wait",
  ]);
  // README section 3.3: GATED on first sight for every new origin, whatever the flags imply. Two
  // of these are reads whose flags say AUTO, so this is the override doing its work rather than
  // the derivation agreeing by luck.
  for (const name of hands) {
    expect(surface.classOf(name), `${name} on ${surface.app.id}`).toBe("GATED");
  }
}
