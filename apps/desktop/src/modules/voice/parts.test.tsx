/**
 * The pieces both Voice moods share — README section 3.1, ADR 0028: what an install says while it
 * runs, and a running install whose poll was refused, which shows the refusal and Check again
 * instead of a bar that no longer moves. Rendered to markup, so no DOM is needed.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { InstallState } from "@/lib/voice-setup";

import { installView } from "./model";
import { InstallBlock } from "./parts";

const RUNNING_STATE: InstallState = {
  component: "kokoro",
  state: "downloading_engine",
  received_bytes: 4 * 1024 * 1024,
  total_bytes: 10 * 1024 * 1024,
  error: null,
};
const RUNNING = installView(RUNNING_STATE);

const draw = (refusal: string | null) =>
  renderToStaticMarkup(
    <InstallBlock view={RUNNING} home={null} sizeMb={360} refusal={refusal} onInstall={() => {}} onCheck={() => {}} />,
  );

describe("a running install", () => {
  it("says why when a read of it failed", () => {
    expect(draw("the install state could not be read")).toContain("the install state could not be read");
  });

  it("says nothing extra while every read lands", () => {
    expect(draw(null)).not.toContain("vs-error");
  });

  it("is a progress bar with its value, and its live region carries the phase, not the moving figure", () => {
    const html = draw(null);
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="40"/);
    expect(html).toMatch(/role="progressbar"[^>]*aria-label="Downloading the engine"/);
    // Polled four times a second: a figure inside a polite live region is read out on every tick.
    const live = /<[^>]*aria-live="polite"[^>]*>(.*?)<\/span>/.exec(html);
    expect(live?.[1]).toBe("Downloading the engine");
    expect(html.match(/aria-live/g)).toHaveLength(1);
  });

  it("with no known total is a progress bar with no value", () => {
    const html = renderToStaticMarkup(
      <InstallBlock
        view={installView({ ...RUNNING_STATE, total_bytes: null })}
        home={null}
        sizeMb={null}
        refusal={null}
        onInstall={() => {}}
        onCheck={() => {}}
      />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuenow");
  });

  it("shows its progress while the poll answers", () => {
    const out = draw(null);
    expect(out).toContain("vs-progress");
    expect(out).not.toContain("Check again");
  });

  it("shows a refused poll and Check again, not a frozen bar", () => {
    const out = draw("the daemon is restarting");
    expect(out).not.toContain("vs-progress");
    expect(out).toContain("Lost track of the install: the daemon is restarting");
    expect(out).toContain("Check again");
    expect(out).toContain('role="alert"');
  });
});
