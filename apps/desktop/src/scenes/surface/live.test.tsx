/**
 * @vitest-environment jsdom
 *
 * The surface's live model, read from the stores — README section 3.1 and 3.5, ADR 0085 and 0087.
 *
 * What the fixtures cannot prove: that the Mind light says what the Setup module's own rule
 * (`engineFact`) says about the chosen engine. The light used to read "ready" off the probe alone,
 * so a daemon that failed on the engine, or still ran on the old one, read as ready on the surface
 * while the Mind depth one dive below said it was not.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDaemon } from "@/stores/daemon";
import { useEngines } from "@/stores/engines";
import { usePlaybooks } from "@/stores/playbooks";
import { useSettings } from "@/stores/settings";

import { useSurfaceModel } from "./live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** The live model's lights, written where the test can read them. */
function Probe() {
  return (
    <>
      {useSurfaceModel().lights.map((l) => (
        <p key={l.root} data-root={l.root} data-stat={l.stat} data-attention={String(l.attention)} />
      ))}
    </>
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // The shipped set is "here" and empty, so the surface asks for nothing on mount.
  usePlaybooks.setState({ items: [], problem: null });
  useSettings.setState({ engine: "claude_code" });
  useEngines.setState({
    probes: [{ id: "claude_code", state: "found", detail: "2.1.268" }],
    checking: false,
    problem: null,
  });
  useDaemon.setState({ engine: "claude_code", health: "ready", loaded: true, lastError: "", url: "http://x", token: "t" });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function lightOf(which: string) {
  act(() => root.render(<Probe />));
  const p = host.querySelector<HTMLElement>(`p[data-root="${which}"]`)!;
  return { stat: p.dataset.stat, attention: p.dataset.attention === "true" };
}
const mindLight = () => lightOf("mind");

describe("the Mind light stands the engine as the Mind depth does", () => {
  it("is ready only when the daemon is running on the chosen engine", () => {
    expect(mindLight()).toEqual({ stat: "Claude Code is ready", attention: false });
  });

  it("is not ready, and needs the person, when the daemon failed on the engine the probe found", () => {
    useDaemon.setState({ health: "failed", lastError: "spawn failed" });
    expect(mindLight()).toEqual({ stat: "Claude Code is not ready", attention: true });
  });

  it("is not ready yet while the daemon still runs on the engine chosen before", () => {
    useDaemon.setState({ engine: "codex" });
    expect(mindLight()).toEqual({ stat: "Claude Code is not ready yet", attention: false });
  });

  it("says the check failed, and needs the person, instead of checking for ever", () => {
    useEngines.setState({ probes: null, checking: false, problem: "GET /engines answered 500" });
    expect(mindLight()).toEqual({ stat: "the engine check failed", attention: true });
  });

  it("is checking while a check is in flight", () => {
    useEngines.setState({ probes: null, checking: true, problem: null });
    expect(mindLight()).toEqual({ stat: "checking the engine", attention: false });
  });
});

describe("the Chores light", () => {
  it("counts while the shipped set is on its way", () => {
    usePlaybooks.setState({ items: null, problem: null });
    expect(lightOf("chores").stat).toBe("counting…");
  });

  it("says it could not count when the shipped set failed to load, instead of counting for ever", () => {
    usePlaybooks.setState({ items: null, problem: "the playbooks could not be read: 404" });
    expect(lightOf("chores").stat).toBe("could not be counted");
  });
});
