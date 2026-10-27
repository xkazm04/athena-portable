/**
 * What a featured chore's proofs earn — ADR 0226. Pure, and only the lazy chores depth reads it.
 *
 * `playbook.json` authors a `featured` block (the senses, the spike, the date it was flagged) and
 * `lib/playbooks.ts` keeps it as written. Its standing is never authored: it is earned from the
 * chore's `senses/proofs.json`, by the same rule as the bench's `athena.senses.build.featured_status`.
 * That rule, the senses contract and the proofs themselves live here and not in `lib/playbooks.ts`,
 * because the loader is in Main's first frame (README section 3.1, ADR 0095) and the band is not.
 * The proofs are an eager glob on purpose: a lazy one put a loader per file into that first frame,
 * and a new dynamic import would cost the same; five small files ride in the chores chunk instead.
 */
import type { Playbook } from "@/lib/playbooks";

/** A sense a featured chore reads its world through (`athena.senses.contract.SENSES`). */
export type Sense = "paper" | "call" | "object" | "walk" | "circle";

export const SENSES: readonly Sense[] = ["paper", "call", "object", "walk", "circle"];

/**
 * What a featured chore's proofs earn, computed, never authored: `proven` only when every proof
 * passed on a build where a role ran on one of Meta's models, `rehearsed` when they passed on
 * fixtures or Claude, `failing` when one did not, `unproven` with no proofs at all.
 */
export type FeaturedStatus = "proven" | "rehearsed" | "failing" | "unproven";

export interface Featured {
  /** The senses it uses, in the file's order; a name the contract lacks is dropped. */
  senses: readonly Sense[];
  /** The spike it came from, e.g. "01-paper-flip". */
  spike: string;
  /** When it was flagged, as the file says it ("2026-10-26"). */
  since: string;
  status: FeaturedStatus;
  /** How many of `senses/proofs.json`'s proofs passed, of how many; both 0 without the file. */
  proofs: { passed: number; total: number };
}

/** The backends that run Meta's own models: `athena.senses.contract.META_BACKENDS`. */
const META_BACKENDS: ReadonlySet<string> = new Set(["meta", "muse"]);

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Python's truthiness, so the status rule reads a file exactly as the bench's `featured_status`. */
const truthy = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : isRaw(v) ? Object.keys(v).length > 0 : Boolean(v);

/**
 * The status `senses/proofs.json` earns — the same rule as the bench's
 * `athena.senses.build.featured_status`, on the same truthiness: no file or no proofs is
 * `unproven`, a file that did not pass is `failing`, and a pass is `proven` only when a backend
 * ran on one of Meta's models (`meta`, the API, or `muse`, Muse Code on the plan), `rehearsed`
 * otherwise.
 */
export function featuredStatus(proofs: unknown): FeaturedStatus {
  if (!isRaw(proofs) || !truthy(proofs.proofs)) return "unproven";
  if (!truthy(proofs.passed)) return "failing";
  const backends = isRaw(proofs.backends) ? Object.values(proofs.backends) : [];
  return backends.some((b) => META_BACKENDS.has(String(b))) ? "proven" : "rehearsed";
}

/** An authored `featured` block and its proofs file as the band draws them; `null` without a block. */
export function earnFeatured(block: unknown, proofs: unknown): Featured | null {
  if (!isRaw(block)) return null;
  const rows = isRaw(proofs) && Array.isArray(proofs.proofs) ? proofs.proofs.filter(isRaw) : [];
  const senses = Array.isArray(block.senses) ? block.senses : [];
  return {
    senses: senses.filter((s): s is Sense => (SENSES as readonly unknown[]).includes(s)),
    spike: str(block.spike),
    since: str(block.since),
    status: featuredStatus(proofs),
    proofs: { passed: rows.filter((r) => r.passed === true).length, total: rows.length },
  };
}

/** Each playbook's proofs file, by the playbook's id: its directory, which is its id for every
 *  shipped playbook (`featured.test.tsx` holds that). */
export type ProofsFiles = Readonly<Record<string, unknown>>;

/** `{ "<path>/<id>/senses/proofs.json": module }` keyed by `<id>`, each JSON module unwrapped. */
export function proofsById(glob: Record<string, unknown>): ProofsFiles {
  return Object.fromEntries(
    Object.entries(glob).map(([path, mod]) => [
      /([^/]+)\/senses\/proofs\.json$/.exec(path)?.[1] ?? path,
      isRaw(mod) && "default" in mod ? mod.default : mod,
    ]),
  );
}

/** What this build ships: `athena.senses prove` writes one per featured chore; most have none. */
export const SHIPPED_PROOFS: ProofsFiles = proofsById(
  import.meta.glob("../../../../../playbooks/*/senses/proofs.json", { eager: true }),
);

/** A playbook's featured standing, earned from `files` (the shipped proofs by default). */
export function featuredOf(p: Pick<Playbook, "id" | "featured">, files: ProofsFiles = SHIPPED_PROOFS): Featured | null {
  return earnFeatured(p.featured, files[p.id] ?? null);
}
