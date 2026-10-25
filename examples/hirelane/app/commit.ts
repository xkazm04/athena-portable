/**
 * The one door every act on a person goes through to reach the activity log (server-only).
 *
 * An act's row says two things a reader relies on: who ran it, and whether it can be taken back.
 * Both used to be typed at seven call sites in `app/actions.ts` - `actor: "user"` on every one,
 * so an act Athena ran through the same action read as the person's own, and `reversible` by
 * hand beside `lib/manifest.ts`'s `isAuto`, which already decides the same class. Here the actor
 * is checked against the closed set and written once, and the class is the manifest's: an AUTO
 * act must hand over its undo and a GATED one must not, or the transaction it runs in throws and
 * takes the change back with it (ADR 0205).
 *
 * Not a `"use server"` module: nothing here is a POST endpoint, and the actions are the only door.
 */
import "server-only";
import { logActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";

import type { Stage } from "@/lib/constants";
import { isAuto, SHIPPED_CAPABILITIES } from "@/lib/manifest";

/**
 * Who an act is logged as. The agent's handlers pass "athena"; a page leaves it off and is "user".
 * The argument is caller-supplied, so a page could claim to be athena - acceptable in a scratch
 * example host (ADR 0018), where the History band is a courtesy and not an audit. "system" is the
 * seed's, and no act may claim it.
 */
export const ACTORS = ["user", "athena"] as const;
export type Actor = (typeof ACTORS)[number];

/** The refusal for an actor outside the set, or null when it is one of them. */
export function actorRefusal(actor: unknown): string | null {
  return typeof actor === "string" && (ACTORS as readonly string[]).includes(actor)
    ? null
    : `Unknown actor ${JSON.stringify(actor)} - one of ${ACTORS.join(", ")}.`;
}

/** What each reversible act needs to take itself back; `applyUndo` switches over it exhaustively. */
export type Undo =
  | { kind: "note"; noteId: number }
  | { kind: "stage"; applicantId: string; stage: Stage; eventId: number }
  | { kind: "slots"; slotIds: string[] };

/** The acts that write: every shipped capability whose side effects are not `none`. */
type DataCapability = Exclude<(typeof SHIPPED_CAPABILITIES)[number], { sideEffects: "none" }>;
export type ActName = DataCapability["name"];

export interface Act {
  capability: ActName;
  actor: Actor;
  target: string;
  summary: string;
  undo?: Undo;
}

/**
 * Write one act's activity row inside the caller's transaction, refusing a row whose undo
 * disagrees with the manifest's class. Throws, so the enclosing `withTx` writes nothing.
 */
export function commitAct(tx: Db, act: Act): ActivityEntry {
  const capability = SHIPPED_CAPABILITIES.find((c) => c.name === act.capability);
  if (!capability || capability.sideEffects === "none") {
    throw new Error(`${act.capability} is not an act on the capability manifest`);
  }
  const refused = actorRefusal(act.actor);
  if (refused) throw new Error(refused);
  const reversible = isAuto(capability);
  if (reversible && act.undo === undefined) throw new Error(`${act.capability} is AUTO and must log its undo`);
  if (!reversible && act.undo !== undefined) throw new Error(`${act.capability} is GATED and logs no undo`);
  return logActivity(tx, {
    actor: act.actor,
    action: act.capability,
    target: act.target,
    summary: act.summary,
    reversible,
    ...(act.undo === undefined ? {} : { undo: act.undo }),
  });
}
