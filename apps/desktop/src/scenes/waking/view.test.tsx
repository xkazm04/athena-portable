/** Tests for the first act's view — README section 3.1, ADR 0085 and 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { INERT_ACTIONS } from "@/modules/setup/model";
import { fixtures as setup } from "@/modules/setup/fixtures";

import { INITIAL_STEPS, fixtureIds, fixtures } from "./fixtures";
import WakingView from "./view";

const html = (fixture: string, step?: 0 | 1 | 2) =>
  renderToStaticMarkup(
    <WakingView model={fixtures[fixture]!} onLater={vi.fn()} initialStep={step ?? INITIAL_STEPS[fixture] ?? 0} />,
  );

describe("every fixture renders", () => {
  for (const id of fixtureIds) {
    it(id, () => {
      expect(html(id)).toContain("waking__ask");
    });
  }
});

describe("the mind", () => {
  it("offers each engine with the probe's own remedy, and marks the chosen one", () => {
    const h = html("ready", 0);
    expect(h).toContain("What will she think with?");
    expect(h).toContain("Claude Code is ready.");
    expect(h).toMatch(/data-chosen="true"/);
  });

  it("says plainly what to do when the engine is missing", () => {
    const h = html("engine-missing", 0);
    expect(h).toContain("could not find");
    expect(h).toContain("then press Check again");
  });

  it("can check again, and says it is checking while it does", () => {
    expect(html("ready", 0)).toContain("Check again");
    expect(html("checking", 0)).toContain("Checking…");
  });
});

describe("the reach", () => {
  it("asks for the first app's address and says whether one is open", () => {
    const h = html("no-page", 1);
    expect(h).toContain("Where will she work?");
    expect(h).toContain("Address of an app");
    expect(h).toContain("none open yet");
    expect(html("ready", 1)).toContain("open on");
  });
});

describe("waking her", () => {
  it("is gated by readiness and says why when it is not ready", () => {
    const blocked = html("no-page", 2);
    expect(blocked).toContain("Wake her");
    expect(blocked).toContain("Open a page first");
    expect(blocked).toContain('disabled=""');
  });

  it("is open when an engine and a page are ready, with or without a microphone", () => {
    expect(html("ready", 2)).not.toContain("Open a page first");
    expect(html("no-mic", 2)).not.toContain("Open a page first");
    expect(html("no-mic", 2)).toContain("none on this machine");
  });

  it("lets the person look around first, from every step", () => {
    for (const step of [0, 1, 2] as const) expect(html("ready", step)).toContain(">Later<");
  });
});

describe("the bell lights as the machine does", () => {
  it("draws three tendrils, one per thing, lit when done", () => {
    const ready = html("ready", 2);
    expect(ready.match(/class="bell__tendril"/g)).toHaveLength(3);
    expect(ready.match(/data-lit="true"/g)!.length).toBeGreaterThanOrEqual(2);
    const bare = renderToStaticMarkup(
      <WakingView
        model={{ ...setup.empty!, actions: INERT_ACTIONS }}
        onLater={() => {}}
      />,
    );
    expect(bare.match(/data-lit="true"/g)).toBeNull();
    expect(bare).toContain("She has no mind yet.");
  });
});

describe("the steps say what is done in more than a colour", () => {
  it("marks a done step with a check and names it done to a screen reader", () => {
    const h = html("ready", 0);
    expect(h).toContain('aria-label="Mind, done"');
    expect(h).toContain('aria-label="Reach, done"');
    expect(h).toContain(">✓<");
  });
  it("keeps the number and the plain name while a step is not done", () => {
    const h = html("engine-missing", 0);
    expect(h).toContain('aria-label="Mind"');
    expect(h).toMatch(/waking__step-n" aria-hidden="true">1</);
  });
});
