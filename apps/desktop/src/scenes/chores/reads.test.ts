/**
 * The Chores depth's warm-remount read cache — ADR 0159.
 *
 * Two asks for one key while the first is on its way share it; an answer one client gave is never
 * served to another; a failed refresh keeps the last answer and says so; the map stays bounded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMIT, forgetReads, peek, read, readKey } from "./reads";

const later = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  forgetReads();
});

describe("reads.ts", () => {
  it("case 0: two reads of one key while the first is in flight call fetch once and share the answer", async () => {
    const client = {};
    const key = readKey(client, "cases|a");
    const answer = later<string>();
    const fetch = vi.fn(() => answer.promise);
    const one = read(key, fetch);
    const two = read(key, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(peek(key)).toEqual({ kind: "looking" });
    answer.resolve("the one answer");
    await expect(one).resolves.toBe("the one answer");
    await expect(two).resolves.toBe("the one answer");
    expect(peek(key)).toEqual({ kind: "found", value: "the one answer", refreshing: false });
  });

  it("case 1: an answer for client A is never served to client B with the same route", async () => {
    const a = {};
    const b = {};
    expect(readKey(a, "cases|a")).not.toBe(readKey(b, "cases|a"));
    await read(readKey(a, "cases|a"), () => Promise.resolve("for A"));
    expect(peek(readKey(a, "cases|a"))).toMatchObject({ kind: "found", value: "for A" });
    expect(peek(readKey(b, "cases|a"))).toEqual({ kind: "looking" });
    const fetchB = vi.fn(() => Promise.resolve("for B"));
    await read(readKey(b, "cases|a"), fetchB);
    expect(fetchB).toHaveBeenCalledTimes(1);
    expect(peek(readKey(b, "cases|a"))).toMatchObject({ kind: "found", value: "for B" });
  });

  it("a second client in the key keeps two readers of different side clients apart", () => {
    const client = {};
    expect(readKey(client, "yours", {})).not.toBe(readKey(client, "yours", {}));
    expect(readKey(client, "yours")).not.toBe(readKey(client, "yours", {}));
  });

  it("a refresh is told apart from a fresh answer, and a failed one keeps the last answer", async () => {
    const key = readKey({}, "runs|p");
    await read(key, () => Promise.resolve(1));
    const again = later<number>();
    void read(key, () => again.promise).catch(() => undefined);
    expect(peek(key)).toEqual({ kind: "found", value: 1, refreshing: true });
    again.reject(new Error("offline"));
    await again.promise.catch(() => undefined);
    await Promise.resolve();
    expect(peek(key)).toMatchObject({ kind: "found", value: 1, refreshing: false, refreshFailed: new Error("offline") });
    await read(key, () => Promise.resolve(2));
    expect(peek(key)).toEqual({ kind: "found", value: 2, refreshing: false });
  });

  it("a cold failure is failed, and a retry is looking again", async () => {
    const key = readKey({}, "cases|x");
    await read(key, () => Promise.reject(new Error("down"))).catch(() => undefined);
    expect(peek(key)).toEqual({ kind: "failed", error: new Error("down") });
    void read(key, () => new Promise(() => {}));
    expect(peek(key)).toEqual({ kind: "looking" });
  });

  it("forgetReads drops every answer, and one still on its way lands nowhere", async () => {
    const key = readKey({}, "cases|f");
    const answer = later<string>();
    void read(key, () => answer.promise);
    forgetReads();
    answer.resolve("late");
    await answer.promise;
    await Promise.resolve();
    expect(peek(key)).toEqual({ kind: "looking" });
  });

  it("stays bounded by its working set", async () => {
    const client = {};
    for (let i = 0; i < LIMIT + 10; i++) await read(readKey(client, `runs|${i}`), () => Promise.resolve(i));
    expect(peek(readKey(client, "runs|0"))).toEqual({ kind: "looking" });
    expect(peek(readKey(client, `runs|${LIMIT + 9}`))).toMatchObject({ kind: "found", value: LIMIT + 9 });
  });
});
