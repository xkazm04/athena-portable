"use client";

/**
 * The masthead: whose pipeline this is, what is in it, and one orienting line.
 *
 * THE HEADLINE WAS INK AND IS NOW STATE. It was "Every score points at the sentence that earned
 * it." — a slogan, set at the largest size on the surface, on a board whose actual state (two
 * roles, forty applicants, six still arguable) was printed nowhere above the fold. The headline
 * states now, and the slogan survives as the deck under it, which is the ONE orienting line
 * DESIGN-LAW §4.1 allows the surface.
 *
 * THE PRESENCE LINE IS GONE, and it went with the toolbar rather than on its own. The surface no
 * longer addresses a reader who is about to connect an agent or drive the view by hand: Athena
 * works the page from beside it, through the tools `components/board/tools/` registers, so a line
 * reporting whether she is bridged was chrome for a person who is not the audience. §4.1 and
 * §9.13 required it and no longer do — DESIGN-LAW §4.1 is amended in the same commit, because a
 * law nobody follows is worse than a law that changed.
 *
 * The claim it carried is not lost. `components/board/shell/Foot.tsx` counts the same register
 * from `components/board/register.ts` and shows it behind the foot's disclosure, which is where
 * §7.4 wanted the manifest in the first place.
 *
 * NO LINKS. There used to be two, "The shipped design" at `/` and "All directions" at `/v`, and
 * they resolved to the same place. The index is gone and the board is the root route, so there is
 * nowhere else to be and the masthead does not pretend there is.
 */
import { STUDIO } from "@athena/demo-kit/seed";

export function BoardMast({
  totals,
}: {
  totals: { roles: number; applicants: number; scored: number; borderline: number };
}) {
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
    </header>
  );
}
