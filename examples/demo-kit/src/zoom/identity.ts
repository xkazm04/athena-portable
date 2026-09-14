/**
 * One claimant per shared id — formula §1 rule 2, as a pair of props.
 *
 * THE EVIDENCE, from round 1, in three apps:
 *
 *   · hirelane. Two mounted elements claiming one `layoutId` animates NEITHER: motion has two
 *     claimants for one identity and picks no winner, so the carousel card stopped becoming the
 *     dossier. The rail therefore gives the ids up while the dossier is open (`owns`) and takes
 *     them back when it closes.
 *   · tidycrm. The L1 → L2 morph had silently never played. The cell acquired its `layoutId`
 *     later than its first render, and motion builds a projection node ONCE, during the render
 *     in which the component first appears, reading `layoutId` off the props it had at that
 *     moment (`useVisualElement`'s `createProjectionNode`, whose own source carries a "TODO:
 *     update options in an effect"). An id that arrives later is never registered in the shared
 *     stack, so the dossier that mounts holding the matching id finds nothing to travel from.
 *   · ledgerbox. The outgoing layer renders the same markup with its ids dropped, so the ids
 *     deregister in the same commit the arriving layer claims them — the handoff an unmount
 *     would have given.
 *
 * So the rule has two halves and both are here. `layoutId` is set only when this element is the
 * claimant, AND the `key` changes with ownership so that acquiring or dropping an id is a
 * remount rather than a prop change — which is the only event motion reads a `layoutId` on, and
 * also the event it snapshots a shared identity on (it snapshots when a claimant UNMOUNTS, and
 * that snapshot is what the next claimant grows out of).
 *
 *     const box = sharedIdentity(`candidate-${id}`, owns);
 *     <motion.div key={box.key} layoutId={box.layoutId} />
 *
 * Pure; `test/identity.test.ts` pins the key flip. `useSharedIdentity.ts` is the hook.
 */

export interface SharedIdentity {
  /** The shared id, or `undefined` while another element holds it. */
  layoutId: string | undefined;
  /** Flips with ownership, so the handover is an unmount and a mount in one commit. */
  key: string;
}

/**
 * The suffix an unclaimed element's key carries.
 *
 * A suffix rather than a boolean in the key so the key still names the thing it belongs to in a
 * React devtools tree. The separator is DOUBLED because a single one is the kit's own: `nodeId`
 * joins a group and an item with `:`, so `sharedIdentity("a", false)` and `nodeId("a", "plain")`
 * would otherwise be the same string — and a group row and an item row are siblings on more than
 * one of these surfaces, which is exactly where a duplicate key does damage.
 */
export const UNCLAIMED = "::unclaimed";

export function sharedIdentity(id: string, owns: boolean): SharedIdentity {
  return owns ? { layoutId: id, key: id } : { layoutId: undefined, key: `${id}${UNCLAIMED}` };
}
