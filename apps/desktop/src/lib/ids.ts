/**
 * Every id prefix in this system, in TypeScript (README §3.5, the day-zero lessons).
 *
 * This is the second half of `src/athena/contracts/ids.py` and the Python is the authority.
 * `tests/test_ids_parity.py` reads this file as text and fails when the two tables disagree —
 * an import across the language boundary does not exist, so nothing else would.
 *
 * The finding this answers is small and was expensive: the first build minted ids in two modules
 * and each added a prefix, so a conversation for a project came out as `conv_proj_proj_<id>`. The
 * fix is one table and one `mint` per language, plus derived ids built from an already-minted id
 * rather than from a bare slug — so no caller is ever in a position to add a prefix twice.
 *
 * Episode ids carry eight hex digits where every other kind carries twelve, because the brain's
 * markdown stays byte-compatible with the Rust writer whose `short_id(8)` produced them.
 */

/** kind → prefix. Kept a flat object of literals: the Python half is read as text. */
export const ID_PREFIXES = Object.freeze({
  episode: "ep_",
  fact: "fact_",
  procedural: "proc_",
  approval: "apr_",
  turn: "turn_",
  conversation: "conv_",
  project: "proj_",
  capture: "cap_",
  session: "sess_",
  job: "job_",
});

/** kind → how many hex digits `mint` puts after the prefix. */
export const ID_SUFFIX_HEX = Object.freeze({
  episode: 8,
  fact: 12,
  procedural: 12,
  approval: 12,
  turn: 12,
  conversation: 12,
  project: 12,
  capture: 12,
  session: 12,
  job: 12,
});

export type IdKind = keyof typeof ID_PREFIXES;

export const ID_KINDS = Object.freeze(Object.keys(ID_PREFIXES)) as readonly IdKind[];

/**
 * A conversation id is usually *derived* — `conv_<app_id>` or `conv_<project_id>` — so its suffix
 * is a slug or another id rather than hex. Every other kind is minted and only ever hex.
 */
const DERIVED_SUFFIX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function prefixOf(kind: IdKind): string {
  const prefix = ID_PREFIXES[kind];
  if (prefix === undefined) {
    throw new Error(`unknown id kind ${kind}; known kinds: ${ID_KINDS.join(", ")}`);
  }
  return prefix;
}

/** A fresh id of `kind`: its prefix plus a short random hex suffix. */
export function mint(kind: IdKind): string {
  const digits = ID_SUFFIX_HEX[kind];
  const bytes = new Uint8Array(Math.ceil(digits / 2));
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, digits);
  return `${prefixOf(kind)}${hex}`;
}

/**
 * `true` when `value` is an id of `kind`. No prefix in the table is a prefix of another, so this
 * answers for exactly one kind and a `proj_` id is never mistaken for a `proc_` one.
 */
export function isId(kind: IdKind, value: string): boolean {
  const prefix = prefixOf(kind);
  if (!value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  if (kind === "conversation") return DERIVED_SUFFIX.test(suffix);
  return new RegExp(`^[0-9a-f]{${ID_SUFFIX_HEX[kind]}}$`).test(suffix);
}

/** Which kind `value` is, or `null`. Longest prefix first. */
export function kindOf(value: string): IdKind | null {
  const ordered = [...ID_KINDS].sort((a, b) => ID_PREFIXES[b].length - ID_PREFIXES[a].length);
  for (const kind of ordered) {
    if (isId(kind, value)) return kind;
  }
  return null;
}

/** `conv_<app_id>`: the conversation a page's turns share when no project is active. */
export function conversationForApp(appId: string): string {
  const slug = appId.trim().toLowerCase();
  if (!slug || !DERIVED_SUFFIX.test(slug)) {
    throw new Error(`app_id must be a lowercase slug: ${appId}`);
  }
  return `${ID_PREFIXES.conversation}${slug}`;
}

/**
 * `conv_<project_id>` — `conv_proj_<hex>`, with the project's prefix already on it.
 *
 * Takes a minted project id rather than a bare one precisely so that no caller is ever in a
 * position to add `proj_` a second time.
 */
export function conversationForProject(projectId: string): string {
  if (!isId("project", projectId)) {
    throw new Error(`not a project id: ${projectId}`);
  }
  return `${ID_PREFIXES.conversation}${projectId}`;
}
