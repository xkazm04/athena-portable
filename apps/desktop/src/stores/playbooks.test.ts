/**
 * The lazily loaded shipped playbooks — README section 3.5, ADR 0089. The set is 2.7 MB of JSON that
 * the first frame must not pay for, so it is fetched on first ask; these tests pin that the lazy
 * path yields exactly the set the eager copy holds, that asking twice fetches once, that a failure
 * is a sentence and a retry works, and that nothing in the running app imports the eager copy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Playbook } from "@/lib/playbooks";
import { PLAYBOOKS } from "@/lib/playbooks.shipped";

// The real fetch unless a test hands one in: a failed chunk load cannot be produced otherwise.
const fetcher = vi.hoisted(() => ({ next: null as null | (() => Promise<readonly Playbook[]>) }));
vi.mock("@/lib/playbooks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/playbooks")>();
  return { ...real, loadShipped: () => (fetcher.next ?? real.loadShipped)() };
});

import { usePlaybooks } from "./playbooks";

beforeEach(() => {
  usePlaybooks.setState({ items: null, problem: null });
  fetcher.next = null;
  vi.resetModules();
});

describe("loading", () => {
  it("starts as not here, which is not the same as none shipped", () => {
    expect(usePlaybooks.getState().items).toBeNull();
  });

  it("brings the same set the eager copy holds, in the same order", async () => {
    await usePlaybooks.getState().load();
    const items = usePlaybooks.getState().items!;
    expect(items.length).toBe(PLAYBOOKS.length);
    expect(items.map((p) => p.id)).toEqual(PLAYBOOKS.map((p) => p.id));
    expect(items[0]!.bench?.runAt).toBe(PLAYBOOKS[0]!.bench?.runAt);
  }, 30_000);

  it("carries the ranking's places, the same as the eager copy's (guard)", async () => {
    await usePlaybooks.getState().load();
    const places = (list: readonly Playbook[]) => list.map((p) => [p.id, p.rank?.position ?? null, p.rank?.unranked ?? null]);
    const items = usePlaybooks.getState().items!;
    expect(items.some((p) => p.rank?.position === 1)).toBe(true);
    expect(places(items)).toEqual(places(PLAYBOOKS));
  }, 30_000);

  it("fetches once however many ask at the same time, and not again once it is here", async () => {
    const a = usePlaybooks.getState().load();
    const b = usePlaybooks.getState().load();
    expect(a).toBe(b);
    await a;
    const first = usePlaybooks.getState().items;
    await usePlaybooks.getState().load();
    expect(usePlaybooks.getState().items).toBe(first);
  }, 30_000);
});

describe("a failed load", () => {
  it("is kept as a sentence, not thrown, and the set stays not-here", async () => {
    fetcher.next = () => Promise.reject(new Error("chunk offline"));
    await expect(usePlaybooks.getState().load()).resolves.toBeUndefined();
    expect(usePlaybooks.getState().problem).toBe("the playbooks could not be read: Error: chunk offline");
    expect(usePlaybooks.getState().items).toBeNull();
  });

  it("is retried by the next ask, which fetches again and clears the sentence", async () => {
    fetcher.next = () => Promise.reject(new Error("chunk offline"));
    await usePlaybooks.getState().load();
    const again = vi.fn(async () => PLAYBOOKS.slice(0, 2));
    fetcher.next = again;
    await usePlaybooks.getState().load();
    expect(again).toHaveBeenCalledTimes(1);
    expect(usePlaybooks.getState().items?.map((p) => p.id)).toEqual(PLAYBOOKS.slice(0, 2).map((p) => p.id));
    expect(usePlaybooks.getState().problem).toBeNull();
  });

  it("is no longer said while the retry is on its way, so the depth says it is loading", async () => {
    fetcher.next = () => Promise.reject(new Error("chunk offline"));
    await usePlaybooks.getState().load();
    let arrive: (items: readonly Playbook[]) => void = () => {};
    fetcher.next = () => new Promise((resolve) => (arrive = resolve));
    const retry = usePlaybooks.getState().load();
    expect(usePlaybooks.getState().problem).toBeNull();
    expect(usePlaybooks.getState().items).toBeNull();
    arrive(PLAYBOOKS.slice(0, 1));
    await retry;
    expect(usePlaybooks.getState().items).toHaveLength(1);
  });
});

describe("the eager copy stays out of the running app", () => {
  const root = path.join(__dirname, "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/fixtures\.tsx?$/.test(name)) {
        if (/from "[^"]*playbooks\.shipped"/.test(readFileSync(full, "utf8"))) {
          offenders.push(path.relative(root, full));
        }
      }
    }
  };

  it("is imported only by tests and fixtures", () => {
    walk(root);
    expect(offenders).toEqual([]);
  });
});
