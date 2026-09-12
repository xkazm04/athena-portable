"use client";

/**
 * The masthead: whose pipeline this is, one headline, and one honest sentence.
 *
 * The long orienting paragraph that used to sit here is gone. DESIGN-LAW §4.1
 * allows the surface one orienting line, and the h1 already IS that line —
 * saying the same thing again in grey under it cost sixty pixels of a board
 * that had none to spare.
 *
 * NO LINKS. There used to be two, "The shipped design" at `/` and "All
 * directions" at `/v`, and they resolved to the same place; then there was one,
 * pointing at a direction index listing a single direction. The index is gone
 * and the board is the root route, so there is nowhere else to be and the
 * masthead does not pretend there is. A section vocabulary with two names for
 * one place is the failure mode `test/nav.test.ts` exists to catch.
 *
 * The studio's name is the one thing added: these are `Halden Studio`'s two
 * open roles, the same studio whose books and contacts the sibling tabs hold,
 * and the same name that signs every message this app sends.
 */
import { STUDIO } from "@athena/demo-kit/seed";

export function BoardMast() {
  return (
    <header className="bd-mast">
      <div className="bd-mast-id">
        <p className="bd-block-label">
          {STUDIO.name} / hiring — {STUDIO.owner.name}, {STUDIO.owner.title}
        </p>
        <h1 className="bd-title">Every score points at the sentence that earned it.</h1>
      </div>
      <p className="bd-honesty">
        Athena is not connected yet. Every capability below is registered and waiting.
      </p>
    </header>
  );
}
