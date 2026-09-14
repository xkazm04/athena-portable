"use client";

/**
 * `sharedIdentity()` as a hook — one claimant per shared id (formula §1 rule 2).
 *
 * The rule, the evidence from all three round-1 apps, and why the key has to flip are in
 * `./identity.ts`. The short version, because it is the thing people get wrong:
 *
 *   · a `layoutId` claimed by two mounted elements animates NEITHER;
 *   · motion reads `layoutId` when the element MOUNTS and never again, so an id that arrives
 *     later is never registered and the morph silently never plays.
 *
 * Hence both halves in one call:
 *
 *     const box = useSharedIdentity(`table-${ident}`, settled);
 *     <motion.div key={box.key} layoutId={box.layoutId} … />
 *
 * The `key` goes on the same element the `layoutId` does. If that element is inside a `.map()`,
 * this key replaces the list key — it already contains the id.
 */
import { useMemo } from "react";

import { sharedIdentity, type SharedIdentity } from "./identity";

export function useSharedIdentity(id: string, owns: boolean): SharedIdentity {
  return useMemo(() => sharedIdentity(id, owns), [id, owns]);
}
