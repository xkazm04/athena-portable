//! The shell's store — README section 3.5, the rows about captures and about the IPC boundary.
//!
//! One SQLite file in the app data directory, one connection behind a mutex, and **every table
//! the shell will ever need created now**. Milestones after this one add code, not columns:
//! `projects` (c25), `activity` (c27) and `captures` (c24) are here before anything writes to
//! them, so no later commit ships a migration and no user's store is ever half a version.
//!
//! Four commands and one shape. `store_get`, `store_set`, `store_list` and `store_delete` take a
//! **table name and a key**, and every table is described once in [`TABLES`]. A new surface adds
//! a row to that list, not a command — which is the whole reason the panel's seven modules can be
//! written by seven people (README section 9) without seven pairs of Rust commands.
//!
//! Three rules this file holds up:
//!
//!  1. **`null` is the only empty value.** A missing row answers `null`, not an error and not an
//!     empty object; a column the caller omits from a `store_set` keeps what is stored, and one
//!     the caller sends as `null` is *also* "leave it alone" — `undefined` never reaches here
//!     because `lib/ipc.ts` rejects it at the type level.
//!  2. **Bounded output announces itself.** `store_list` answers `{rows, showing, total}` and the
//!     total is counted through the same `WHERE` as the page, so the two can never describe
//!     different sets.
//!  3. **`bytes` is the store's arithmetic, not the caller's.** A capture's size is measured from
//!     the blob as it is written, so the LRU sweep cannot be lied to by a wrong number.

