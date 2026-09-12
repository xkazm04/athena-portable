import { Lanes } from "@/components/lanes/Lanes";
import { buildBooks, buildSheet } from "@/lib/lanes";

export const dynamic = "force-dynamic";

/*
 * The one design, at the root.
 *
 * It used to be `/v/lanes`, with the Strip at `/` and a direction index at `/v` listing what a
 * review had left standing. One design survived — the same generation as Hirelane's Board and
 * TidyCRM's Blocks — so the index listed rows nobody could reach any other way and the root was
 * two hops from the only page the app has. The index and the Strip's routes are gone; the Lanes
 * IS the app.
 *
 * ONE SERVER READ, TWO PROPS. The sheet is the picture and the books are the ledger the tool
 * layer answers from, both built from the same request. A direction whose whole claim is a
 * seamless zoom cannot fetch on the way in, and a tool that has to fetch before it can answer is
 * a tool an agent waits on.
 */
export default function LedgerboxPage() {
  return <Lanes sheet={buildSheet()} books={buildBooks()} />;
}
