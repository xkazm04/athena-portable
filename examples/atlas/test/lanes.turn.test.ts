/**
 * THE STORY'S ONE TRANSITION AUTHORITY — `turnReduce` in `archify-lanes/turn.ts`.
 *
 * The guided story is three facts (stop, story, playing) and an `epoch`, and eight doors move them:
 * the TURN toggle, the view bus, `set_turn`, the story bar's play / step / chapter, the editorial
 * script rail, an opened run and the clock's tick. Each door used to re-state the rules by hand;
 * these cases pin them once. Cases 2, 3 and 5's first half are guards (today's behaviour, kept);
 * case 1 (a stale tick) and case 5's second half (reduced motion reads as playing) were live
 * defects.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BEAT_VIEWS, CHAPTER_VIEWS } from "../components/atlas/variants/archify-lanes/story";
import {
  playingNow,
  turnRead,
  turnReduce,
  turnTool,
  type StoryAction,
  type StoryState,
} from "../components/atlas/variants/archify-lanes/turn";

const MOVING = { reduced: false };
const STILL = { reduced: true };
const N = BEAT_VIEWS.length;

test("case 1: a manual step while playing restarts the beat, and a tick from before it is dropped", () => {
  const e = 4;
  const stepped = turnReduce({ stop: 3, story: true, playing: true, epoch: e }, { type: "step", to: 5 }, MOVING);
  assert.deepEqual(stepped, { stop: 5, story: true, playing: true, epoch: e + 1 });
  assert.equal(turnReduce(stepped, { type: "tick", epoch: e }, MOVING), stepped, "a stale tick moved the stop");
  assert.equal(turnReduce(stepped, { type: "tick", epoch: e + 1 }, MOVING).stop, 6);
});

test("case 2: the TURN toggle shows or hides the trail and always stops the clock", () => {
  const on = turnReduce({ stop: 0, story: false, playing: false, epoch: 0 }, { type: "toggle" }, MOVING);
  assert.equal(on.story, true);
  assert.equal(on.playing, false);
  const off = turnReduce({ stop: 2, story: true, playing: true, epoch: 0 }, { type: "toggle" }, MOVING);
  assert.equal(off.story, false);
  assert.equal(off.playing, false);
});

test("case 3: the view bus turns the story on or off, and off stops the clock", () => {
  const playing: StoryState = { stop: 7, story: true, playing: true, epoch: 1 };
  const lanes = turnReduce(playing, { type: "view", id: "lanes" }, MOVING);
  assert.equal(lanes.story, false);
  assert.equal(lanes.playing, false);
  const turn = turnReduce(lanes, { type: "view", id: "turn" }, MOVING);
  assert.equal(turn.story, true);
  assert.equal(turn.stop, 7);
});

test("case 4: set_turn is one action — tell=false stops the clock, a fractional stop is refused and moves nothing", () => {
  const playing: StoryState = { stop: 2, story: true, playing: true, epoch: 3 };
  const off = turnReduce(playing, { type: "tool", stop: "12", tell: false }, MOVING);
  assert.equal(off.stop, 11);
  assert.equal(off.story, false);
  assert.equal(off.playing, false);

  assert.deepEqual(turnTool(playing, 2.5, undefined), {
    ok: false,
    error: "No stop 2.5. The turn has 12 stops, numbered from 1.",
  });
  assert.equal(turnReduce(playing, { type: "tool", stop: 2.5 }, MOVING), playing, "a refused stop changed state");
});

test("case 5: under reduced motion play steps instead, and nothing reads as playing", () => {
  const stepped = turnReduce({ stop: 3, story: true, playing: false, epoch: 0 }, { type: "play" }, STILL);
  assert.equal(stepped.stop, 4);
  assert.equal(stepped.playing, false);

  const held: StoryState = { stop: 3, story: true, playing: true, epoch: 0 };
  assert.equal(playingNow(held, STILL), false, "reduced motion has stopped the clock");
  assert.equal(playingNow(held, MOVING), true);
  assert.equal(turnRead(held.stop, held.story, playingNow(held, STILL)).playing, false);
  /* And a tick that slipped through under reduced motion does not move the stop. */
  assert.equal(turnReduce(held, { type: "tick", epoch: 0 }, STILL), held);
});