use std::collections::hash_map::DefaultHasher;
use std::hash::{BuildHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

/// The store's schema version. It is written into `schema_migrations` by [`Store::open`] and it
/// moves only when a column does — which, by the design above, is meant to be never.
pub const SCHEMA_VERSION: i64 = 1;

/// The most the `captures` table may hold before [`Store::captures_sweep`] starts evicting.
///
/// 64 MiB is roughly 300 full-window PNGs at the size WebView2 hands back. The first build never
/// cleaned screenshots up at all; the number matters less than the fact that one exists and that
/// a test proves the sweep respects it.
pub const CAPTURES_CAP_BYTES: i64 = 64 * 1024 * 1024;

/// The most rows `store_list` hands back in one call, whatever the filter asked for.
const LIST_MAX_LIMIT: i64 = 1000;
const LIST_DEFAULT_LIMIT: i64 = 200;

// ==============================================================================================
// The table descriptions. This list is the schema, the wire contract and the documentation.
// ==============================================================================================

/// How a row's key comes to exist.
#[derive(Clone, Copy, PartialEq, Eq)]
enum KeyMode {
    /// The caller names the row. Ids that cross the Python/TypeScript seam are minted by
    /// `ids.ts` (plan §3, "ids minted in exactly one place per kind"), so the store must not
    /// mint a second spelling of one.
    Caller,
    /// `INTEGER PRIMARY KEY AUTOINCREMENT`: an empty key means "append", and the new id comes
    /// back from `store_set`.
    Rowid,
    /// The shell mints it, because the shell is what produces the thing. Only captures: the
    /// screenshot is taken here, so its name is made here.
    Minted(&'static str),
}

/// What a column holds, which is the whole of how a JSON value becomes a bound parameter and how
/// a bound parameter becomes JSON again.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Text,
    Int,
    Bool,
    /// Any JSON value, stored as its text. Read back parsed, so a caller never sees a string
    /// that is really an object.
    Json,
    /// Bytes, carried over the wire as base64 — JSON has no spelling for a blob and an array of
    /// 900,000 numbers is not one.
    Blob,
    /// A timestamp, normalised by [`sqlite_ts`] so the column holds one spelling.
    Ts,
}

struct Column {
    name: &'static str,
    kind: Kind,
    /// The SQL the insert uses when the caller omits this column.
    default_sql: &'static str,
}

struct Table {
    name: &'static str,
    key: &'static str,
    key_kind: Kind,
    key_mode: KeyMode,
    columns: &'static [Column],
    /// `true` for `settings` alone: its row *is* its value, so `store_get` answers the value
    /// rather than an object wrapping it. Every other table's row is an object of its columns.
    value_is_row: bool,
}

const fn col(name: &'static str, kind: Kind, default_sql: &'static str) -> Column {
    Column {
        name,
        kind,
        default_sql,
    }
}

const TABLES: &[Table] = &[
    // What the app is configured to be: engine, theme, the active project id. The value is any
    // JSON — the shell does not interpret a setting, it carries it between the panel and the
    // sidecar.
    Table {
        name: "settings",
        key: "key",
        key_kind: Kind::Text,
        key_mode: KeyMode::Caller,
        columns: &[col("value", Kind::Json, "'null'")],
        value_is_row: true,
    },
    // Per-origin trust (README section 3.3). `overrides` is the per-tool class map — where a
    // hand's `GATED`-on-first-sight override lives from c24 — and it is data the user can see
    // and change, never a decision the model made.
    Table {
        name: "origins",
        key: "origin",
        key_kind: Kind::Text,
        key_mode: KeyMode::Caller,
        columns: &[
            col("enabled", Kind::Bool, "0"),
            col("overrides", Kind::Json, "'{}'"),
            col("first_seen", Kind::Ts, "datetime('now')"),
            col("last_seen", Kind::Ts, "datetime('now')"),
        ],
        value_is_row: false,
    },
    // Projects (c25). The *active* project is not a column here: it is one `settings` row, so
    // "which project is active" has exactly one answer and deleting a project cannot leave two.
    Table {
        name: "projects",
        key: "id",
        key_kind: Kind::Text,
        key_mode: KeyMode::Caller,
        columns: &[
            col("name", Kind::Text, "''"),
            col("engine_override", Kind::Text, "NULL"),
            col("created_at", Kind::Ts, "datetime('now')"),
        ],
        value_is_row: false,
    },
    // The pages a project spans. No `UNIQUE (project_id, url)`: a constraint that answers a
    // re-add with an error is a trap for c25, which lists and reuses the id instead.
    Table {
        name: "project_pages",
        key: "id",
        key_kind: Kind::Text,
        key_mode: KeyMode::Caller,
        columns: &[
            col("project_id", Kind::Text, "''"),
            col("origin", Kind::Text, "''"),
            col("url", Kind::Text, "''"),
        ],
        value_is_row: false,
    },
    // The conversations a project has had — the join c27 needs to get from a ledger row back to
    // the project that ran it.
    Table {
        name: "project_runs",
        key: "id",
        key_kind: Kind::Text,
        key_mode: KeyMode::Caller,
        columns: &[
            col("project_id", Kind::Text, "''"),
            col("conversation_id", Kind::Text, "''"),
            col("started_at", Kind::Ts, "datetime('now')"),
            col("summary", Kind::Text, "''"),
        ],
        value_is_row: false,
    },
    // One row per tool call, of any tier (c27). The ledger counts turns; this counts calls, and
    // `reason` is the closed-set refusal the panel shows verbatim.
    Table {
        name: "activity",
        key: "id",
        key_kind: Kind::Int,
        key_mode: KeyMode::Rowid,
        columns: &[
            col("ts", Kind::Ts, "datetime('now')"),
            col("tab_id", Kind::Int, "NULL"),
            col("origin", Kind::Text, "''"),
            col("tool", Kind::Text, "''"),
            col("tier", Kind::Int, "1"),
            col("class", Kind::Text, "''"),
            col("outcome", Kind::Text, "''"),
            col("ms", Kind::Int, "0"),
            col("reason", Kind::Text, "NULL"),
            col("approval_id", Kind::Text, "NULL"),
        ],
        value_is_row: false,
    },
    // The evidence beside a decision card (c24). `bytes` is written by the store from the blob
    // it was handed, never by the caller, because it is what the sweep does arithmetic on.
    Table {
        name: "captures",
        key: "id",
        key_kind: Kind::Text,
        key_mode: KeyMode::Minted("cap"),
        columns: &[
            col("tab_id", Kind::Int, "NULL"),
            col("origin", Kind::Text, "''"),
            col("ts", Kind::Ts, "datetime('now')"),
            col("png", Kind::Blob, "NULL"),
            col("bytes", Kind::Int, "0"),
        ],
        value_is_row: false,
    },
];

/// The column a capture's size lives in, and the one `store_set` refuses to take dictation on.
const CAPTURE_BYTES: &str = "bytes";
const CAPTURE_PNG: &str = "png";

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT 'null'
);
CREATE TABLE IF NOT EXISTS origins (
    origin     TEXT PRIMARY KEY,
    enabled    INTEGER NOT NULL DEFAULT 0,
    overrides  TEXT NOT NULL DEFAULT '{}',
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    engine_override TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_pages (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT '',
    origin     TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS project_pages_by_project ON project_pages (project_id, url);
CREATE TABLE IF NOT EXISTS project_runs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '',
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    summary         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS project_runs_by_project ON project_runs (project_id, started_at DESC);
CREATE TABLE IF NOT EXISTS activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    tab_id      INTEGER,
    origin      TEXT NOT NULL DEFAULT '',
    tool        TEXT NOT NULL DEFAULT '',
    tier        INTEGER NOT NULL DEFAULT 1,
    class       TEXT NOT NULL DEFAULT '',
    outcome     TEXT NOT NULL DEFAULT '',
    ms          INTEGER NOT NULL DEFAULT 0,
    reason      TEXT,
    approval_id TEXT
);
CREATE INDEX IF NOT EXISTS activity_by_ts ON activity (ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS activity_by_origin ON activity (origin, ts DESC);
CREATE TABLE IF NOT EXISTS captures (
    id     TEXT PRIMARY KEY,
    tab_id INTEGER,
    origin TEXT NOT NULL DEFAULT '',
    ts     TEXT NOT NULL DEFAULT (datetime('now')),
    png    BLOB,
    bytes  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS captures_by_ts ON captures (ts, id);
"#;

// ==============================================================================================
// The store
// ==============================================================================================

pub struct Store {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Store {
    /// Open (and, the first time, create) the store at `path`.
    ///
    /// Running the schema again on an existing file is the ordinary case, not the exception: it
    /// is `CREATE TABLE IF NOT EXISTS` throughout and the version row is `INSERT OR IGNORE`, so
    /// `applied_at` records the day the store was *first* made and never moves.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at)
             VALUES (?1, datetime('now'))",
            [SCHEMA_VERSION],
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    /// Where the file is. The Settings module shows it read-only: a user who has to ask support
    /// where their data went is a user whose app would not say.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The highest version `schema_migrations` records.
    pub fn schema_version(&self) -> Result<i64, String> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "store poisoned".to_string())
    }

    /// One row, or `Value::Null` when there is none. For `settings` the answer is the stored
    /// value itself; for every other table it is an object of the row's columns, key included.
    pub fn get(&self, table: &str, key: &str) -> Result<Value, String> {
        let spec = table_spec(table)?;
        let key_param = spec.key_kind.bind_key(key)?;
        let sql = format!(
            "SELECT {} FROM {} WHERE {} = ?1",
            spec.select_list(),
            spec.name,
            spec.key
        );
        let conn = self.lock()?;
        let row = conn
            .query_row(&sql, [&key_param], |r| spec.read_row(r, spec.value_is_row))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row.unwrap_or(Value::Null))
    }

    /// Write a row, and answer with the key it was written under — which is the only way the
    /// caller learns an appended `activity` id or a minted capture id.
    ///
    /// A column the `value` object does not mention keeps what is stored (or takes its default
    /// on an insert). `null` says the same thing as an absent key, deliberately: `undefined` has
    /// no JSON spelling, so the panel sends `null` for "nothing here" and the two must mean one
    /// thing or the panel's empty value would silently clear a column.
    pub fn set(&self, table: &str, key: &str, value: &Value) -> Result<String, String> {
        let spec = table_spec(table)?;

        // `settings` is a key/value table, so its whole value is one column.
        let owned;
        let fields: &Map<String, Value> = if spec.value_is_row {
            owned = Map::from_iter([("value".to_string(), value.clone())]);
            &owned
        } else if let Value::Object(map) = value {
            if spec.name == "captures" {
                owned = with_measured_bytes(map);
                &owned
            } else {
                map
            }
        } else {
            return Err(format!("a {} row is written as an object", spec.name));
        };

        let key = match spec.key_mode {
            KeyMode::Minted(prefix) if key.is_empty() => mint_id(prefix),
            _ => key.to_string(),
        };
        let appending = spec.key_mode == KeyMode::Rowid && key.is_empty();
        if key.is_empty() && !appending {
            return Err(format!("a {} row needs a key", spec.name));
        }

        // Bound in the same order as the column list, so `?1` is the key and `?N+1` is column N
        // in both halves of the upsert.
        let mut params: Vec<SqlValue> = Vec::with_capacity(spec.columns.len() + 1);
        params.push(if appending {
            SqlValue::Null
        } else {
            spec.key_kind.bind_key(&key)?
        });
        for column in spec.columns {
            params.push(column.bind(fields.get(column.name))?);
        }
        let refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();

        let conn = self.lock()?;
        conn.execute(&spec.upsert_sql(appending), refs.as_slice())
            .map_err(|e| e.to_string())?;
        if appending {
            return Ok(conn.last_insert_rowid().to_string());
        }
        Ok(key)
    }

    /// A bounded page of a table, newest or oldest first as the table's own order says, with the
    /// total beside it so the caller can announce `(showing N of M)`.
    ///
    /// The filter is an object. A key that names a column of this table is an equality test; the
    /// three reserved keys are `limit`, `since` (rows at or after a timestamp, on tables that
    /// have one) and `key` (the row's own key column, under the name every caller already knows).
    pub fn list(&self, table: &str, filter: &Value) -> Result<Value, String> {
        let spec = table_spec(table)?;
        let empty = Map::new();
        let filter = filter.as_object().unwrap_or(&empty);

        let mut wheres: Vec<String> = Vec::new();
        let mut params: Vec<SqlValue> = Vec::new();
        for (name, raw) in filter {
            if raw.is_null() {
                continue;
            }
            if name == "limit" {
                continue;
            }
            if name == "since" {
                let ts = spec.ts_column().ok_or_else(|| {
                    format!("{} has no timestamp to filter `since` on", spec.name)
                })?;
                params.push(Kind::Ts.bind(Some(raw))?);
                wheres.push(format!("{ts} >= ?{}", params.len()));
                continue;
            }
            if name == "key" || name == spec.key {
                params.push(spec.key_kind.bind(Some(raw))?);
                wheres.push(format!("{} = ?{}", spec.key, params.len()));
                continue;
            }
            let column = spec
                .columns
                .iter()
                .find(|c| c.name == name)
                .ok_or_else(|| format!("{} has no column {name}", spec.name))?;
            params.push(column.bind(Some(raw))?);
            wheres.push(format!("{name} = ?{}", params.len()));
        }
        let where_sql = if wheres.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", wheres.join(" AND "))
        };
        let limit = filter
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(LIST_DEFAULT_LIMIT)
            .clamp(1, LIST_MAX_LIMIT);

        let conn = self.lock()?;
        let refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        // One `WHERE`, built once, used by the count and the page — so `total` can never describe
        // a different set from `rows`.
        let total: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {} {where_sql}", spec.name),
                refs.as_slice(),
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        params.push(SqlValue::Integer(limit));
        let refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM {} {where_sql} ORDER BY {} LIMIT ?{}",
                spec.select_list(),
                spec.name,
                spec.order_by(),
                params.len()
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(refs.as_slice(), |r| spec.read_row(r, false))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(json!({ "rows": rows, "showing": rows.len(), "total": total }))
    }

    /// Delete a row. Deleting one that was never there is not an error: "it is not there" is the
    /// outcome the caller asked for either way.
    pub fn delete(&self, table: &str, key: &str) -> Result<(), String> {
        let spec = table_spec(table)?;
        let key_param = spec.key_kind.bind_key(key)?;
        let conn = self.lock()?;
        conn.execute(
            &format!("DELETE FROM {} WHERE {} = ?1", spec.name, spec.key),
            [&key_param],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    /// File one capture and answer with its minted id (c24).
    ///
    /// The shell's own door into the `captures` table, because the shell is the only thing that
    /// produces a capture and it holds the PNG as bytes. Everything else about the row is
    /// [`Store::set`]'s: the id is minted there, and `bytes` is measured there from the blob
    /// rather than taken on trust.
    ///
    /// Base64 rather than a second binding path, even though both ends of this call are Rust.
    /// `Kind::Blob` already has exactly one spelling on the way in, and a native path beside it
    /// would be a second place a blob column is written — which is the kind of duplication that
    /// stays correct right up until one side gains a column.
    pub fn put_capture(&self, tab_id: u32, origin: &str, png: &[u8]) -> Result<String, String> {
        self.set(
            "captures",
            "",
            &serde_json::json!({
                "tab_id": tab_id,
                "origin": origin,
                "png": b64_encode(png),
            }),
        )
    }

    /// Evict the least recently written captures until the table fits under `cap_bytes`.
    ///
    /// Least recently *written* rather than least recently read, and the difference is stated
    /// rather than glossed: a capture is written once and looked at by the one decision card
    /// that cites it, so write order is use order. Nothing here touches a row on read, because a
    /// read that mutates is a surprise that would have to be explained everywhere else.
    ///
    /// Answers `{removed, freed, bytes, cap_bytes}` — the figures the Settings module and c24's
    /// test both need.
    pub fn captures_sweep(&self, cap_bytes: i64) -> Result<Value, String> {
        let cap = cap_bytes.max(0);
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut total: i64 = tx
            .query_row("SELECT COALESCE(SUM(bytes), 0) FROM captures", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;

        let mut removed = 0i64;
        let mut freed = 0i64;
        while total > cap {
            let oldest: Option<(String, i64)> = tx
                .query_row(
                    "SELECT id, bytes FROM captures ORDER BY ts, id LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let Some((id, bytes)) = oldest else { break };
            tx.execute("DELETE FROM captures WHERE id = ?1", [&id])
                .map_err(|e| e.to_string())?;
            total -= bytes;
            freed += bytes;
            removed += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({
            "removed": removed,
            "freed": freed,
            "bytes": total,
            "cap_bytes": cap,
        }))
    }
}

// ==============================================================================================
// Table plumbing
// ==============================================================================================

fn table_spec(name: &str) -> Result<&'static Table, String> {
    TABLES
        .iter()
        .find(|t| t.name == name)
        // The name of a table nobody has is not echoed back into the message: the list of tables
        // that do exist is the useful half, and it is short.
        .ok_or_else(|| {
            let known: Vec<&str> = TABLES.iter().map(|t| t.name).collect();
            format!("no such table; this store has {}", known.join(", "))
        })
}

impl Table {
    fn select_list(&self) -> String {
        let mut parts = vec![self.key.to_string()];
        parts.extend(self.columns.iter().map(|c| c.name.to_string()));
        parts.join(", ")
    }

    /// A row as JSON. `bare` is [`Table::value_is_row`] applied: a `store_get` of a setting
    /// answers the value itself, because that is what the caller asked for — but a *list* of
    /// settings answers objects, because a page of values with no keys beside them is a page
    /// nothing can be done with.
    fn read_row(&self, row: &rusqlite::Row<'_>, bare: bool) -> rusqlite::Result<Value> {
        if bare {
            return self.columns[0].read(row, 1);
        }
        let mut out = Map::new();
        out.insert(self.key.to_string(), self.key_kind.read(row, 0)?);
        for (i, column) in self.columns.iter().enumerate() {
            out.insert(column.name.to_string(), column.read(row, i + 1)?);
        }
        Ok(Value::Object(out))
    }

    fn upsert_sql(&self, appending: bool) -> String {
        let names: Vec<&str> = self.columns.iter().map(|c| c.name).collect();
        let values: Vec<String> = self
            .columns
            .iter()
            .enumerate()
            .map(|(i, c)| format!("COALESCE(?{}, {})", i + 2, c.default_sql))
            .collect();
        if appending {
            return format!(
                "INSERT INTO {} ({}) VALUES ({})",
                self.name,
                names.join(", "),
                values.join(", ")
            );
        }
        // The update branch reads the parameters again rather than `excluded.*`: the VALUES row
        // has already had the insert defaults COALESCEd into it, so `excluded` can no longer
        // tell a column the caller omitted from one it sent.
        let sets: Vec<String> = self
            .columns
            .iter()
            .enumerate()
            .map(|(i, c)| {
                format!(
                    "{} = COALESCE(?{}, {}.{})",
                    c.name,
                    i + 2,
                    self.name,
                    c.name
                )
            })
            .collect();
        format!(
            "INSERT INTO {} ({}, {}) VALUES (?1, {})
             ON CONFLICT({}) DO UPDATE SET {}",
            self.name,
            self.key,
            names.join(", "),
            values.join(", "),
            self.key,
            sets.join(", ")
        )
    }

    fn ts_column(&self) -> Option<&'static str> {
        self.columns
            .iter()
            .find(|c| c.kind == Kind::Ts)
            .map(|c| c.name)
    }

    /// Newest first where there is a clock, and by key where there is not — a list of settings
    /// or origins is read alphabetically and a list of calls is read from the most recent.
    fn order_by(&self) -> String {
        match self.name {
            "activity" | "captures" => format!(
                "{} DESC, {} DESC",
                self.ts_column().unwrap_or(self.key),
                self.key
            ),
            "origins" => "first_seen, origin".to_string(),
            "projects" => "created_at, id".to_string(),
            "project_runs" => "started_at DESC, id".to_string(),
            _ => self.key.to_string(),
        }
    }
}

impl Kind {
    /// A key arrives as a string because that is what a key is on the wire; an integer key is
    /// parsed here rather than by every caller.
    fn bind_key(&self, key: &str) -> Result<SqlValue, String> {
        match self {
            Kind::Int => key
                .parse::<i64>()
                .map(SqlValue::Integer)
                .map_err(|_| format!("`{key}` is not a row id")),
            _ => Ok(SqlValue::Text(key.to_string())),
        }
    }

    fn bind(&self, value: Option<&Value>) -> Result<SqlValue, String> {
        let Some(value) = value else {
            return Ok(SqlValue::Null);
        };
        Ok(match (self, value) {
            // Absent and `null` mean the same thing — "leave this column alone" — because the
            // panel has no `undefined` to spend on the difference (README section 3.5).
            (_, Value::Null) => SqlValue::Null,
            (Kind::Json, v) => SqlValue::Text(v.to_string()),
            (Kind::Text, Value::String(s)) => SqlValue::Text(s.clone()),
            (Kind::Ts, Value::String(s)) => SqlValue::Text(sqlite_ts(s)),
            (Kind::Int, v) => SqlValue::Integer(
                v.as_i64()
                    .ok_or_else(|| format!("expected a whole number, got {v}"))?,
            ),
            (Kind::Bool, Value::Bool(b)) => SqlValue::Integer(i64::from(*b)),
            (Kind::Bool, v) => SqlValue::Integer(i64::from(
                v.as_i64()
                    .ok_or_else(|| format!("expected true or false, got {v}"))?
                    != 0,
            )),
            (Kind::Blob, Value::String(s)) => SqlValue::Blob(b64_decode(s)?),
            (Kind::Text | Kind::Ts | Kind::Blob, v) => {
                return Err(format!("expected a string, got {v}"))
            }
        })
    }

    fn read(&self, row: &rusqlite::Row<'_>, idx: usize) -> rusqlite::Result<Value> {
        Ok(match self {
            Kind::Json => row
                .get::<_, Option<String>>(idx)?
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or(Value::Null),
            Kind::Text | Kind::Ts => match row.get::<_, Option<String>>(idx)? {
                Some(s) => Value::String(s),
                None => Value::Null,
            },
            Kind::Int => match row.get::<_, Option<i64>>(idx)? {
                Some(n) => Value::from(n),
                None => Value::Null,
            },
            Kind::Bool => Value::Bool(row.get::<_, Option<i64>>(idx)?.unwrap_or(0) != 0),
            Kind::Blob => match row.get::<_, Option<Vec<u8>>>(idx)? {
                Some(bytes) => Value::String(b64_encode(&bytes)),
                None => Value::Null,
            },
        })
    }
}

impl Column {
    fn bind(&self, value: Option<&Value>) -> Result<SqlValue, String> {
        self.kind.bind(value)
    }

    fn read(&self, row: &rusqlite::Row<'_>, idx: usize) -> rusqlite::Result<Value> {
        self.kind.read(row, idx)
    }
}

/// A capture's `bytes` is measured from the blob it was handed, and a `bytes` the caller sent is
/// dropped. The sweep's arithmetic is the only thing standing between this table and a disk, so
/// it does not take the caller's word for how big a PNG is.
fn with_measured_bytes(fields: &Map<String, Value>) -> Map<String, Value> {
    let mut out = fields.clone();
    match fields.get(CAPTURE_PNG).and_then(|v| v.as_str()) {
        Some(png) => {
            let bytes = b64_decode(png).map(|b| b.len()).unwrap_or(0);
            out.insert(CAPTURE_BYTES.to_string(), Value::from(bytes as i64));
        }
        None => {
            out.remove(CAPTURE_BYTES);
        }
    }
    out
}

/// SQLite's `datetime('now')` writes `2026-09-12 12:00:00`, and every `ts` here is compared as a
/// plain string. The RFC-3339 spelling of the same instant sorts **above** it, because `T`
/// (0x54) is greater than a space (0x20) — so a `since` typed the ISO way would skip every row
/// of its own day. Both ends of every timestamp column go through here, so the table holds one
/// spelling and a caller may send either.
fn sqlite_ts(value: &str) -> String {
    let trimmed = value.trim().strip_suffix('Z').unwrap_or(value.trim());
    let truncated: String = trimmed.chars().take(19).collect();
    truncated.replacen('T', " ", 1)
}

/// `<prefix>_<16 hex chars>`. Opaque, and minted here for exactly one kind of row — a capture,
/// which the shell produces. Every id that crosses the Python/TypeScript seam is minted by
/// `ids.ts` instead, so this can never become the second place a `proj_` comes from.
fn mint_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mut hasher = DefaultHasher::new();
    nanos.hash(&mut hasher);
    SEQ.fetch_add(1, Ordering::Relaxed).hash(&mut hasher);
    // `RandomState` is seeded per process, so two runs of the shell do not mint the same series.
    std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish()
        .hash(&mut hasher);
    format!("{prefix}_{:016x}", hasher.finish())
}

// -- base64, because JSON has no spelling for a blob -------------------------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn b64_decode(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for ch in text.bytes() {
        if ch == b'=' || ch.is_ascii_whitespace() {
            continue;
        }
        let six = B64
            .iter()
            .position(|c| *c == ch)
            .ok_or_else(|| "not base64".to_string())? as u32;
        acc = (acc << 6) | six;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

// ==============================================================================================
// Commands. Declared here rather than in `lib.rs` so that adding a table is one file's business;
// `lib.rs` names them in its handler list and `capabilities/ui.json` grants them to the chrome
// webview alone.
// ==============================================================================================

/// Where the store lives, honouring `ATHENA_STORE` so a dev run can point at a scratch file
/// instead of the machine's real one.
fn store_path_for(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("ATHENA_STORE") {
        if !raw.is_empty() {
            return Ok(PathBuf::from(raw));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    Ok(dir.join("athena.sqlite"))
}

/// Open the store and hand it to Tauri's state. Non-fatal by contract: the shell must come up
/// even when the store does not, because a window that says why is worth more than no window.
pub fn init(app: &AppHandle) {
    match store_path_for(app).and_then(|p| Store::open(&p)) {
        Ok(store) => {
            // The version is read back rather than printed from the constant: what the log says
            // is then what the file actually carries, which is the only version worth logging.
            let version = store.schema_version().unwrap_or(0);
            eprintln!("[store] {} (schema {version})", store.path().display());
            app.manage(store);
        }
        Err(e) => eprintln!("[store] not opened: {e}"),
    }
}

/// The open store, or one error text shared by every caller.
///
/// `pub(crate)` because the shell writes to the store from outside this file too: a capture is
/// produced by `hands.rs` and filed here (c24). The commands below and that caller get the same
/// sentence when the store did not open, which is the sentence that says where to look.
pub(crate) fn opened(app: &AppHandle) -> Result<tauri::State<'_, Store>, String> {
    app.try_state::<Store>()
        .ok_or_else(|| "the store did not open; see the shell's log".to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn store_get(app: AppHandle, table: String, key: String) -> Result<Value, String> {
    opened(&app)?.get(&table, &key)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn store_set(
    app: AppHandle,
    table: String,
    key: String,
    value: Value,
) -> Result<String, String> {
    opened(&app)?.set(&table, &key, &value)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn store_list(app: AppHandle, table: String, filter: Value) -> Result<Value, String> {
    opened(&app)?.list(&table, &filter)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn store_delete(app: AppHandle, table: String, key: String) -> Result<(), String> {
    opened(&app)?.delete(&table, &key)
}

/// The file itself, for the Settings module's read-only line.
#[tauri::command(rename_all = "snake_case")]
pub async fn store_path(app: AppHandle) -> Result<String, String> {
    Ok(opened(&app)?.path().display().to_string())
}

/// Bring the `captures` table under a cap. `null` means [`CAPTURES_CAP_BYTES`].
#[tauri::command(rename_all = "snake_case")]
pub async fn captures_sweep(app: AppHandle, cap_bytes: Option<i64>) -> Result<Value, String> {
    opened(&app)?.captures_sweep(cap_bytes.unwrap_or(CAPTURES_CAP_BYTES))
}

// ==============================================================================================
// Tests. Every table is written and read back on a temp database, because "all the tables now"
// is only true if all of them work now — a table created and never exercised is a table that
// will be found broken by the milestone that first needs it.
// ==============================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp {
        store: Store,
        path: PathBuf,
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn temp() -> Temp {
        let path = std::env::temp_dir().join(format!("{}.sqlite", mint_id("athena-store-test")));
        let store = Store::open(&path).expect("the store opens");
        Temp { store, path }
    }

    #[test]
    fn every_table_round_trips_a_row() {
        let t = temp();
        let s = &t.store;

        // settings: the row is the value, and any JSON is a value.
        s.set("settings", "theme", &json!("dark")).expect("theme");
        s.set("settings", "engine", &json!({ "name": "claude_code" }))
            .expect("engine");
        assert_eq!(s.get("settings", "theme").unwrap(), json!("dark"));
        assert_eq!(
            s.get("settings", "engine").unwrap(),
            json!({ "name": "claude_code" })
        );

        // origins
        s.set(
            "origins",
            "https://example.test",
            &json!({ "enabled": true, "overrides": { "page_click": "GATED" } }),
        )
        .expect("origin");
        let origin = s.get("origins", "https://example.test").unwrap();
        assert_eq!(origin["enabled"], json!(true));
        assert_eq!(origin["overrides"], json!({ "page_click": "GATED" }));
        assert!(origin["first_seen"].is_string());

        // projects
        s.set(
            "projects",
            "proj_abc",
            &json!({ "name": "Invoice chase", "engine_override": "codex" }),
        )
        .expect("project");
        assert_eq!(
            s.get("projects", "proj_abc").unwrap()["name"],
            json!("Invoice chase")
        );

        // project_pages
        s.set(
            "project_pages",
            "pp_1",
            &json!({ "project_id": "proj_abc", "origin": "https://a.test", "url": "https://a.test/x" }),
        )
        .expect("page");
        assert_eq!(
            s.get("project_pages", "pp_1").unwrap()["url"],
            json!("https://a.test/x")
        );

        // project_runs
        s.set(
            "project_runs",
            "prun_1",
            &json!({ "project_id": "proj_abc", "conversation_id": "conv_proj_abc", "summary": "two drafts" }),
        )
        .expect("run");
        assert_eq!(
            s.get("project_runs", "prun_1").unwrap()["conversation_id"],
            json!("conv_proj_abc")
        );

        // activity: an empty key appends and the new id comes back.
        let id = s
            .set(
                "activity",
                "",
                &json!({ "tool": "page_read", "tier": 2, "class": "READ", "outcome": "ok", "ms": 41 }),
            )
            .expect("activity");
        let row = s.get("activity", &id).unwrap();
        assert_eq!(row["tool"], json!("page_read"));
        assert_eq!(row["tier"], json!(2));
        assert_eq!(row["reason"], Value::Null);

        // captures: an empty key mints one, and `bytes` is measured rather than believed.
        let cap = s
            .set(
                "captures",
                "",
                &json!({ "tab_id": 1, "origin": "https://a.test", "png": b64_encode(&[1, 2, 3, 4, 5]), "bytes": 9_999 }),
            )
            .expect("capture");
        assert!(cap.starts_with("cap_"), "minted id was {cap}");
        let row = s.get("captures", &cap).unwrap();
        assert_eq!(row["bytes"], json!(5));
        assert_eq!(
            b64_decode(row["png"].as_str().unwrap()).unwrap(),
            vec![1, 2, 3, 4, 5]
        );
    }

    #[test]
    fn a_missing_row_is_null_and_a_missing_delete_is_not_an_error() {
        let t = temp();
        assert_eq!(t.store.get("settings", "nothing").unwrap(), Value::Null);
        assert_eq!(
            t.store.get("origins", "https://nope.test").unwrap(),
            Value::Null
        );
        t.store
            .delete("origins", "https://nope.test")
            .expect("delete");
    }

    #[test]
    fn an_omitted_column_keeps_what_is_stored() {
        let t = temp();
        let s = &t.store;
        s.set(
            "origins",
            "https://a.test",
            &json!({ "enabled": true, "overrides": { "page_fill": "GATED" } }),
        )
        .unwrap();
        // What a "disable this origin" switch sends: one key, and nothing else meant.
        s.set("origins", "https://a.test", &json!({ "enabled": false }))
            .unwrap();
        let row = s.get("origins", "https://a.test").unwrap();
        assert_eq!(row["enabled"], json!(false));
        assert_eq!(row["overrides"], json!({ "page_fill": "GATED" }));

        // An explicit empty object still clears — a whole-row save relies on it.
        s.set("origins", "https://a.test", &json!({ "overrides": {} }))
            .unwrap();
        assert_eq!(
            s.get("origins", "https://a.test").unwrap()["overrides"],
            json!({})
        );

        // And `null` says what an absent key says, because the panel has no `undefined` to send.
        s.set("origins", "https://a.test", &json!({ "overrides": null }))
            .unwrap();
        assert_eq!(
            s.get("origins", "https://a.test").unwrap()["overrides"],
            json!({})
        );
    }

    #[test]
    fn a_list_is_bounded_and_its_total_is_honest() {
        let t = temp();
        let s = &t.store;
        for i in 0..25 {
            s.set(
                "activity",
                "",
                &json!({ "tool": "page_click", "origin": if i % 5 == 0 { "https://a.test" } else { "https://b.test" } }),
            )
            .unwrap();
        }
        let page = s.list("activity", &json!({ "limit": 10 })).unwrap();
        assert_eq!(page["showing"], json!(10));
        assert_eq!(page["total"], json!(25));

        let filtered = s
            .list("activity", &json!({ "origin": "https://a.test" }))
            .unwrap();
        assert_eq!(filtered["total"], json!(5));
        assert_eq!(filtered["showing"], json!(5));

        // A settings list carries the key, or nothing could be done with the values.
        s.set("settings", "theme", &json!("light")).unwrap();
        let settings = s.list("settings", &json!({})).unwrap();
        assert_eq!(settings["total"], json!(1));
        assert_eq!(settings["rows"][0]["key"], json!("theme"));
        assert_eq!(settings["rows"][0]["value"], json!("light"));
    }

    #[test]
    fn since_reads_the_same_instant_in_either_spelling() {
        let t = temp();
        let s = &t.store;
        for hour in ["01", "05", "12", "23"] {
            s.set(
                "activity",
                "",
                &json!({ "tool": "page_read", "ts": format!("2026-09-12 {hour}:00:00") }),
            )
            .unwrap();
        }
        let total = |since: &str| -> i64 {
            s.list("activity", &json!({ "since": since }))
                .unwrap()
                .get("total")
                .and_then(|v| v.as_i64())
                .unwrap()
        };
        assert_eq!(total("2026-09-12 00:00:00"), 4);
        assert_eq!(total("2026-09-12T00:00:00"), 4);
        assert_eq!(total("2026-09-12T00:00:00.000Z"), 4);
        assert_eq!(total("2026-09-12 06:00:00"), 2);
    }

    #[test]
    fn filing_a_capture_mints_an_id_and_measures_the_blob() {
        // The shell's own door into the table (c24). It goes through `set`, so the id, the
        // timestamp and the measured `bytes` are the same ones every other writer gets.
        let t = temp();
        let png = vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0, 0];

        let id = t
            .store
            .put_capture(7, "https://a.test", &png)
            .expect("a capture is filed");
        assert!(id.starts_with("cap_"), "minted id was {id}");

        let row = t.store.get("captures", &id).unwrap();
        assert_eq!(row["tab_id"], json!(7));
        assert_eq!(row["origin"], json!("https://a.test"));
        assert_eq!(row["bytes"], json!(png.len()));
        assert!(row["ts"].as_str().is_some_and(|ts| !ts.is_empty()));

        // The bytes come back byte for byte: a card shows the picture that was taken.
        let stored = b64_decode(row["png"].as_str().expect("base64")).expect("decodable");
        assert_eq!(stored, png);
    }

    #[test]
    fn two_captures_of_the_same_page_are_two_rows() {
        // A second look at the same tab is a second piece of evidence, not a correction of the
        // first: a card cites one id, and overwriting would change what an answered card showed.
        let t = temp();
        let shot = |png: &[u8]| t.store.put_capture(1, "https://a.test", png).unwrap();
        let first = shot(&[1, 2, 3]);
        let second = shot(&[4, 5, 6]);

        assert_ne!(first, second);
        let all = t.store.list("captures", &json!({})).unwrap();
        assert_eq!(all["total"], json!(2));
    }

    #[test]
    fn the_sweep_evicts_oldest_first_until_the_table_fits() {
        let t = temp();
        let s = &t.store;
        // Four captures of 300 bytes each, an hour apart.
        for (i, hour) in ["01", "02", "03", "04"].iter().enumerate() {
            s.set(
                "captures",
                &format!("cap_{i}"),
                &json!({
                    "tab_id": 1,
                    "origin": "https://a.test",
                    "ts": format!("2026-09-12 {hour}:00:00"),
                    "png": b64_encode(&vec![7u8; 300]),
                }),
            )
            .unwrap();
        }
        assert_eq!(s.list("captures", &json!({})).unwrap()["total"], json!(4));

        let swept = s.captures_sweep(700).unwrap();
        assert_eq!(swept["removed"], json!(2));
        assert_eq!(swept["freed"], json!(600));
        assert_eq!(swept["bytes"], json!(600));
        // The two that went are the two oldest, and the newest is untouched.
        assert_eq!(s.get("captures", "cap_0").unwrap(), Value::Null);
        assert_eq!(s.get("captures", "cap_1").unwrap(), Value::Null);
        assert!(s.get("captures", "cap_3").unwrap().is_object());

        // A sweep that has nothing to do removes nothing and still reports the total.
        let again = s.captures_sweep(700).unwrap();
        assert_eq!(again["removed"], json!(0));
        assert_eq!(again["bytes"], json!(600));

        // A cap of zero empties the table rather than looping.
        let all = s.captures_sweep(0).unwrap();
        assert_eq!(all["removed"], json!(2));
        assert_eq!(s.list("captures", &json!({})).unwrap()["total"], json!(0));
    }

    #[test]
    fn opening_the_same_store_twice_changes_nothing() {
        let t = temp();
        t.store.set("settings", "theme", &json!("dark")).unwrap();
        assert_eq!(t.store.schema_version().unwrap(), SCHEMA_VERSION);

        let again = Store::open(&t.path).expect("the store opens again");
        assert_eq!(again.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(again.get("settings", "theme").unwrap(), json!("dark"));
        let rows: i64 = again
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            rows, 1,
            "the version row is written once, not once per open"
        );
    }

    #[test]
    fn a_table_nobody_has_is_refused_by_name() {
        let t = temp();
        let err = t.store.get("secrets", "k").unwrap_err();
        assert!(err.contains("no such table"), "{err}");
        assert!(
            err.contains("settings"),
            "the message lists what does exist: {err}"
        );
        let err = t
            .store
            .list("origins", &json!({ "nonsense": 1 }))
            .unwrap_err();
        assert!(err.contains("no column nonsense"), "{err}");
    }

    #[test]
    fn base64_round_trips_every_tail_length() {
        for len in 0..8 {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            let text = b64_encode(&bytes);
            assert_eq!(b64_decode(&text).unwrap(), bytes, "at length {len}");
        }
        assert_eq!(b64_encode(b"Athena"), "QXRoZW5h");
        assert_eq!(b64_decode("QXRoZW5h").unwrap(), b"Athena");
        assert!(b64_decode("not base64!").is_err());
    }

    #[test]
    fn timestamps_hold_one_spelling() {
        assert_eq!(sqlite_ts("2026-09-12 12:00:00"), "2026-09-12 12:00:00");
        assert_eq!(sqlite_ts("2026-09-12T12:00:00Z"), "2026-09-12 12:00:00");
        assert_eq!(
            sqlite_ts("  2026-09-12T12:00:00.000Z  "),
            "2026-09-12 12:00:00"
        );
    }
}
