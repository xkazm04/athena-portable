/**
 * The Chores view with the running app's Adopt deps — README section 3.5, ADR 0089, 0097 and 0098.
 *
 * The lazy chunk `live.tsx` fetches when the depth is entered: the pure view, handed the client
 * over the daemon and the dictation the Adopt studio uses, the front door's client beside it, and
 * Athena's composer for a custom verdict. Kept out of `live.tsx` so neither the clients nor the
 * voice module join the first paint.
 */
import { useMemo } from "react";

import { athenaOffer } from "@/lib/companion";
import { IntakeApi } from "@/lib/intake-client";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useSpaces } from "@/stores/spaces";

import { liveAdoptDeps } from "./adopt/live-deps";
import type { ChoreSpaces } from "./topic";
import ChoresView, { type ChoresViewProps } from "./view";

const deps = { ...liveAdoptDeps(), intake: new IntakeApi(() => endpoint(useDaemon.getState())) };

const offer = (text: string) => athenaOffer(text);

export default function LiveChoresView(props: Omit<ChoresViewProps, "adopt" | "offer" | "spaces">) {
  // The Projects, for each case's chip and link (ADR 0225): the store's list and its `linkCase`.
  const list = useSpaces((s) => s.spaces);
  const link = useSpaces((s) => s.linkCase);
  const spaces = useMemo<ChoreSpaces>(() => ({ list, link }), [list, link]);
  return <ChoresView {...props} adopt={deps} offer={offer} spaces={spaces} />;
}
