/** Tests for the first act's view — README section 3.1, ADR 0085 and 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The face cards are offered only where WebGL2 can draw; this suite is about the act, not the machine.
vi.mock("@/avatar/support", () => ({ canDrawFace: () => true }));

import type { AvatarId } from "@/avatar/types";
import { INERT_ACTIONS, type SetupModel } from "@/modules/setup/model";
import { isReady, notReadyBecause } from "@/modules/setup/readiness";
import { fixtures as setup } from "@/modules/setup/fixtures";

import { INITIAL_STEPS, fixtureIds, fixtures } from "./fixtures";
import WakingView from "./view";

const html = (fixture: string, step?: 0 | 1 | 2 | 3, avatar?: AvatarId) =>
  renderToStaticMarkup(
    <WakingView
      model={fixtures[fixture]!}
      onLater={vi.fn()}
      initialStep={step ?? INITIAL_STEPS[fixture] ?? 0}
      avatar={avatar}
    />,
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
    const blocked = html("no-page", 3);
    expect(blocked).toContain("Wake her");
    expect(blocked).toContain("Open a page first");
    expect(blocked).toContain('disabled=""');
  });

  it("is open when an engine and a page are ready, with or without a microphone", () => {
    expect(html("ready", 3)).not.toContain("Open a page first");
    expect(html("no-mic", 3)).not.toContain("Open a page first");
    expect(html("no-mic", 2)).toContain("none on this machine");
  });

  it("lets the person look around first, from every step", () => {
    for (const step of [0, 1, 2, 3] as const) expect(html("ready", step)).toContain(">Later<");
  });
});

describe("the bell lights as the machine does", () => {
  it("draws four tendrils, one per thing, lit when done", () => {
    const ready = html("ready", 2);
    expect(ready.match(/class="bell__tendril"/g)).toHaveLength(4);
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

describe("a fact says only what is true of it", () => {
  it("a microphone nobody has asked about is not said to be checking", () => {
    const h = html("empty", 2);
    expect(h).toContain("not asked yet");
    expect(h).not.toContain("checking · not asked yet");
    expect(h).not.toMatch(/checking ·/);
  });
  it("an answered microphone keeps its badge", () => {
    expect(html("no-mic", 2)).toContain("not ready · none on this machine");
  });
});

describe("the way forward names the step, not a clipped question", () => {
  it("says Next and the next step's name", () => {
    expect(html("ready", 0)).toContain("Next: Reach");
    expect(html("ready", 1)).toContain("Next: Voice");
    expect(html("ready", 1)).not.toContain("do you want to talk to her");
    expect(html("ready", 2)).toContain("Next: Face");
    expect(html("ready", 2)).not.toContain("Wake her");
  });
});

describe("the face", () => {
  // The step is its own chunk (first paint, ADR 0095): the first render asks for it, then it is there.
  beforeAll(async () => {
    expect(html("ready", 3)).not.toContain("waking__faces");
    await import("./face-step");
    await import("@/avatar/Avatar");
    await new Promise((r) => setTimeout(r, 0));
  });

  it("is the fourth of four steps and asks how she will appear", () => {
    const h = html("ready", 3);
    expect(h).toContain("Step 4 of 4");
    expect(h).toContain("How will she appear?");
    expect(h).toContain('aria-label="Face"');
    expect(html("ready", 0)).toContain("Step 1 of 4");
  });

  it("offers the owl, the origami and the halo, each drawn as she would look", () => {
    const h = html("ready", 3);
    for (const name of ["Owl of light", "Origami", "Just the halo"]) expect(h).toContain(name);
    expect(h).toContain('data-avatar="b04-owl"');
    expect(h).toContain('data-avatar="d08-origami"');
    // the halo card is the Bell itself, and so is the act's own figure beside it
    expect(h.match(/class="bell"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(h).toContain("You can change this later in Voice.");
    // no face is drawn on any other step
    for (const step of [0, 1, 2] as const) expect(html("ready", step)).not.toContain("data-avatar=");
  });

  it("marks the stored choice, the halo when none was made, and lights the tendril only for a face", () => {
    const fresh = html("ready", 3);
    expect(fresh).toMatch(/aria-checked="true"[^>]*data-avatar-choice="halo"/);
    const owl = html("ready", 3, "b04-owl");
    expect(owl).toMatch(/aria-checked="true"[^>]*data-avatar-choice="b04-owl"/);
    expect(owl).toMatch(/aria-checked="false"[^>]*data-avatar-choice="halo"/);
    expect(owl.match(/data-lit="true"/g)!.length).toBe(fresh.match(/data-lit="true"/g)!.length + 1);
    expect(owl).toContain('aria-label="Face, done"');
  });
});

describe("the Voice step is a door to the studio", () => {
  const voice = (over: Partial<SetupModel>, onVoice?: () => void) =>
    renderToStaticMarkup(
      <WakingView model={{ ...fixtures.ready!, ...over }} onLater={vi.fn()} initialStep={2} onVoice={onVoice} />,
    );
  it("offers 'Set up her voice in the studio' while her voice is not available", () => {
    expect(voice({ voiceAvailable: false }, vi.fn())).toContain("Set up her voice in the studio");
  });
  it("offers nothing once her voice is available, or where no studio is wired (the preview)", () => {
    expect(voice({ voiceAvailable: true }, vi.fn())).not.toContain("Set up her voice in the studio");
    expect(voice({ voiceAvailable: false })).not.toContain("Set up her voice in the studio");
  });
});

describe("no opening step bypasses the gate (guard)", () => {
  it("with no initialStep, a model that is not ready never opens on an ungated Wake her", () => {
    for (const id of fixtureIds) {
      const h = renderToStaticMarkup(<WakingView model={fixtures[id]!} onLater={vi.fn()} />);
      if (h.includes(">Wake her<") && !isReady(fixtures[id]!)) {
        expect(h).toContain('disabled=""');
        expect(h).toContain(notReadyBecause(fixtures[id]!));
      }
    }
  });
});
