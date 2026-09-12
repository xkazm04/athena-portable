/**
 * README section 1 — the four acts, run as one ordered journey in one Chromium.
 *
 * One worker and no parallelism, deliberately: the journey is a story, act 3 recalls a fact act 1
 * wrote, and the ledger act 4 prints is the record of the single run. Retries are off for the
 * same reason — a retried act 2 would replay approvals against an app act 1 already changed.
 */
import { defineConfig, devices } from "@playwright/test";

/**
 * The take (`tests/take.spec.ts`, docs/demo.md section 1) is a recording, not a gate.
 *
 * It boots the same three apps and drives the same beats, but it holds every one of them for the
 * length of its narration clip — twenty minutes of wall clock to produce one `.webm`. That has no
 * business in `pnpm test`, so a bare `playwright test` ignores it and only two things bring it
 * back: naming its file on the command line, or `JOURNEY_TAKE=1`. Reading `process.argv` here is
 * what lets `pnpm exec playwright test tests/take.spec.ts` mean what it obviously means, with no
 * second project to keep in step and no environment variable to remember.
 */
const takeWanted =
  process.env.JOURNEY_TAKE === "1" || process.argv.some((argument) => argument.includes("take.spec"));

export default defineConfig({
  testDir: "./tests",
  ...(takeWanted ? {} : { testIgnore: ["**/take.spec.ts"] }),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Booting three Next dev servers cold, then four acts against them.
  timeout: 15 * 60 * 1000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
  },
});