test("case 6: steps wrap, a chapter lands on its first stop, a picked stop turns the story on", () => {
  const at0: StoryState = { stop: 0, story: true, playing: false, epoch: 0 };
  assert.equal(turnReduce(at0, { type: "step", to: -1 }, MOVING).stop, N - 1);
  assert.equal(turnReduce(at0, { type: "step", to: N }, MOVING).stop, 0);
  const ch = turnReduce(at0, { type: "chapter", index: 2 }, MOVING);
  assert.equal(ch.stop, CHAPTER_VIEWS[2]!.from);
  assert.equal(ch.epoch, 1);
  const picked = turnReduce({ stop: 0, story: false, playing: false, epoch: 0 }, { type: "pick", index: 4 }, MOVING);
  assert.equal(picked.story, true);
  assert.equal(picked.stop, 4);
});

test("case 6b: opening a run with the story on moves the stop to the first stop it carries", () => {
  const on = turnReduce({ stop: 2, story: true, playing: false, epoch: 0 }, { type: "run", id: "e-class" }, MOVING);
  assert.equal(on.stop, 6);
  assert.equal(on.epoch, 1);
  const off: StoryState = { stop: 2, story: false, playing: false, epoch: 0 };
  assert.equal(turnReduce(off, { type: "run", id: "e-class" }, MOVING).stop, 2);
  const unwalked: StoryState = { stop: 2, story: true, playing: true, epoch: 0 };
  assert.equal(turnReduce(unwalked, { type: "run", id: "e-approval" }, MOVING).stop, 2);
});

test("case 8: every action from every seed keeps 0 <= stop < 12, playing implies story, and a hand move bumps epoch", () => {
  const seeds: StoryState[] = [
    { stop: 0, story: false, playing: false, epoch: 0 },
    { stop: 0, story: true, playing: false, epoch: 1 },
    { stop: 0, story: true, playing: true, epoch: 2 },
    { stop: 5, story: false, playing: false, epoch: 3 },
    { stop: 5, story: true, playing: true, epoch: 4 },
    { stop: N - 1, story: true, playing: true, epoch: 5 },
    { stop: N - 1, story: false, playing: false, epoch: 6 },
    { stop: N - 1, story: true, playing: false, epoch: 7 },
  ];
  const actions = (s: StoryState): StoryAction[] => [
    { type: "toggle" },
    { type: "view", id: "lanes" },
    { type: "view", id: "turn" },
    { type: "tool", stop: 1 },
    { type: "tool", stop: 12, tell: true },
    { type: "tool", stop: 6, tell: false },
    { type: "tool", stop: 0 },
    { type: "play" },
    { type: "step", to: s.stop + 1 },
    { type: "step", to: s.stop - 1 },
    { type: "step", to: 40 },
    { type: "chapter", index: 0 },
    { type: "chapter", index: CHAPTER_VIEWS.length - 1 },
    { type: "chapter", index: 99 },
    { type: "pick", index: 3 },
    { type: "pick", index: -2 },
    { type: "run", id: "e-class" },
    { type: "run", id: "e-up" },
    { type: "run", id: "no-such-run" },
    { type: "tick", epoch: s.epoch },
    { type: "tick", epoch: s.epoch - 1 },
  ];
  let checked = 0;
  for (const env of [MOVING, STILL]) {
    for (const seed of seeds) {
      for (const action of actions(seed)) {
        const next = turnReduce(seed, action, env);
        const what = `${JSON.stringify(action)} from ${JSON.stringify(seed)} (reduced ${env.reduced})`;
        assert.ok(Number.isInteger(next.stop) && next.stop >= 0 && next.stop < N, `stop out of range: ${what}`);
        assert.ok(!next.playing || next.story, `playing without the story: ${what}`);
        if (action.type !== "tick" && next.stop !== seed.stop) {
          assert.equal(next.epoch, seed.epoch + 1, `a hand move kept the epoch: ${what}`);
        }
        if (action.type === "tick") assert.equal(next.epoch, seed.epoch, `a tick moved the epoch: ${what}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 8 * 20, `only ${checked} transitions checked`);
});
