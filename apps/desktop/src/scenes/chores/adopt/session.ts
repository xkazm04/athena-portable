/**
 * The Adopt studio's session, held for as long as the studio is open — ADR 0097.
 *
 * On mount: `POST /adopt` for the playbook (with the saved case's id when the studio was opened on
 * one, ADR 0123), then follow its events from `after=0`. A stream that
 * drops is followed again from the last `seq` drawn, after 1, 2, then 4 s, five times at most;
 * then the studio says so and offers Retry. An event that arrives resets the count. A session the
 * daemon no longer knows (404 `unknown_ref`: reaped, or the daemon restarted) is not retried.
 *
 * On unmount a conversation the person said something in is parked (`park.ts`, ADR 0179): kept on
 * the daemon with the reducer's snapshot, so coming back offers Continue (follow from the last
 * `seq`, the person's own acts restored) or Start over. Anything else is closed (`DELETE`, fire and
 * forget) — a session whose start was still in flight is closed the moment its id arrives, so a
 * quick leave never strands one on the daemon (which keeps at most three). One conversation is
 * parked at most: a studio opened for another chore closes it first, and one parked past the
 * local limit is closed on return.
 *
 * The person's acts are optimistic: an answered card collapses at once and reopens with the
 * daemon's reason if the send is refused, and a refused send (a card or composer words) takes back
 * the stale mark it put on the brief, since the daemon never recorded it.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import { ApiError } from "@/lib/api";
import type { Answer, AnswerVia } from "@/lib/adopt";
import { documentRefusal, toBase64 } from "@/lib/adopt-client";

import { realWait, type AdoptDeps } from "./deps";
import { expired, park, parkKey, parked, resumeLine, unpark, worthParking } from "./park";
import { INITIAL, SESSION_CLOSED, reduce, type StudioState } from "./state";

/** The pause before each reconnect, by attempt; the last one repeats. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000];
export const MAX_TRIES = 5;

/** Said when Continue found the parked session gone and a fresh one began instead. */
export const ENDED_WHILE_PARKED =
  "Your earlier conversation had ended on the daemon, so she is starting a fresh one.";

/** A refusal that no reconnect can cure: the daemon does not know this session (ADR 0179). */
export const gone = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404 && error.reason === "unknown_ref";

/**
 * A refusal in words. The daemon carries two adopt refusals in its closed reason vocabulary with a
 * prefix on the detail (ADR 0097): `busy:` (three conversations already open, 429) and `stale_rev:`
 * (an approve for a brief that has since changed, 409); the front door adds `nothing_said:` and
 * `decided:` (409, ADR 0098). Each is said plainly here, never as its code word.
 */
