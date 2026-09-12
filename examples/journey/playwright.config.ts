/**
 * README section 1 — the four acts, run as one ordered journey in one Chromium.
 *
 * One worker and no parallelism, deliberately: the journey is a story, act 3 recalls a fact act 1
 * wrote, and the ledger act 4 prints is the record of the single run. Retries are off for the
 * same reason — a retried act 2 would replay approvals against an app act 1 already changed.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
