/**
 * `fetch` wrappers that watch the wire without changing what is on it.
 *
 * `src/lib/api.ts` takes `fetch` as an argument, which is what lets these exist: the client under
 * test is the shipped one, the server is the real daemon, and the only thing in between is a
 * function that records the request or re-chunks the answer. Nothing here invents a byte.
 */
import type { FetchLike } from "@/lib/api";

export interface Sent {
  method: string;
  url: string;
  path: string;
  /** The parsed JSON body, or `null` for a request that carried none. */
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  status: number;
}

export interface Recorder {
  sent: Sent[];
  /** Every request to one path, in order. */
  to: (path: string) => Sent[];
  fetchImpl: FetchLike;
}

/**
 * The real global `fetch`, with every request recorded.
 *
 * The global is called through a wrapper and never stored, for the reason `lib/api.ts` documents
 * at length: a bare global held as a property is invoked with the wrong receiver.
 */
export function recorder(): Recorder {
  const sent: Sent[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : null;
    const entry: Sent = {
      method,
      url: input,
      path: new URL(input).pathname,
      body: raw === null ? null : (JSON.parse(raw) as Record<string, unknown>),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      status: 0,
    };
    sent.push(entry);
    const response = await fetch(input, init);
    entry.status = response.status;
    return response;
  };
  return { sent, to: (path) => sent.filter((s) => s.path === path), fetchImpl };
}

/**
 * The real answer, re-chunked into `size`-byte pieces.
 *
 * A frame that arrives split across two reads is the framing bug an SSE parser has, and on
 * loopback it is nearly impossible to provoke by asking politely — a small body arrives in one
 * chunk every time. So the real bytes are pushed through a transform that cuts them wherever it
 * likes, and the parser has to reassemble. Streaming is preserved: the transform forwards each
 * piece as it arrives, so a decision card still reaches the panel while the turn is running.
 */
export function rechunking(size: number, inner: FetchLike = (i, n) => fetch(i, n)): FetchLike {
  return async (input, init) => {
    const response = await inner(input, init);
    if (!response.body) return response;
    const reader = response.body.getReader();
    const split = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        for (let at = 0; at < value.byteLength; at += size) {
          controller.enqueue(value.subarray(at, Math.min(at + size, value.byteLength)));
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return new Response(split, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/** A `ReadableStream` over the bytes of `text`, cut into `size`-byte chunks. */
export function streamOf(text: string, size = text.length): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(at, Math.min(at + size, bytes.byteLength)));
      at += size;
    },
  });
}
