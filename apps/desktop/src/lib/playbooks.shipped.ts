/**
 * The shipped playbooks, read synchronously — README section 3.5. For tests and fixtures only.
 *
 * `lib/playbooks.ts` loads the shipped set lazily because it is about 2.7 MB of JSON. A fixture or a
 * test that needs the real thing at import time reads it here instead, eagerly. Nothing in the
 * running app imports this file, which is what keeps that weight out of the first paint; a test
 * pins it.
 */
import { loadPlaybooks, type Playbook } from "./playbooks";

const SHOWCASES = import.meta.glob("../../../../playbooks/*/playbook.json", { eager: true });
const BENCHES = import.meta.glob("../../../../playbooks/*/bench.json", { eager: true });
const EVIDENCES = import.meta.glob("../../../../playbooks/*/evidence.json", { eager: true });
const STORIES = import.meta.glob<string>("../../../../playbooks/*/story/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

export const PLAYBOOKS: readonly Playbook[] = loadPlaybooks(
  SHOWCASES,
  BENCHES,
  EVIDENCES,
  import.meta.env.DEV,
  STORIES,
);
