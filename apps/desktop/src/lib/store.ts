/**
 * The store, in the panel's own vocabulary — README section 3.5, the `store_set` row.
 *
 * `lib/ipc.ts` knows the *wire*: a table name, a key, `Wire` in and out. This file knows what a
 * row of each table looks like, and it is what a store imports. The split is not ceremony: the
 * wire has one rule to hold up (`undefined` never reaches Rust, `null` is the only empty value)
 * and it holds it for every command in the app; the shapes below change with the schema, and a
 * schema change should not be able to reach into the file that holds that rule.
 *
 * Two things worth knowing before writing a row:
 *
 *  1. **A patch is a patch.** A column the object does not carry keeps what is stored. `null`
 *     says the same thing, because the panel has no `undefined` to spend on the difference —
 *     so a column is cleared by sending its *empty value* (`""`, `{}`), never by sending null.
 *  2. **A missing row is `null`,** not an empty object and not a throw. "Nothing is stored here"
 *     is an answer a caller acts on; it is not a failure.
 */
import {
  capturesSweep as capturesSweepCommand,
  storeDeleteRow,
  storeGetRow,
  storeListRows,
  storePath as storePathCommand,
  storeSetRow,
  type Args,
  type StorePage,
  type StoreTable,
  type Wire,
} from "@/lib/ipc";

// -- the rows ----------------------------------------------------------------------------------

/**
 * The `settings` rows this build writes. The table takes any key — it is key/value — but a
 * *named* set is what stops the same fact being stored twice under two spellings, which is the
 * mistake `conv_proj_proj_<id>` was (README section 3.5, the ids row) one floor down.
 */
export const SETTING_KEYS = {
  /** Which CLI engine the daemon is started on. */
  engine: "engine",
  /** `system` | `light` | `dark`. */
  theme: "theme",
  /** The project every turn is filed under, or `null` for none (c25). */
  activeProjectId: "active_project_id",
  /** The brain directory. Empty means "the daemon's own default". */
  brainPath: "brain_path",
  /** Has the Setup wizard been finished once? It stays reachable from the bar afterwards. */
  onboarded: "onboarded",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** A per-tool class override, as the gate reads it (README section 3.3). */
export type ToolClass = "GATED" | "READ" | "AUTO";

export interface OriginRow {
  origin: string;
  enabled: boolean;
  /** Tool name to the class this origin pins it at. A user's decision, never a model's. */
  overrides: Record<string, ToolClass>;
  first_seen: string;
  last_seen: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  /** When set, activating the project restarts the daemon on it (c25). */
  engine_override: string | null;
  created_at: string;
}

export interface ProjectPageRow {
  id: string;
  project_id: string;
  origin: string;
  url: string;
}

export interface ProjectRunRow {
  id: string;
  project_id: string;
  conversation_id: string;
  started_at: string;
  summary: string;
}

export interface ActivityRow {
  id: number;
  ts: string;
  tab_id: number | null;
  origin: string;
  tool: string;
  /** 1 the page's own tools, 2 the generic hands, 3 a connector (README section 3.4). */
  tier: number;
  class: string;
  outcome: string;
  ms: number;
  /** A refusal from the closed set, shown verbatim and never paraphrased. */
  reason: string | null;
  approval_id: string | null;
}

export interface CaptureRow {
  id: string;
  tab_id: number | null;
  origin: string;
  ts: string;
  /** base64. JSON has no spelling for a blob. */
  png: string | null;
  /** Measured by Rust from the blob, not by whoever wrote the row. */
  bytes: number;
}

// -- the four wrappers -------------------------------------------------------------------------

/** One row, or `null` when there is none. For `settings` the answer is the stored value itself. */
export const storeGet = <T>(table: StoreTable, key: string): Promise<T | null> =>
  storeGetRow<T>(table, key);

/**
 * Write a row, and answer with the key it was written under.
 *
 * An empty key means "append" on `activity` and "mint one" on `captures`; every other table
 * needs a key, because every other table's key is an id something else already minted.
 */
export const storeSet = (table: StoreTable, key: string, value: Wire): Promise<string> =>
  storeSetRow(table, key, value);

/** A bounded page, with its `(showing N of M)` figures. */
export const storeList = <Row>(table: StoreTable, filter: Args = {}): Promise<StorePage<Row>> =>
  storeListRows<Row>(table, filter);

/** Deleting a row that was never there is not an error. */
export const storeDelete = (table: StoreTable, key: string): Promise<void> =>
  storeDeleteRow(table, key);

/** Where the file is. Shown read-only in Settings. */
export const storePath = (): Promise<string> => storePathCommand();

/** c24's entry point: bring `captures` under Rust's own cap. `null` means that cap. */
export const capturesSweep = capturesSweepCommand;

// -- settings ----------------------------------------------------------------------------------

/** Read one setting. `null` is "never written", which is not the same as "written as empty". */
export const settingRead = <T>(key: SettingKey): Promise<T | null> => storeGet<T>("settings", key);

export const settingWrite = async (key: SettingKey, value: Wire): Promise<void> => {
  await storeSet("settings", key, value);
};

// -- origins -----------------------------------------------------------------------------------

/** An origin the panel has seen and the user has never trusted. Not stored until something is. */
export function blankOrigin(origin: string): OriginRow {
  const now = "";
  return { origin, enabled: false, overrides: {}, first_seen: now, last_seen: now };
}

export const originRead = (origin: string): Promise<OriginRow | null> =>
  storeGet<OriginRow>("origins", origin);

/** Every stored origin, oldest first. The table is the index; no settings row lists them. */
export const originList = (): Promise<StorePage<OriginRow>> => storeList<OriginRow>("origins");

/**
 * Write the fields this call owns. `overrides` is sent entire or not at all — it is a map, and
 * the store has no way to merge one, so a caller changing one tool sends the whole map back.
 */
export const originWrite = async (
  origin: string,
  patch: Partial<Omit<OriginRow, "origin">>,
): Promise<void> => {
  await storeSet("origins", origin, { ...patch } as Wire);
};

/** Forget an origin: trust, overrides and both sightings go, so the next visit is a first one. */
export const originForget = (origin: string): Promise<void> => storeDelete("origins", origin);
