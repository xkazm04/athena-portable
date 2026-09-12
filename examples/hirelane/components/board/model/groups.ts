/**
 * The group id, and its inverse.
 *
 * A stage in this app is two queues that happen to be at the same point, so the
 * unit worth opening is a (stage, role) pair rather than a column. The kit's
 * navigation model takes one opaque string for a group, so the pair is encoded
 * into it here and taken apart here, and nowhere else.
 */

import type { Stage } from "@/lib/constants";

/**
 * The group id, and its inverse.
 *
 * A stage in this app is two queues that happen to be at the same point, so the
 * unit worth opening is a (stage, role) pair rather than a column. The kit's
 * navigation model takes one opaque string for a group, so the pair is encoded
 * into it here and taken apart here, and nowhere else.
 */
export function groupId(stage: string, roleId: string): string {
  return `${stage}::${roleId}`;
}

export function splitGroup(id: string | null): { stage: Stage | null; roleId: string | null } {
  if (!id) return { stage: null, roleId: null };
  const [stage, roleId] = id.split("::");
  return { stage: (stage as Stage) ?? null, roleId: roleId ?? null };
}
