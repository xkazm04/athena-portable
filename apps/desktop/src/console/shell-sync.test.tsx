// @vitest-environment jsdom
/**
 * The shape seam end to end — README section 3.5, ADR 0088 and 0215. The depth is the one authority
 * over the window's shape: `depth/shape` sends it to Rust, Rust announces every selection back, and
 * the console's listener reconciles Rust to the depth instead of moving the depth. Here a fake shell
 * stands in for Rust: its `layout_select` resolves and then announces the shape it was sent, on a
 * later task, the way an event crosses the IPC after the command returns.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  heard: null as ((shape: string) => void) | null,
}));

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  hasShell: () => true,
  onLayoutChanged: (f: (shape: string) => void) => {
    ipc.heard = f;
    return Promise.resolve(() => {
      ipc.heard = null;
    });
  },
}));

import { INITIAL, type Path } from "@/depth/model";
import { startShapeSync } from "@/depth/shape";
import { useDepth } from "@/depth/store";
import { useTabs } from "@/stores/tabs";

import { useFollowShell } from "./follow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = "https://a.example.test";

function Probe() {
  useFollowShell();
  return null;
}

/** Run every pending task a bounded number of times: a ping-pong would otherwise never end. */
async function flushAll(ticks = 30) {
  for (let i = 0; i < ticks; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
}

/** Rust's stand-in: the select lands, and its announcement follows on a later task. */
const send = vi.fn<(id: string) => Promise<void>>((id) => {
  setTimeout(() => ipc.heard?.(id), 0);
  return Promise.resolve();
});

let root: Root | null = null;
let stopShape: () => void = () => {};

async function mount(at: Path) {
  useDepth.setState({ ...INITIAL, path: at });
  root = createRoot(document.createElement("div"));
  act(() => root?.render(<Probe />));
  await flushAll(2); // the listener is in place
  stopShape = startShapeSync(send);
  await flushAll(); // the opening select and its echo
  send.mockClear();
}

beforeEach(() => {
  useTabs.setState({
    tabs: [{ id: 1, label: "page-1", url: `${A}/`, title: "A", focused: true }],
    loaded: true,
  });
});

afterEach(() => {
  stopShape();
  act(() => root?.unmount());
  root = null;
  send.mockClear();
});

describe("the depth leads, Rust is reconciled", () => {
  it("ignores its own echoes: a page opened and left in one tick ends where the depth ended", async () => {
    await mount({ root: "apps" });
    useDepth.getState().go({ root: "apps", item: A, sub: { kind: "page" } });
    useDepth.getState().go({ root: "apps", item: A });
    await flushAll();
    expect(useDepth.getState().path).toEqual({ root: "apps", item: A });
    expect(send.mock.calls).toEqual([["page"], ["scene"]]);
  });

  it("answers an unsolicited disagreement by re-sending the depth's shape, not by moving the depth", async () => {
    await mount({ root: "mind", item: "engine" });
    act(() => ipc.heard?.("page"));
    await flushAll();
    expect(useDepth.getState().path).toEqual({ root: "mind", item: "engine" });
    expect(send.mock.calls).toEqual([["scene"]]);
  });
});
