/**
 * The ledger's two axes (ADR 0096): the area a playbook belongs to and the job it does for the
 * person. One list, `playbooks/taxonomy.json`, which the bench's loader validates every playbook
 * against; this module only names it for the desktop.
 */
import taxonomy from "../../../../playbooks/taxonomy.json";

export type CategoryId =
  | "health"
  | "freight"
  | "commerce"
  | "employment"
  | "consumer"
  | "benefits"
  | "housing"
  | "public"
  | "construction"
  | "family";

export type JobId = "recover" | "claim" | "contest" | "comply";

export interface Axis<Id extends string> {
  id: Id;
  label: string;
}

/** In the file's order, which is the rail's. */
export const CATEGORIES = taxonomy.categories as readonly Axis<CategoryId>[];
/** In the file's order, which is the job chips'. */
export const JOBS = taxonomy.jobs as readonly Axis<JobId>[];

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const JOB_IDS = new Set<string>(JOBS.map((j) => j.id));

export const isCategoryId = (v: unknown): v is CategoryId => typeof v === "string" && CATEGORY_IDS.has(v);
export const isJobId = (v: unknown): v is JobId => typeof v === "string" && JOB_IDS.has(v);

export function categoryLabel(id: CategoryId | null): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Uncategorised";
}

export function jobLabel(id: JobId | null): string {
  return JOBS.find((j) => j.id === id)?.label ?? "Unsorted";
}
