// @vitest-environment jsdom
/**
 * `useFollowShell`'s subscription — README section 3.5, ADR 0088. The hook listens for Rust's
 * layout event the way every other listener in the app does: only where there is a shell, with a
 * failed listen said rather than left unhandled, and with a listener that arrives after the console
 * unmounted taken down at once instead of left running.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  shell: true,
  listen: vi.fn<(f: (shape: string) => void) => Promise<() => void>>(),
}));

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  hasShell: () => ipc.shell,
  onLayoutChanged: (f: (shape: string) => void) => ipc.listen(f),
}));

import { useFollowShell } from "./follow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useFollowShell();
  return null;
}

/** Mount the hook, run `between`, unmount. */
function mountAndUnmount(between: () => void = () => {}) {
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  between();
  act(() => root.unmount());
}

afterEach(() => {
  ipc.shell = true;
  ipc.listen.mockReset();
  vi.restoreAllMocks();
});

describe("listening for Rust's layout", () => {
  it("does not listen where there is no shell, so the preview harness raises nothing", () => {
    ipc.shell = false;
    mountAndUnmount();
    expect(ipc.listen).not.toHaveBeenCalled();
  });

  it("stops listening on unmount once the listener is in place", async () => {
    const unlisten = vi.fn();
    ipc.listen.mockResolvedValue(unlisten);
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
    await act(async () => {});
    act(() => root.unmount());
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("takes a listener down that arrives after the console unmounted", async () => {
    const unlisten = vi.fn();
    let arrive: (un: () => void) => void = () => {};
    ipc.listen.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    mountAndUnmount();
    arrive(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("says why when the listen fails, rather than leaving the rejection unhandled", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    ipc.listen.mockRejectedValue(new Error("no event plugin"));
    mountAndUnmount();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("no event plugin")));
  });
});
