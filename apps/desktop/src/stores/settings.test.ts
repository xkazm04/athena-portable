/**
 * The settings store, round-tripped against a mocked `invoke`.
 *
 * This is the test the first build could not have written: its panel called `invoke` from
 * wherever it needed to, so there was no seam to stand a fake behind, and the bug it shipped —
 * an `undefined` argument dropped by `JSON.stringify` at the IPC boundary — was found in a
 * running window. Here every call goes through `lib/ipc.ts`, so one mock of one module is the
 * whole of the shell as far as a store is concerned.
 *
 * What is asserted is the contract with Rust rather than the shape of the state: the four rows
 * are read under the keys `store.rs` describes, a value is written under the same key it is read
 * from, `null` reaches the wire as `null` — and `undefined` never does, because nothing in the
 * app can spell it.
 */
import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  return { rows, calls };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    harness.calls.push({ command, args });
    if (command === "store_path") return "C:\\fake\\athena.sqlite";
    const key = `${String(args.table)}/${String(args.key)}`;
    if (command === "store_get") return harness.rows.has(key) ? harness.rows.get(key) : null;
    if (command === "store_set") {
      harness.rows.set(key, args.value);
      return String(args.key);
    }
    if (command === "store_delete") {
      harness.rows.delete(key);
      return null;
    }
    throw new Error(`no fake for ${command}`);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

// The shell's two globals, as small as the store actually needs them: `hasShell` looks for the
// Tauri marker, `applyTheme` writes one attribute, and `system` resolves through a media query.
const painted = new Map<string, string>();
const systemIsLight = { value: false };

globalThis.document = {
  documentElement: {
    setAttribute: (name: string, value: string) => painted.set(name, value),
  },
} as unknown as Document;

globalThis.window = {
  __TAURI_INTERNALS__: {},
  matchMedia: () => ({
    get matches() {
      return systemIsLight.value;
    },
    addEventListener: () => {},
  }),
} as unknown as Window & typeof globalThis;

const { SETTING_KEYS } = await import("@/lib/store");
const { startSettings, useSettings, resolveTheme } = await import("@/stores/settings");

beforeEach(() => {
  harness.calls.length = 0;
});

test("a value written is the value read back, under the key store.rs describes", async () => {
  harness.rows.set("settings/engine", "codex");
  harness.rows.set("settings/theme", "light");
  harness.rows.set("settings/brain_path", "~/athena/brain");

  await startSettings();

  const state = useSettings.getState();
  expect(state.hydrated).toBe(true);
  expect(state.engine).toBe("codex");
  expect(state.theme).toBe("light");
  expect(state.brainPath).toBe("~/athena/brain");
  expect(state.activeProjectId).toBeNull();
  expect(state.storePath).toBe("C:\\fake\\athena.sqlite");

  // Every read named its table, and every key is one of the named set rather than a spelling
  // invented at the call site.
  const reads = harness.calls.filter((c) => c.command === "store_get");
  expect(reads).toHaveLength(5);
  const named: string[] = Object.values(SETTING_KEYS);
  for (const read of reads) {
    expect(read.args.table).toBe("settings");
    expect(named).toContain(read.args.key);
  }
  expect(painted.get("data-theme")).toBe("light");
});

test("writing the engine sends the value, not a patch object", async () => {
  await useSettings.getState().setEngine("claude_code");
  const write = harness.calls.find((c) => c.command === "store_set");
  expect(write?.args).toEqual({
    table: "settings",
    key: "engine",
    value: "claude_code",
  });
  expect(useSettings.getState().engine).toBe("claude_code");
  expect(harness.rows.get("settings/engine")).toBe("claude_code");
});

test("clearing the active project puts `null` on the wire, never a dropped argument", async () => {
  await useSettings.getState().setActiveProject("proj_abc");
  expect(harness.rows.get("settings/active_project_id")).toBe("proj_abc");

  await useSettings.getState().setActiveProject(null);
  const write = harness.calls.at(-1);
  expect(write?.command).toBe("store_set");
  expect(write?.args.value).toBeNull();
  expect("value" in (write?.args ?? {})).toBe(true);
  expect(useSettings.getState().activeProjectId).toBeNull();
});

test("the theme is painted before it is stored, and `system` resolves at the moment it is read", async () => {
  await useSettings.getState().setTheme("dark");
  expect(painted.get("data-theme")).toBe("dark");
  expect(harness.rows.get("settings/theme")).toBe("dark");

  systemIsLight.value = true;
  expect(resolveTheme("system")).toBe("light");
  await useSettings.getState().setTheme("system");
  expect(painted.get("data-theme")).toBe("light");
  // The *choice* is stored, not what it resolved to — or a theme chosen at noon would be wrong
  // at dusk.
  expect(harness.rows.get("settings/theme")).toBe("system");

  systemIsLight.value = false;
  expect(resolveTheme("system")).toBe("dark");
});
