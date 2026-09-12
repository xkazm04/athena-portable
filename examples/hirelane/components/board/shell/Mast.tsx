"use client";

/**
 * The masthead: whose pipeline this is, what is in it, one orienting line, and one honest reading
 * of whether an agent is beside the page.
 *
 * TWO THINGS WERE INK AND ARE NOW STATE.
 *
 * The h1 was "Every score points at the sentence that earned it." — a slogan, set at the largest
 * size on the surface, on a board whose actual state (two roles, forty applicants, six still
 * arguable) was printed nowhere above the fold. The headline states now, and the slogan survives
 * as the deck under it, which is the ONE orienting line DESIGN-LAW §4.1 allows the surface.
 *
 * The presence line was "Athena is not connected yet. Every capability below is registered and
 * waiting." — a sentence with no way to become false, which is exactly what §8 forbids a figure
 * from being. It asks `useAthenaPresence` for the bridge and `CAPABILITY_COUNTS` for the register,
 * so it cannot claim a connection the page does not have or a capability it does not mount.
 *
 * ONE PLACE. The foot's capability line and this one are the same claim, counted in
 * `components/board/register.ts` and rendered twice at two altitudes: the sentence here, the names
 * behind the foot's disclosure.
 *
 * NO LINKS. There used to be two, "The shipped design" at `/` and "All directions" at `/v`, and
 * they resolved to the same place. The index is gone and the board is the root route, so there is
 * nowhere else to be and the masthead does not pretend there is.
 */
import { STUDIO } from "@athena/demo-kit/seed";

import { useAthenaPresence } from "../presence";
import { CAPABILITY_COUNTS } from "../register";

export function BoardMast({
  totals,
}: {
  totals: { roles: number; applicants: number; scored: number; borderline: number };
}) {
  const presence = useAthenaPresence();

  return (
    <header className="bd-mast">
      <div className="bd-mast-id">
        <p className="bd-block-label">
          {STUDIO.name} / hiring — {STUDIO.owner.name}, {STUDIO.owner.title}
        </p>
        <h1 className="bd-title">
          {totals.applicants} applicants, {totals.roles}{" "}
          {totals.roles === 1 ? "open role" : "open roles"},{" "}
          <em>{totals.borderline} still arguable</em>
        </h1>
        <p className="bd-deck">Every score points at the sentence that earned it.</p>
      </div>
      <p className="bd-presence" data-on={presence.bridged}>
        {presence.bridged
          ? `Athena is connected. ${CAPABILITY_COUNTS.auto} capabilities run on their own; ${CAPABILITY_COUNTS.gated} ask first.`
          : `Athena is not connected. All ${CAPABILITY_COUNTS.all} capabilities are registered and waiting — ${CAPABILITY_COUNTS.gated} of them gated.`}
      </p>
    </header>
  );
}
