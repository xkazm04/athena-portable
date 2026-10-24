/**
 * @vitest-environment jsdom
 *
 * Her sleep on the Brain level - device-vitals, ADR 0143. Every state renders from a fixture
 * (reading, unreadable, an older daemon, never slept, idle with proposals, sleeping in a phase,
 * failed, partial, refused); the last block drives the real tree for the presses a static render
 * cannot show: a journal row opening, a contradiction asking which memory goes, Sleep now.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEVICES_NOW, PATHS, fixtures, sleepFixtures } from "./fixtures";
import SleepSection, { lastWords, pressureWords, stateLine, statsWords, type SleepModel, type SleepOpening } from "./sleep";
import MindView from "./view";

const render = (model: SleepModel, opening?: SleepOpening) => renderToStaticMarkup(<SleepSection model={model} opening={opening} />);
const html = (fixture: string, opening?: SleepOpening) => render(sleepFixtures[fixture]!, opening);
const count = (h: string, needle: string) => h.split(needle).length - 1;

describe("every state renders", () => {
  for (const id of Object.keys(sleepFixtures)) {
    it(id, () => {
      const h = html(id);
      if (id === "missing") expect(h).toBe("");
      else expect(h).toContain('aria-labelledby="mind-sleep"');
    });
  }

  it("on the Brain level, under the place she remembers, and nowhere else", () => {
    const brain = renderToStaticMarkup(<MindView model={fixtures.typical!} path={PATHS.brain!} go={() => {}} sleep={sleepFixtures.typical!} />);
    expect(brain).toContain("Where she remembers");
    expect(brain).toContain(">Sleep</h2>");
    expect(brain.indexOf("Where she remembers")).toBeLessThan(brain.indexOf(">Sleep</h2>"));
    const data = renderToStaticMarkup(<MindView model={fixtures.typical!} path={PATHS.data!} go={() => {}} sleep={sleepFixtures.typical!} />);
    expect(data).not.toContain("mind-sleep");
    // `null` leaves it out; absent, the live section reads her store (here, not yet read).
    const none = renderToStaticMarkup(<MindView model={fixtures.typical!} path={PATHS.brain!} go={() => {}} sleep={null} />);
    expect(none).not.toContain("mind-sleep");
    const live = renderToStaticMarkup(<MindView model={fixtures.typical!} path={PATHS.brain!} go={() => {}} />);
    expect(live).toContain("Reading how she sleeps");
  });
});

describe("reading and failing", () => {
  it("says it is reading, and says it could not read, as two different facts", () => {
    expect(html("loading")).toContain("Reading how she sleeps…");
    const failed = html("unreadable");
    expect(failed).toContain("Athena could not read how she sleeps.");
    expect(failed).toContain("the daemon did not answer");
    expect(failed).toContain(">Read again<");
    expect(failed).not.toContain('role="meter"');
  });

  it("keeps what it showed when a later read fails, with the problem above it", () => {
    const h = html("refused");
    expect(h).toContain("may be out of date");
    expect(h).toContain('role="meter"');
  });
});

describe("now", () => {
  it("gauges how near the next sleep is, in a meter with its figure, and says it in characters", () => {
    const h = html("typical");
    expect(h).toMatch(/role="meter" aria-label="How close her next sleep is" aria-valuemin="0" aria-valuemax="100" aria-valuenow="78" aria-valuetext="78%"/);
    expect(h).toContain("She has 31,000 characters of new conversation to sleep on, from 9 episodes; she sleeps at 40,000.");
    expect(h).toContain("She last slept 5 h ago.");
    expect(h).toContain("Not yet: 31,000 of the 40,000 characters she sleeps on have piled up.");
    expect(h).not.toContain("pressure_chars");
  });

  it("never slept: says so, what will make her sleep, and the daemon's reason she has not", () => {
    const h = html("never");
    expect(h).toContain("She has not slept yet.");
    expect(h).toContain("She sleeps by herself once enough new conversation has piled up");
    expect(h).toContain("Too little to sleep on yet: 1,200 characters, and she needs 2,000.");
    expect(h).toContain("No sleep yet, so nothing is written here.");
    expect(h).toContain("Nothing waits for you.");
    expect(h).not.toContain("Last sleep,");
  });

  it("asleep: the phase in words, the rail lit at it, and Sleep now disabled with the reason", () => {
    const h = html("sleeping");
    expect(h).toContain("Sleeping now: checking them against what she already knows.");
    expect(h).toMatch(/<li data-state="done">Distil<\/li><li data-state="now" aria-current="step">Merge<\/li><li data-state="next">Fade<\/li>/);
    expect(h).toContain('title="She is asleep now."');
    expect(h).toContain('data-state="sleeping"');
    // Only the button's reason (its title and its name): the verdict, which would only say she is
    // asleep, is not repeated under the state line that already says so.
    expect(count(h, "She is asleep now.")).toBe(2);
    expect(h).not.toContain("sleep__why");
    expect(h).toContain("Nothing new to sleep on yet; she sleeps at 40,000 characters.");
  });

  it("refused: the daemon's own sentence beside the button", () => {
    expect(html("refused")).toContain("Not on battery: she sleeps on mains power.");
  });
});

describe("the last sleep", () => {
  it("finished: when, why, and what it did, leaving out what is zero", () => {
    const h = html("typical");
    expect(h).toContain(
      "Last sleep, 5 h ago: finished, because enough had piled up. She read 12 episodes · wrote 4 facts, 1 procedure · confirmed 2 · replaced 1 · 1 disagreement · 1 offered to forget.",
    );
  });

  it("failed: says so in the error hue, with the reason the daemon gave", () => {
    const h = html("failed");
    expect(h).toContain("Her last sleep failed, 35 min ago.");
    expect(h).toMatch(/data-status="failed">Last sleep, 35 min ago: failed \(the merge step timed out after 300 s\)\./);
  });

  it("partial: what it read of what was waiting, and that the rest waits for the next", () => {
    expect(html("partial")).toContain("finished in part, because you asked. She read 120 of 310 episodes; the rest wait for the next");
  });

  it("puts a figure the stats leave out as not done, never as a guess", () => {
    expect(statsWords(null, "completed")).toBeNull();
    expect(statsWords({ episodes_in: 0 }, "completed")).toBeNull();
    expect(statsWords({ episodes_in: 1, facts_written: 1 }, "running")).toBe("read 1 episode · wrote 1 fact");
  });

  it("reads a reason it does not know as sent", () => {
    const cycle = sleepFixtures.typical!.state.cycles[0]!;
    expect(lastWords({ ...cycle, reason: "moon_phase", stats: null }, DEVICES_NOW)).toBe("Last sleep, 5 h ago: finished, because moon_phase.");
  });

  it("states and pressure, read alone", () => {
    const view = sleepFixtures.typical!.state.view!;
    expect(stateLine({ ...view, state: "sleeping", phase: null }, DEVICES_NOW)).toBe("Sleeping now: falling asleep.");
    expect(pressureWords({ ...view, episodes_waiting: 0 })).toBe("She has 31,000 characters of new conversation to sleep on; she sleeps at 40,000.");
    expect(pressureWords({ ...view, episodes_waiting: 1 })).toContain("from 1 episode;");
  });
});

describe("waiting for you", () => {
  it("lists the open proposals only, each with what it is about and the memories it names", () => {
    const h = html("typical");
    expect(h).toContain("Two memories disagree");
    expect(h).toContain("One says the invoices go out on Fridays; a newer one says Mondays.");
    expect(h).toMatch(/fct_00000000e001<\/code><\/span><span> and <code class="typo-code">fct_00000000e002/);
    expect(h).toContain("Forget this?");
    expect(h).toContain("not recalled in 34 days");
    expect(h).not.toContain("A proposal already kept");
    expect(h).toContain(">Keep both<");
    expect(h).toContain(">Forget one…<");
    expect(h).toContain(">Keep<");
    expect(h).toContain(">Forget<");
  });

  it("asks which one goes before a contradiction forgets anything", () => {
    const h = html("typical", { choosing: "prp_00000000d001" });
    expect(h).toContain('role="group" aria-label="Which one goes?"');
    expect(h).toContain(">Forget fct_00000000e001<");
    expect(h).toContain(">Forget fct_00000000e002<");
    expect(h).toContain(">Cancel<");
    expect(h).not.toContain(">Keep both<");
  });

  it("says an answer that was refused under its card", () => {
    const base = sleepFixtures.typical!;
    const h = render({ ...base, state: { ...base.state, errors: { prp_00000000d002: "Could not forget it: refused" } } });
    expect(h).toContain("Could not forget it: refused");
  });
});

describe("the journal", () => {
  it("lists each sleep closed: when, how it ended, what it did", () => {
    const h = html("typical");
    expect(h).toMatch(/class="sleep__row focus-ring" aria-expanded="false"/);
    expect(h).toContain(">finished<");
    expect(h).not.toContain("sleep__journal");
  });

  it("opens a row to the journal as written, text and never markup", () => {
    const h = html("typical", { journal: "cyc_00000000c001" });
    expect(h).toMatch(/aria-expanded="true" aria-controls="[^"]+"/);
    expect(h).toContain('<pre class="sleep__journal focus-ring" tabindex="0"');
    expect(h).toContain("# Sleep, 24 Oct 06:58\n\nRead 12 episodes (28,400 characters).");
  });

  it("says a journal still being written, one never written, one being read, and one that could not be read", () => {
    expect(html("sleeping", { journal: "cyc_00000000c004" })).toContain("She is still writing this one.");
    expect(html("failed", { journal: "cyc_00000000c003" })).toContain("No journal was written for this sleep.");
    expect(html("typical", { journal: "cyc_00000000c009" })).toBe(html("typical"));
    const reading = sleepFixtures.typical!;
    expect(render({ ...reading, state: { ...reading.state, journals: {} } }, { journal: "cyc_00000000c001" })).toContain("Reading the journal…");
    const failed = html("partial", { journal: "cyc_00000000c002" });
    expect(failed).toContain("The journal could not be read.");
    expect(failed).toContain("Could not read the journal: not found");
  });

  it("reads a running row the app closed on as stopped, never as still going", () => {
    const base = sleepFixtures.sleeping!;
    const live = base.state.cycles.find((c) => c.status === "running")!;
    // The daemon keeps a crashed cycle `running` as evidence; when she is not sleeping, it stopped.
    const idle: SleepModel = {
      ...base,
      state: { ...base.state, view: { ...base.state.view!, state: "idle", phase: null }, journals: { [live.id]: { status: "running", loading: false, problem: null, text: null } } },
    };
    const h = render(idle, { journal: live.id });
    expect(h).toContain(">stopped<");
    expect(h).not.toContain(">still going<");
    expect(h).toContain("She stopped before finishing this one: the app closed while she slept.");
    // While she sleeps, the newest running row is the sleep under way.
    expect(html("sleeping")).toContain(">still going<");
  });
});

describe("pressing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const spied = (fixture: string) => {
    const base = sleepFixtures[fixture]!;
    const actions = {
      load: vi.fn(async () => {}),
      readJournal: vi.fn(async () => {}),
      sleepNow: vi.fn(async () => {}),
      decide: vi.fn(async () => {}),
    };
    act(() => root.render(<SleepSection model={{ ...base, actions }} />));
    return actions;
  };
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;

  it("opens a journal row, reading it, and closes it again", () => {
    const actions = spied("typical");
    const row = host.querySelector<HTMLButtonElement>(".sleep__row")!;
    act(() => row.click());
    expect(actions.readJournal).toHaveBeenCalledWith("cyc_00000000c001");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".sleep__journal")?.textContent).toContain("Read 12 episodes");
    act(() => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(actions.readJournal).toHaveBeenCalledTimes(1);
  });

  it("keeps a contradiction whole, or asks which one goes and forgets only that one", () => {
    const actions = spied("typical");
    act(() => button("Keep both").click());
    expect(actions.decide).toHaveBeenLastCalledWith("prp_00000000d001", "keep", null);
    act(() => button("Forget one…").click());
    expect(host.textContent).toContain("Which one goes?");
    act(() => button("Cancel").click());
    expect(host.textContent).not.toContain("Which one goes?");
    act(() => button("Forget one…").click());
    act(() => button("Forget fct_00000000e002").click());
    expect(actions.decide).toHaveBeenLastCalledWith("prp_00000000d001", "forget", "fct_00000000e002");
    act(() => button("Forget").click());
    expect(actions.decide).toHaveBeenLastCalledWith("prp_00000000d002", "forget", null);
  });

  it("Sleep now asks; Read again reads", () => {
    const actions = spied("refused");
    act(() => button("Sleep now").click());
    expect(actions.sleepNow).toHaveBeenCalledTimes(1);
    act(() => button("Read again").click());
    expect(actions.load).toHaveBeenCalledTimes(1);
  });
});
