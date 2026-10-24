/**
 * The setup conversation's door (ADR 0140, WP4): what "Set up with Athena" on the Devices page
 * calls. `POST /devices/setup` opens (or reopens) the daemon's setup session and answers with its
 * session key and conversation; a turn sent to `/run` with that `origin` is a setup turn - the
 * daemon gives it the setup steps and the `connector.setup.*` names, and switches every page and
 * connector off for it. No page can register that origin, so this call is the only way in.
 *
 * Nothing here decides anything: which names are gated, and where, is the daemon's.
 */
import { globalFetch, type Endpoint, type FetchLike } from "@/lib/api";

/** The setup session's key, as `athena.core.setup.SETUP_SESSION_ORIGIN` spells it. */
export const SETUP_ORIGIN = "athena://setup";
/** The catalog origin of the setup names (`connector.setup.*`), as `SETUP_TOOLS_ORIGIN` spells it. */
export const SETUP_TOOLS_ORIGIN = "connector:setup";

/** What the daemon answered: the session to run turns on, and what this device is waiting for. */
export interface SetupSession {
  origin: string;
  conversation_id: string;
  /** `null` before any setup, else one word: `installing`, `signing_in`, `approving`, ... */
  phase: string | null;
}

/** The person chose "Set up with Athena": open the setup session on this device's daemon. */
export async function openSetup(
  endpoint: Endpoint,
  fetchImpl: FetchLike = globalFetch,
): Promise<SetupSession> {
  const response = await fetchImpl(`${endpoint.url}/devices/setup`, {
    method: "POST",
    headers: {
      "X-Athena-Token": endpoint.token,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok)
    throw new Error(`the setup conversation did not open (${response.status})`);
  const body = (await response.json()) as Partial<SetupSession>;
  if (
    body.origin !== SETUP_ORIGIN ||
    typeof body.conversation_id !== "string"
  ) {
    throw new Error(
      "the daemon answered something that is not the setup session",
    );
  }
  return {
    origin: body.origin,
    conversation_id: body.conversation_id,
    phase: body.phase ?? null,
  };
}

/** What {@link beginSetup} needs: the endpoint, the door, and the hand-over to her window. */
export interface BeginSetupDeps {
  endpoint: () => Endpoint | null;
  /** Hand the open session to her window and bring her up (`athenaSetup`). */
  hand: (session: SetupSession) => Promise<void>;
  open?: (endpoint: Endpoint) => Promise<SetupSession>;
}

/**
 * "Set up with Athena", end to end (ADR 0140, WP4): open the setup session on this device's
 * daemon, then hand it to her window, where the person talks to her. The conversation is hers -
 * the run store lives in her window alone (ADR 0026) - so Main only opens the door and passes the
 * key; her window opens the conversation itself (ADR 0140, "She speaks first"). Rejects with a
 * sentence a person can read.
 */
export async function beginSetup(deps: BeginSetupDeps): Promise<SetupSession> {
  const found = deps.endpoint();
  if (!found) throw new Error("Athena is not running here yet.");
  const session = await (deps.open ?? openSetup)(found);
  await deps.hand(session);
  return session;
}
