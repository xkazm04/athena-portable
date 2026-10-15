/**
 * The Chores front door's session, held for as long as the page is open — ADR 0098.
 *
 * Modelled on the Adopt studio's (`adopt/session.ts`, whose backoff and wording it shares): on
 * mount `POST /intake`, then follow its events from `after=0`; a stream that drops is followed
 * again from the last `seq` drawn, after 1, 2, then 4 s, five times at most, then the page says so
 * and offers Retry. `session_closed` is the daemon's last word and stops the following. The verdict
 * ends the conversation too: it is the last thing she says, so the stream is let go and the session
 * closed at once, which frees its place among the three the daemon keeps. On unmount the session is
 * closed (fire and forget), including one whose start was still in flight.
 *
 * Retry after a fault or a failed start is a new session carrying the need (the first thing the
 * person said), so nothing they typed has to be typed twice.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import type { Answer, AnswerVia } from "@/lib/adopt";

import { BACKOFF_MS, MAX_TRIES, why } from "../adopt/session";
import { realWait, type AdoptDeps } from "../adopt/deps";
import {
  INITIAL,
  SESSION_CLOSED,
  needOf,
  reduce,
  type IntakeState,
} from "./state";

export interface IntakeActions {
  answer: (cardKey: string, answers: Answer[], via: AnswerVia) => void;
  say: (text: string, via: AnswerVia) => void;
  /** "Just decide for me". */
  decide: () => void;
  /** Follow the stream again after it was given up, or start a new session after a fault or a failed start. */
  retry: () => void;
}

export function useIntakeSession(
  deps: AdoptDeps | undefined,
  startNeed = "",
): [IntakeState, IntakeActions] {
  const client = deps?.intake;
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const sid = useRef("");
  const seq = useRef(0);
  const life = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const need = useRef(startNeed);
  const nextKey = () => `l${(counter.current += 1)}`;
  const [epoch, bump] = useReducer((n: number) => n + 1, 0);

  const follow = useCallback(
    async (id: string, signal: AbortSignal) => {
      if (!client) return;
      const wait = deps?.wait ?? realWait;
      let tries = 0;
      for (;;) {
        let failure: unknown = null;
        try {
          for await (const e of client.events(id, seq.current, signal)) {
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
            if (e.kind === "adopt.verdict") {
              // Her last word: let the session go now, not when the person leaves.
              void client.close(id).catch(() => {});
              return;
            }
          }
        } catch (error) {
          failure = error;
        }
        if (signal.aborted) return;
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
    [client, deps],
  );

  useEffect(() => {
    if (!client) return;
    const ctl = new AbortController();
    life.current = ctl;
    seq.current = 0;
    sid.current = "";
    dispatch({ t: "restart" });
    let started = "";
    void client.start(need.current || undefined).then(
      (reply) => {
        started = reply.session_id;
        if (ctl.signal.aborted) {
          void client.close(started).catch(() => {});
          return;
        }
        sid.current = started;
        dispatch({ t: "started", sid: started, slots: [] });
        void follow(started, ctl.signal);
      },
      (error: unknown) => {
        if (!ctl.signal.aborted) dispatch({ t: "start_failed", ...why(error) });
      },
    );
    return () => {
      ctl.abort();
      if (started) void client.close(started).catch(() => {});
    };
  }, [client, follow, epoch]);

  const fail = useCallback(
    (error: unknown) => dispatch({ t: "error", key: nextKey(), ...why(error) }),
    [],
  );

  const actions: IntakeActions = {
    answer: (cardKey, answers, via) => {
      if (!client || !sid.current) return;
      dispatch({ t: "answered", key: cardKey, answers });
      client.answer(sid.current, answers, via).catch((error: unknown) => {
        dispatch({ t: "unanswered", key: cardKey });
        fail(error);
      });
    },
    say: (text, via) => {
      const words = text.trim();
      if (!client || !sid.current || !words) return;
      dispatch({ t: "said", key: nextKey(), text: words, via });
      need.current ||= words;
      client
        .answer(
          sid.current,
          [{ question_id: "", choice_ids: [], text: words }],
          via,
        )
        .catch(fail);
    },
    decide: () => {
      if (!client || !sid.current) return;
      dispatch({ t: "enough" });
      client.decide(sid.current).catch(fail);
    },
    retry: () => {
      if (!client) return;
      const s = state;
      if (s.conn === "lost" && sid.current && life.current) {
        dispatch({ t: "conn", conn: "retrying", tries: 0 });
        void follow(sid.current, life.current.signal);
        return;
      }
      need.current = needOf(s) || need.current;
      bump();
    },
  };

  return [state, actions];
}
