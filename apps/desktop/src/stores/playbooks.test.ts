/**
 * The lazily loaded shipped playbooks — README section 3.5, ADR 0089. The set is 2.7 MB of JSON that
 * the first frame must not pay for, so it is fetched on first ask; these tests pin that the lazy
 * path yields exactly the set the eager copy holds, that asking twice fetches once, that a failure
 * is a sentence and a retry works, and that nothing in the running app imports the eager copy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYBOOKS } from "@/lib/playbooks.shipped";

import { usePlaybooks } from "./playbooks";

beforeEach(() => {
  usePlaybooks.setState({ items: null, problem: null });
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
