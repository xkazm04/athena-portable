/**
 * The answer `read_pairs` hands an agent: a head of the open merge queue that fits the door (design 4.6.4).
 *
 * Every pair carries its matching evidence, so fifty of them run past the kit's
 * `MAX_RESULT_CHARS`. The door then cuts the JSON mid-row and appends a notice, the caller's
 * parse falls back to a string, and the queue it asked for (the read the merge and resolve
 * tools depend on) arrives as text nobody can read. So the page is sized to the cap here, and
 * the footer counts what the answer carries, not what was asked for: `showing` pairs out of
 * `total` open, and the difference is what is still in the queue.
 */
import { fitted } from "@athena/demo-kit/webmcp";

import type { MergePair } from "@/lib/types";

export interface PairsAnswer {
  pairs: MergePair[];
  showing: number;
  total: number;
  footer: string;
}

export function pairsAnswer(pairs: readonly MergePair[], total: number): PairsAnswer {
  return fitted(pairs.length, (n) => ({
    pairs: pairs.slice(0, n),
    showing: n,
    total,
    footer: `(showing ${n} of ${total})`,
  }));
}
