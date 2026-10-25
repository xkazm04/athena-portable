/** Row shapes shared between server queries and client components. No server imports here. */

/**
 * The record statuses: one list that the `Record_` type, the `records` CHECK constraint
 * (`lib/db.ts`), the `set_record_status` tool's enum and the status buttons (`lib/acts.ts`) all
 * derive from, so adding a status is one edit here rather than four that can disagree.
 */
export const STATUSES = ["open", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export interface Record_ {
  id: string;
  title: string;
  status: Status;
  owner: string;
  updated_at: string;
  note: string;
}
