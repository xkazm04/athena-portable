/**
 * The Chores view with the running app's Adopt deps — README section 3.5, ADR 0089 and 0097.
 *
 * The lazy chunk `live.tsx` fetches when the depth is entered: the pure view, handed the client
 * over the daemon and the dictation the Adopt studio uses. Kept out of `live.tsx` so neither the
 * client nor the voice module joins the first paint.
 */
import { liveAdoptDeps } from "./adopt/live-deps";
import ChoresView, { type ChoresViewProps } from "./view";

const deps = liveAdoptDeps();

export default function LiveChoresView(props: Omit<ChoresViewProps, "adopt">) {
  return <ChoresView {...props} adopt={deps} />;
}
