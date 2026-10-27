/**
 * The Chores front door's client over the daemon — ADR 0098, README section 3.5.
 *
 * The same conversation as the Adopt studio's, minus the case: `POST /intake` opens a session,
 * its events are the same SSE frames (read by `parseAdoptEvent`, never a second parser), answers
 * go in the same body, and the last word is an `adopt.verdict`. Like `AdoptApi`, `fetch` is an
 * argument and the endpoint is asked for at every call; a refusal is an `ApiError` in the daemon's
 * vocabulary and no endpoint, or a fetch that never got an answer, is `offline`. Nothing here
 * retries: the page's session hook owns the reconnect, because only it knows the last `seq`.
 */
import { ApiError, daemonJson, daemonSend, globalFetch, sseFrames, type Endpoint, type FetchLike } from "@/lib/api";
import {
  INTAKE_ROUTES,
  type AdoptEvent,
  type Answer,
  type AnswerVia,
  type IntakeStartReply,
} from "@/lib/adopt";
import { parseAdoptEvent } from "@/lib/adopt-client";

export interface IntakeClient {
  /** A new session; `need` is what the person already said (optional: she asks when it is absent). */
  start(need?: string): Promise<IntakeStartReply>;
  /** The session's events after `after`, as they arrive; ends when the daemon closes the stream. */
  events(
    sid: string,
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<AdoptEvent>;
  answer(
    sid: string,
    answers: readonly Answer[],
    via: AnswerVia,
  ): Promise<void>;
  /** "Just decide for me": the verdict now, with what she has. */
  decide(sid: string): Promise<void>;
  close(sid: string): Promise<void>;
}

export class IntakeApi implements IntakeClient {
  constructor(
    private readonly at: () => Endpoint | null,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async start(need?: string): Promise<IntakeStartReply> {
    const words = need?.trim() ?? "";
    const reply = await this.json<Partial<IntakeStartReply>>(
      "POST",
      INTAKE_ROUTES.start,
      words ? { need: words } : {},
    );
    return { ok: true, session_id: String(reply.session_id ?? "") };
  }

  async *events(
    sid: string,
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<AdoptEvent> {
    const response = await this.send(
      "GET",
      INTAKE_ROUTES.events(sid, after),
      undefined,
      signal,
    );
    if (!response.body)
      throw new ApiError(
        response.status,
        "engine_error",
        "the daemon streamed no body",
      );
    for await (const frame of sseFrames(response.body)) {
      const event = parseAdoptEvent(frame);
      if (event !== null) yield event;
    }
  }

  async answer(
    sid: string,
    answers: readonly Answer[],
    via: AnswerVia,
  ): Promise<void> {
    await this.json("POST", INTAKE_ROUTES.answer(sid), { answers, via });
  }

  async decide(sid: string): Promise<void> {
    await this.json("POST", INTAKE_ROUTES.decide(sid));
  }

  async close(sid: string): Promise<void> {
    await this.send("DELETE", INTAKE_ROUTES.session(sid));
  }

  private send(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return daemonSend(this.at(), this.fetchImpl, method, path, body, signal);
  }

  private json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return daemonJson<T>(this.at(), this.fetchImpl, method, path, body);
  }
}
