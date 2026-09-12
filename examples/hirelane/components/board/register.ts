/**
 * The capability register, counted once, where every part of the shell can read it.
 *
 * The masthead's presence line and the foot's capability line are the same claim said twice — how
 * many acts this route offers an agent and how many of them reach a person — so they read one
 * derivation rather than two. `CAPABILITIES` is the union the route actually mounts
 * (`lib/manifest.ts`); `isAuto` is the manifest's own rule, so the class is computed and never
 * typed.
 */
import { CAPABILITIES, isAuto } from "@/lib/manifest";

export const REGISTER = CAPABILITIES.map((c) => ({ name: c.name, auto: isAuto(c) }));

export const CAPABILITY_COUNTS = {
  all: REGISTER.length,
  auto: REGISTER.filter((t) => t.auto).length,
  gated: REGISTER.filter((t) => !t.auto).length,
};
