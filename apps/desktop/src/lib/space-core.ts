/**
 * Athena's core, in the two words the wire and the depth use — README section 3.5, ADR 0225.
 *
 * Apart from `lib/spaces.ts`, which re-exports both, so a module drawn in the first frame (the run
 * store, the Projects scene's crumb names, the surface's mirror) can name core without carrying
 * the spaces client with it: the first-paint gauge counts every module a first-frame chunk holds
 * (`scripts/first-paint.mjs`, ADR 0095).
 */

/** The active space when none is: Athena's core. Core's absent value is `""`, never `null`. */
export const CORE = "";

/** The depth item that names core (`projects/core`); never a space id. */
export const CORE_ITEM = "core";
