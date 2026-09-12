/**
 * `@athena/demo-kit/db` - server-only SQLite on the Node built-in driver.
 *
 * No native modules: `node:sqlite` (`DatabaseSync`) ships with Node >= 22.5, and every host app in
 * `examples/` targets Node 24. Nothing here reaches the network or needs a key.
 */
import "server-only";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParams = SqlValue[] | Record<string, SqlValue>;

/** A thin, typed handle over `DatabaseSync`. Apps pass this around instead of the raw driver. */
export interface Db {
  /** The app id this handle was opened for (`ledgerbox`, `hirelane`, ...). */
  readonly appId: string;
  /** Absolute path of the SQLite file on disk. */
  readonly file: string;
  /** The underlying `node:sqlite` handle, for anything the wrappers do not cover. */
  readonly raw: DatabaseSync;
  /** Run DDL or a multi-statement script. */
  exec(sql: string): void;
  /** Every matching row. */
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlParams): T[];
  /** The first matching row, or `undefined`. */
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlParams): T | undefined;
  /** An INSERT/UPDATE/DELETE; returns rows changed and the last inserted rowid. */
  run(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number };
  /**
   * Run `fn` inside a transaction; rolls back and rethrows if `fn` throws.
   *
   * Re-entrant: a `withTx` called from inside another one joins the enclosing transaction rather
   * than opening a second, so an `applyUndo` that reuses the app's own mutation helpers works. A
   * throw at any depth rolls the whole thing back - there is no partial inner rollback.
   */
  withTx<T>(fn: (db: Db) => T): T;
  close(): void;
}

export interface OpenDbOptions {
  /** Override the default `examples/<appId>/data/<appId>.sqlite` location. */
  file?: string;
  /** Called exactly once, when the database has no schema yet. Create tables and insert rows. */
  seed: (db: Db) => void;
}

const OPEN = new Map<string, Db>();

/** Default file for an app, resolved from `process.cwd()` (the app directory under `next dev`). */
export function defaultDbFile(appId: string): string {
  // Statically scoped to `data/` on purpose: Turbopack traces a dynamic `path.resolve(cwd(), x)`
  // by pulling the whole project into the server bundle.
  return join(process.cwd(), "data", `${appId}.sqlite`);
}

/*
 * `node:sqlite` overloads each method for positional (varargs) and named (one object) parameters,
 * so the branch has to be at the call site rather than in a shared `bind` helper.
 */
function callAll(stmt: StatementSync, params?: SqlParams) {
  const rows =
    params === undefined
      ? stmt.all()
      : Array.isArray(params)
        ? stmt.all(...params)
        : stmt.all(params);
  return rows.map(plain);
}

function callGet(stmt: StatementSync, params?: SqlParams) {
  const row =
    params === undefined
      ? stmt.get()
      : Array.isArray(params)
        ? stmt.get(...params)
        : stmt.get(params);
  return row === undefined ? undefined : plain(row);
}

/**
 * `node:sqlite` hands back objects with a *null prototype*. React Server Components refuse to
 * serialize those to a client component ("Only plain objects ... can be passed to Client
 * Components"), so every row is copied into a real object on the way out. Do not remove this.
 */
function plain<T extends object>(row: T): T {
  return { ...row };
}

function callRun(stmt: StatementSync, params?: SqlParams) {
  if (params === undefined) return stmt.run();
  return Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
}

/**
 * Open (and on first use create + seed) the app database.
 *
 * The handle is memoised per resolved file path, so Next's dev-server module reloading does not
 * open a second connection. `seed` runs once, guarded by a `meta` row, inside a transaction.
 */
export function openDb(appId: string, opts: OpenDbOptions): Db {
  // A relative `file` is a name inside the app's `data/` directory; pass an absolute path to put
  // the database anywhere else.
  const file = opts.file
    ? isAbsolute(opts.file)
      ? opts.file
      : join(process.cwd(), "data", opts.file)
    : defaultDbFile(appId);

  const cached = OPEN.get(file);
  if (cached) return cached;

  mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  // Transaction depth for this handle. SQLite has no nested BEGIN, and the kit hands out a
  // callback slot that already runs inside one (`undoActivity` calls the app's `applyUndo`), so an
  // `applyUndo` written the obvious way - by reusing one of the app's own mutation helpers - would
  // otherwise abort the whole undo with a driver message. An inner call joins the enclosing
  // transaction instead.
  let txDepth = 0;

  const db: Db = {
    appId,
    file,
    raw,
    exec: (sql) => raw.exec(sql),
    all: <T,>(sql: string, params?: SqlParams) => callAll(raw.prepare(sql), params) as T[],
    get: <T,>(sql: string, params?: SqlParams) =>
      callGet(raw.prepare(sql), params) as T | undefined,
    run: (sql, params) => {
      const r = callRun(raw.prepare(sql), params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    withTx: <T,>(fn: (db: Db) => T): T => {
      if (txDepth > 0) {
        txDepth += 1;
        try {
          return fn(db);
        } finally {
          txDepth -= 1;
        }
      }
      raw.exec("BEGIN");
      txDepth = 1;
      try {
        const out = fn(db);
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      } finally {
        txDepth = 0;
      }
    },
    close: () => {
      OPEN.delete(file);
      raw.close();
    },
  };

  db.exec(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
  const seeded = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", ["seeded_at"]);
  if (!seeded) {
    db.withTx((tx) => {
      opts.seed(tx);
      tx.run("INSERT INTO meta (key, value) VALUES (?, ?)", ["app_id", appId]);
      tx.run("INSERT INTO meta (key, value) VALUES (?, ?)", ["seeded_at", new Date().toISOString()]);
    });
  }

  OPEN.set(file, db);
  return db;
}

/** Read a `meta` value (the seed marker lives here too). */
export function getMeta(db: Db, key: string): string | undefined {
  return db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key])?.value;
}

/** Write a `meta` value. */
export function setMeta(db: Db, key: string, value: string): void {
  db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?", [
    key,
    value,
    value,
  ]);
}