export const why = (error: unknown): { reason: string; detail: string } => {
  if (!(error instanceof ApiError)) {
    return {
      reason: "unknown",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const detail = error.message === error.reason ? "" : error.message;
  if (detail.startsWith("busy:")) {
    return {
      reason: "busy",
      detail:
        "Three conversations are already open with her. Close one, then try again.",
    };
  }
  // The front door's two refusals (ADR 0098), 409 `validator_failed` with a prefix on the detail.
  if (detail.startsWith("nothing_said:")) {
    return {
      reason: error.reason,
      detail: "She has not heard what you need yet. Say it in your own words, then ask her to decide.",
    };
  }
  if (detail.startsWith("decided:")) {
    return { reason: error.reason, detail: "She has already given her verdict on this conversation." };
  }
  if (detail.startsWith("stale_rev:")) {
    return {
      reason: "stale_rev",
      detail:
        "The brief changed after you pressed Approve. Read the newest draft and approve that.",
    };
  }
  return { reason: error.reason, detail };
};

export interface StudioActions {
  answer: (cardKey: string, answers: Answer[], via: AnswerVia) => void;
  say: (text: string, via: AnswerVia) => void;
  drop: (file: File) => void;
  enough: () => void;
  approve: (rev: number) => void;
  /** Record that draft `rev`'s command went to Athena ("Start for real"). */
  handed: (rev: number) => void;
  /** Follow the stream again after it was given up, or start again after a failed start. */
  retry: () => void;
  /** Pick the parked conversation up where it stopped (ADR 0179). */
  resume: () => void;
  /** Close the parked conversation and start a fresh one. */
  startOver: () => void;
}

export function useAdoptSession(
  deps: AdoptDeps | undefined,
  playbookId: string,
  intro?: string,
  caseId?: string,
): [StudioState, StudioActions] {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const sid = useRef("");
  const seq = useRef(0);
  const life = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const nextKey = () => `l${(counter.current += 1)}`;
  const [epoch, bump] = useReducer((n: number) => n + 1, 0);
  // What the person said at the front door (ADR 0098): read when a session starts, never a reason to restart one.
  const opening = useRef(intro);
  const key = parkKey(playbookId, caseId);
  // The state as last drawn, for the unmount's park-or-close decision.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const follow = useCallback(
    async (id: string, signal: AbortSignal, onGone?: () => void) => {
      if (!deps) return;
      const wait = deps.wait ?? realWait;
      let tries = 0;
      for (;;) {
        let failure: unknown = null;
        try {
          for await (const e of deps.client.events(id, seq.current, signal)) {
            tries = 0;
            if (e.seq > seq.current) seq.current = e.seq;
            dispatch({ t: "event", e });
            if (e.kind === "adopt.error" && e.reason === SESSION_CLOSED) {
              dispatch({
                t: "conn",
                conn: "closed",
                tries: 0,
                reason: e.reason,
                detail: e.detail,
              });
              return;
            }
          }
        } catch (error) {
          failure = error;
        }
        if (signal.aborted) return;
        if (gone(failure)) {
          if (onGone) onGone();
          else
            dispatch({
              t: "conn",
              conn: "closed",
              tries: 0,
              reason: "unknown_ref",
              detail: "the daemon no longer knows it",
            });
          return;
        }
        tries += 1;
        if (tries > MAX_TRIES) {
          const w = failure
            ? why(failure)
            : { reason: "offline", detail: "The daemon closed the stream." };
          dispatch({ t: "conn", conn: "lost", tries, ...w });
          return;
        }
        dispatch({ t: "conn", conn: "retrying", tries });
        await wait(
          BACKOFF_MS[Math.min(tries - 1, BACKOFF_MS.length - 1)]!,
          signal,
        );
        if (signal.aborted) return;
      }
    },
    [deps],
  );

  /** Start a fresh session on `ctl`'s life and follow it. */
  const begin = useCallback(
    (ctl: AbortController, words: string | undefined, notice?: string) => {
      if (!deps) return;
      seq.current = 0;
      sid.current = "";
      counter.current = 0;
      dispatch({ t: "restart", notice });
      void deps.client.start(playbookId, words, caseId).then(
        (reply) => {
          const started = reply.session_id;
          if (ctl.signal.aborted) {
            void deps.client.close(started).catch(() => {});
            return;
          }
          sid.current = started;
          dispatch({ t: "started", sid: started, slots: reply.slots, reopened: reply.case });
          void follow(started, ctl.signal);
        },
        (error: unknown) => {
          if (!ctl.signal.aborted) dispatch({ t: "start_failed", ...why(error) });
        },
      );
    },
    [deps, playbookId, caseId, follow],
  );

  useEffect(() => {
    if (!deps) return;
    const ctl = new AbortController();
    life.current = ctl;
    const now = deps.now ?? Date.now;
    const words = opening.current;
    const held = parked();
    if (held && (held.key !== key || expired(held, now()))) {
      // Another chore's conversation, or one the daemon may have reaped: never offered, closed.
      unpark();
      void deps.client.close(held.sid).catch(() => {});
    }
    const mine = parked(key);
    if (mine) {
      seq.current = 0;
      sid.current = "";
      dispatch({ t: "offer", line: resumeLine(mine.state) });
    } else begin(ctl, words);
    return () => {
      ctl.abort();
      const id = sid.current;
      if (!id) return;
      const s = latest.current;
      if (s.sid === id && worthParking(s)) {
        const displaced = park({
          key,
          sid: id,
          lastSeq: s.lastSeq,
          state: s,
          intro: words,
          keys: counter.current,
          parkedAt: now(),
        });
        if (displaced) void deps.client.close(displaced.sid).catch(() => {});
      } else void deps.client.close(id).catch(() => {});
    };
  }, [deps, key, begin, epoch]);

  const fail = useCallback(
    (error: unknown) => dispatch({ t: "error", key: nextKey(), ...why(error) }),
    [],
  );

  const actions: StudioActions = {
    answer: (cardKey, answers, via) => {
      if (!deps || !sid.current) return;
      dispatch({ t: "answered", key: cardKey, answers });
      deps.client.answer(sid.current, answers, via).catch((error: unknown) => {
        dispatch({ t: "unanswered", key: cardKey });
        fail(error);
      });
    },
    say: (text, via) => {
      const words = text.trim();
      if (!deps || !sid.current || !words) return;
      const key = nextKey();
      dispatch({ t: "said", key, text: words, via });
      deps.client
        .answer(
          sid.current,
          [{ question_id: "", choice_ids: [], text: words }],
          via,
        )
        .catch((error: unknown) => {
          dispatch({ t: "unsaid", key });
          fail(error);
        });
    },
    drop: (file) => {
      if (!deps || !sid.current) return;
      const key = nextKey();
      const refused = documentRefusal(file);
      if (refused) {
        dispatch({
          t: "doc",
          key,
          name: file.name,
          status: "failed",
          detail: refused,
        });
        return;
      }
      dispatch({
        t: "doc",
        key,
        name: file.name,
        status: "sending",
        detail: "",
      });
      const at = sid.current;
      void file
        .arrayBuffer()
        .then((buf) =>
          deps.client.document(at, {
            name: file.name,
            mime: file.type,
            data_b64: toBase64(new Uint8Array(buf)),
          }),
        )
        .then(
          () =>
            dispatch({
              t: "doc",
              key,
              name: file.name,
              status: "sent",
              detail: "",
            }),
          (error: unknown) => {
            const w = why(error);
            dispatch({
              t: "doc",
              key,
              name: file.name,
              status: "failed",
              detail: w.detail || w.reason,
            });
          },
        );
    },
    enough: () => {
      if (!deps || !sid.current) return;
      dispatch({ t: "enough" });
      deps.client.enough(sid.current).catch((error: unknown) => {
        // Never recorded: "Good enough" opens again, and Approve stays on the auditor's word.
        dispatch({ t: "enough", undo: true });
        fail(error);
      });
    },
    approve: (rev) => {
      if (!deps || !sid.current) return;
      dispatch({ t: "approved", rev });
      deps.client.approve(sid.current, rev).then(
        (reply) => dispatch({ t: "saved", caseId: reply.case_id, problem: reply.case_problem }),
        (error: unknown) => {
          dispatch({ t: "approved", rev: null });
          fail(error);
        },
      );
    },
    handed: (rev) => dispatch({ t: "handed", rev }),
    retry: () => {
      if (!deps) return;
      if (state.conn === "lost" && sid.current && life.current) {
        dispatch({ t: "conn", conn: "retrying", tries: 0 });
        void follow(sid.current, life.current.signal);
      } else bump();
    },
    resume: () => {
      const held = parked(key);
      const ctl = life.current;
      if (!deps || !held || !ctl) return;
      unpark();
      sid.current = held.sid;
      seq.current = held.lastSeq;
      counter.current = held.keys;
      dispatch({ t: "resume", state: held.state });
      void follow(held.sid, ctl.signal, () => begin(ctl, held.intro, ENDED_WHILE_PARKED));
    },
    startOver: () => {
      const held = parked(key);
      const ctl = life.current;
      if (!deps || !ctl) return;
      if (held) {
        unpark();
        void deps.client.close(held.sid).catch(() => {});
      }
      begin(ctl, opening.current);
    },
  };

  return [state, actions];
}
