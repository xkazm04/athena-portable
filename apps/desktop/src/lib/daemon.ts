/**
 * The sidecar, as the panel sees it — README section 3.1 (surfaces) and 3.5.
 *
 * The shell proxies nothing. Rust spawns `athena serve`, learns its URL from the one ready line
 * and holds the token; this module is how the `chrome` webview asks for those two facts and is
 * told when they change. From c22 the panel calls `{url}/manifest`, `{url}/run` and
 * `{url}/decisions/<id>` itself, over loopback, with `X-Athena-Token: {token}` — exactly the way
 * a browser extension would.
 *
 * It goes through `call` in `ipc.ts` rather than `invoke`, because `ipc.ts` is the one place the
 * `undefined`-at-the-boundary rule and the "no shell here" answer live. The Rust side is
 * `src-tauri/src/daemon.rs`; these types mirror `DaemonStatus` there and nothing else.
 */
import { call } from "@/lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Where the daemon is in its life. Four states rather than a `ready` boolean, because "not
 * ready" is three different sentences and the panel shows a different thing for each.
 */
export type DaemonHealth = "stopped" | "starting" | "ready" | "failed";

/** Which of the two shapes is running: the frozen binary, the dev fallback, or nothing yet. */
export type DaemonSource = "sidecar" | "uv" | "none";

/**
 * One engine as the daemon's own probe reported it, off `GET /health`.
 *
 * The shell never probes: the daemon knows what is on its PATH and whether a credential file sits
 * beside it, and this is that answer carried across. `EngineProbe` in `lib/engines.ts` is the
 * same three fields, which is why the Setup wizard and the Settings module can take this list
 * without a translation step.
 */
export interface DaemonEngine {
  id: string;
  state: string;
  detail: string;
}

/** `DaemonStatus` in `src-tauri/src/daemon.rs`, field for field. */
export interface DaemonStatus {
  /** `http://127.0.0.1:<port>`, once the ready line arrived. `null`, never `undefined`. */
  url: string | null;
  /** The `X-Athena-Token` every route wants. Minted per spawn, so a restart invalidates it. */
  token: string;
  engine: string;
  health: DaemonHealth;
  /** Why it is not ready, as a sentence a person can act on. Never a secret. */
  error: string;
  source: DaemonSource;
  /** The brain directory the daemon opened. */
  brain: string;
  /**
   * What the daemon's engine probe found, or `null` while it has not answered.
   *
   * `null` and `[]` are different facts and the surfaces show different sentences for each: one
   * is "nothing has been asked yet", the other is "the probe answered and named no engine".
   */
  engines: DaemonEngine[] | null;
}

/** What the shell knows right now. Called once by the store; after that, listen. */
export const daemonStatus = () => call<DaemonStatus>("daemon_status");

/**
 * Restart the daemon on an engine (README section 3.5: the engine is configuration). A staged
 * shutdown and a fresh spawn with a fresh token; the answer is the `starting` status, and the
 * rest of the story arrives on `daemon:status`.
 */
export const daemonRestart = (engine: string) =>
  call<DaemonStatus>("daemon_restart", { engine });

/**
 * Every change, whoever caused it — the spawn, the ready line, the health poll, an exit.
 *
 * Emitted with `ui_emit`, so it reaches the `chrome` webview and no page webview: the payload
 * carries the token, and a page webview is whatever site the user navigated to.
 */
export const onDaemonStatus = (f: (status: DaemonStatus) => void): Promise<UnlistenFn> =>
  listen<DaemonStatus>("daemon:status", (e) => f(e.payload));
