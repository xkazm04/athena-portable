/** Tests for the Mind depth's view — README section 3.1 and 3.5, ADR 0029, 0085 and 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";

import { PATHS, fixtureIds, fixtures } from "./fixtures";
import { labeller } from "./live";
import MindView from "./view";

const go = () => {};
const html = (fixture: string, path: Path = PATHS.field!) =>
  renderToStaticMarkup(<MindView model={fixtures[fixture]!} path={path} go={go} />);

describe("every fixture renders at every level", () => {
  for (const id of fixtureIds) {
    for (const [name, path] of Object.entries(PATHS)) {
      it(`${id} at ${name}`, () => {
        expect(html(id, path).length).toBeGreaterThan(0);
      });
    }
  }
});

describe("the field", () => {
  const h = html("typical");

  it("offers the six instruments as buttons, each drawn and each with how it stands", () => {
    for (const name of ["Engine", "Brain", "Look", "Data", "Microphone", "Devices"]) {
      expect(h).toContain(`mind__instrument-name">${name}<`);
    }
    expect(h.match(/class="mind__instrument focus-ring"/g)).toHaveLength(6);
    expect(h.match(/class="glyph"/g)).toHaveLength(6);
  });

  it("sends Page and Voice to the depths that own them, and can show the welcome again", () => {
    expect(h).toContain("Go to Apps");
    expect(h).toContain("Go to Voice");
    expect(h).toContain("Show the welcome again");
  });

  it("keeps the module's own sentences, on each instrument and under attention in the marquee", () => {
    expect(h).toContain('title="Claude Code runs the turns, and is running now."');
    expect(h).toContain('title="Episodes, facts and playbooks are written to a folder of your own."');
    expect(html("empty")).toContain("Episodes go to Athena&#x27;s own folder.");
  });

  it("says what is wrong in the module's own words: a check that failed, a start that failed", () => {
    const failed = {
      ...fixtures.typical!,
      startFailure: {
        engine: "claude_code",
        title: "Athena could not start on Claude Code.",
        reason: "spawn failed",
        actionLabel: "Try again on Claude Code",
      },
    };
    const h2 = renderToStaticMarkup(<MindView model={failed} path={PATHS.field!} go={go} />);
    expect(h2).toContain("Athena could not start on Claude Code.");
    expect(h2).toContain("spawn failed");
    expect(h2).toContain("Try again on Claude Code");
    expect(html("engine-missing")).toContain("cannot run a turn yet");
  });

  it("never says the chosen engine runs the turns while the daemon is on another or failed on it", () => {
    // heavy: Codex is stored and found, the daemon still runs on Claude Code until the restart.
    const pending = html("heavy");
    expect(pending).not.toContain("Codex runs the turns");
    expect(pending).toContain('title="Codex is chosen, but Athena is still running on Claude Code."');
    const failed = renderToStaticMarkup(
      <MindView model={{ ...fixtures.typical!, daemonHealth: "failed" }} path={PATHS.field!} go={go} />,
    );
    expect(failed).not.toContain("runs the turns");
    expect(failed).toContain('title="Claude Code is chosen, but Athena could not start on it."');
  });

  it("says which rung of the voice failed, in the voice store's own reason, not that it is not installed", () => {
    const h = html("heavy");
    expect(h).not.toContain("Voice is not installed");
    expect(h).toContain("The daemon was started without a voice backend.");
    const bare = renderToStaticMarkup(
      <MindView model={{ ...fixtures.heavy!, voiceReason: "" }} path={PATHS.field!} go={go} />,
    );
    expect(bare).toContain("Voice is not set up yet.");
  });

  it("asks for the restart that is pending, on the field, because it asks to be done now", () => {
    expect(html("heavy")).toContain("Restart on");
  });

  it("draws that restart notice as the engine level draws it, one rendering of one notice", () => {
    const h = html("heavy");
    expect(h).toContain('class="engines__notice" role="status"');
    expect(h).not.toContain("mind__notice");
  });
});

describe("the engine", () => {
  it("is the shared engine section: each engine with its remedy, the chosen one marked, Check again", () => {
    const h = html("engine-missing", PATHS.engine);
    expect(h).toContain("could not find");
    expect(h).toContain("then press Check again");
    expect(h).toContain("Check again");
    expect(h).toMatch(/aria-pressed="true"/);
  });
});

describe("the look", () => {
  const h = html("typical", PATHS.look);
  it("holds the theme, the text size and the motion, with the old hints", () => {
    expect(h).toContain('aria-label="Theme"');
    expect(h).toContain('aria-label="Text size"');
    expect(h).toContain('aria-label="Motion"');
    expect(h).toContain("Follow the operating system");
  });
  it("previews each theme and says system follows the operating system", () => {
    expect(h.match(/class="theme-preview"/g)).toHaveLength(2);
    expect(h).toContain("System follows the operating system and switches when it does.");
  });
  it("shows the motion choice that is stored", () => {
    expect(html("calm", PATHS.look)).toMatch(/aria-checked="true"[^>]*>[^<]*calm/);
  });
});

describe("the brain, the data and the microphone", () => {
  it("the brain is a draft until committed, and says memory is markdown on disk", () => {
    const h = html("typical", PATHS.brain);
    expect(h).toContain('aria-label="Brain directory"');
    expect(h).toContain("Nothing has been typed that is not stored.");
    expect(h).toContain("Memory is markdown on disk");
  });
  it("the data names its file, or says in words that it is not known yet, never the shell's command name", () => {
    expect(html("typical", PATHS.data)).toContain("athena.sqlite");
    const unknown = html("empty", PATHS.data);
    expect(unknown).toContain("Not known yet: the app has not said where the file is.");
    expect(unknown).not.toContain("store_path");
  });
  it("the microphone asks once, and keeps the old words", () => {
    const h = html("empty", PATHS.mic);
    expect(h).toContain("Check the microphone");
    expect(html("typical", PATHS.mic)).toContain("Check again");
    expect(h).toContain("Asking here keeps the prompt out of a turn.");
  });
});

describe("the crumb's name for a level", () => {
  // live.tsx keeps its own copy of the names (the view is a lazy chunk it may not import), so the
  // crumb and the level's marquee are pinned to each other here.
  it("is the name the level's marquee shows, for every setting", () => {
    for (const [name, path] of Object.entries(PATHS)) {
      if (name === "field" || name === "missing") continue;
      const marquee = /mind__marquee--level">([^<]*)</.exec(html("typical", path))?.[1];
      expect(labeller(path), name).toBe(marquee);
    }
    expect(labeller(PATHS.missing!)).toBeUndefined();
  });
});

describe("a place that names nothing", () => {
  it("says so, with a way back", () => {
    const h = html("typical", PATHS.missing);
    expect(h).toContain("No such setting");
    expect(h).toContain("Back to all settings");
  });
});

describe("an instrument's badge carries the hue of how it stands", () => {
  it("is success when set, warning when it needs the person, and never neutral for those", () => {
    const ready = html("typical");
    expect(ready).toMatch(/status-dot--success[^>]*><\/span>set</);
    const missing = html("engine-missing");
    expect(missing).toMatch(/status-dot--warning[^>]*><\/span>needs you</);
  });
  it("leaves Look and Data neutral, which have no state to be good or bad", () => {
    const h = html("typical");
    expect(h).toMatch(/status-dot--neutral[^>]*><\/span>local</);
  });
});

describe("the Look tile names what its word is", () => {
  it("says which theme, not a bare system, light or dark", () => {
    for (const theme of ["system", "light", "dark"] as const) {
      const h = renderToStaticMarkup(<MindView model={{ ...fixtures.typical!, theme }} path={PATHS.field!} go={go} />);
      expect(h).toContain(`</span>${theme} theme<`);
    }
    expect(html("typical", PATHS.look!)).toContain("theme</p>");
  });
});
