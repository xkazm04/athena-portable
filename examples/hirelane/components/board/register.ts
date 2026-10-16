/**
 * The capability register, counted once, where every part of the shell can read it.
 *
 * The foot's capability line and its two class bands are one claim - how many acts this route
 * offers an agent, how many of them reach a person, and what the rest do - so they read one
 * derivation rather than typing it. `CAPABILITIES` is the union the route actually mounts
 * (`lib/manifest.ts`); `isAuto` is the manifest's own rule, so the class is computed and never
 * typed.
 *
 * THE AUTO BAND SAYS WHAT ITS MEMBERS DO, counted. It used to read "Auto — reversible, and each
 * writes an undo" over thirteen tools of which four write anything: the other nine read or move
 * the view and log nothing, because there is nothing to put back. A capability claim a reader
 * trusts and cannot check is the costliest kind of wrong sentence, so the band is built from the
 * same rows as the count above it.
 */
import { CAPABILITIES, isAuto } from "@/lib/manifest";

export const REGISTER = CAPABILITIES.map((c) => ({
  name: c.name,
  auto: isAuto(c),
  /** Writes app data, and so logs an undo when it is AUTO (`app/actions.ts`). */
  writes: c.sideEffects !== "none",
}));

export const CAPABILITY_COUNTS = {
  all: REGISTER.length,
  auto: REGISTER.filter((t) => t.auto).length,
  gated: REGISTER.filter((t) => !t.auto).length,
  /** AUTO tools that only read or move the view. */
  autoReads: REGISTER.filter((t) => t.auto && !t.writes).length,
  /** AUTO tools that write app data, each logging its undo. */
  autoWrites: REGISTER.filter((t) => t.auto && t.writes).length,
};

/** The AUTO band's sentence, from the counts, so it cannot claim more than the rows do. */
export function autoBand(counts: { autoReads: number; autoWrites: number }): string {
  const parts: string[] = [];
  if (counts.autoReads > 0) parts.push(`${counts.autoReads} read or move the view`);
  if (counts.autoWrites > 0) {
    parts.push(
      counts.autoWrites === 1 ? "1 writes, and logs an undo" : `${counts.autoWrites} write, and each logs an undo`,
    );
  }
  return parts.length > 0 ? `Auto — reversible: ${parts.join("; ")}` : "Auto — reversible";
}

export const AUTO_BAND = autoBand(CAPABILITY_COUNTS);
