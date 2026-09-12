import { Board } from "@/components/board/Board";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

/*
 * The one direction, at the root.
 *
 * It used to be `/v/board`, with `/` redirecting to `/v`, a direction index listing the
 * directions a review had left. One direction survived, so the index listed one row and the root
 * was two hops from the only page this app has — a section vocabulary with two names for one
 * place, which is the failure `test/nav.test.ts` was written about. The index and its route are
 * gone; the board IS the app.
 *
 * DESIGN-LAW §8: real seeded data through `lib/queries.ts`, read in a server component, no mock
 * array anywhere. One read, one prop: every level's data is in the payload before the first
 * frame, because a direction whose claim is a seamless zoom cannot fetch on the way in.
 */
export default function BoardPage() {
  return <Board board={buildBoard()} />;
}
