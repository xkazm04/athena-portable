/**
 * The end-to-end suites, which are not the unit run — README section 3.5.
 *
 * `pnpm test` is 137 hermetic tests in a few seconds and must stay that way: it is what a person
 * runs before every commit, and a suite that spawns a Python daemon is not something to put in
 * front of that. So these have their own config, their own `include`, and their own script
 * (`pnpm test:e2e`). Nothing here is picked up by the default run — `vite.config.ts` includes
 * `src/**` only.
 *
 * `fileParallelism: false` because every file in here owns a daemon and a port. They are
 * ephemeral ports, so two files racing would not collide on a socket; they would collide on the
 * machine, and a suite that is slow because it is honest is better than one that is flaky because
 * it is eager.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(app, "src") },
  },
  test: {
    environment: "node",
    root: app,
    include: ["e2e/**/*.e2e.test.ts"],
    // A daemon spawn goes through `uv run`, which resolves an environment before Python starts.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    fileParallelism: false,
    pool: "forks",
    reporters: ["default"],
  },
});
