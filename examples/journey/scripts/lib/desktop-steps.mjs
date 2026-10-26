/**
 * The desktop recorder's beat vocabulary (docs/demo.md section 5.2), parsed and checked without a
 * running app, so `record-desktop.mjs --dry` refuses a script it could not play and the unit tests
 * hold the grammar.
 *
 * A step is a word, or `word:argument`. Each one says which of the app's two privileged pages it
 * acts on: `athena` is Athena's own window (`athena.html`: the composer, the decision cards, the
 * Record), `main` is the Main window's console (`chrome.html`: the depth stage and its finder).
 *
 *   type-command        athena  click the composer and type the beat's `command` (or its line)
 *   send                athena  press Enter in the composer
 *   approve | decline   athena  press the first card's button
 *   wait-decided        athena  wait for a card's stamp
 *   open-record         athena  press the Record button: the record of what ran
 *   surface             main    go to the surface (`#/`), Athena and the lights under her
 *   page:<origin>       main    go to the app's page shape (`#/apps/<origin>/page`), the live tab
 *   finder:<query>      main    Ctrl+K, type the query, Enter: the finder's own move
 *   pause:<ms>          -       wait, so a dive finishes before the next step
 *
 * A beat's `cue` (`card`, `decided`) is waited for before its steps, on Athena's window.
 */

export const STEPS = {
  'type-command': { page: 'athena', arg: false },
  send: { page: 'athena', arg: false },
  approve: { page: 'athena', arg: false },
  decline: { page: 'athena', arg: false },
  'wait-decided': { page: 'athena', arg: false },
  'open-record': { page: 'athena', arg: false },
  surface: { page: 'main', arg: false },
  page: { page: 'main', arg: true },
  finder: { page: 'main', arg: true },
  pause: { page: null, arg: true },
};

export const CUES = ['card', 'decided'];

/**
 * `"finder:Studio books"` -> `{ verb: 'finder', arg: 'Studio books', page: 'main' }`. Only the
 * first colon splits, so an origin's own colons stay in the argument. Throws on anything the
 * recorder could not perform.
 */
export function parseStep(step) {
  if (typeof step !== 'string' || step === '') throw new Error(`a desktop step is a non-empty string, not ${JSON.stringify(step)}`);
  const at = step.indexOf(':');
  const verb = at < 0 ? step : step.slice(0, at);
  const arg = at < 0 ? undefined : step.slice(at + 1);
  const spec = STEPS[verb];
  if (!spec) throw new Error(`unknown desktop step: ${step}`);
  if (spec.arg && (arg === undefined || arg.trim() === '')) throw new Error(`desktop step ${verb} needs an argument (${verb}:...)`);
  if (!spec.arg && arg !== undefined) throw new Error(`desktop step ${verb} takes no argument`);
  if (verb === 'pause' && !(Number(arg) > 0 && Number(arg) <= 30_000)) throw new Error(`pause takes 1 to 30000 ms, not ${arg}`);
  if (verb === 'page' && !/^https?:\/\/[^/\s]+$/.test(arg)) throw new Error(`page takes an origin such as http://localhost:3001, not ${arg}`);
  return { verb, arg, page: spec.page };
}

/** The depth hash a `surface` or `page:` step sets: the stage's own grammar (depth/model.ts formatHash). */
export function hashOf({ verb, arg }) {
  if (verb === 'surface') return '#/';
  if (verb === 'page') return `#/apps/${encodeURIComponent(arg)}/page`;
  throw new Error(`${verb} sets no hash`);
}

/** Every problem in the script's desktop acts, as lines; empty when the recorder can play them all. */
export function checkDesktopActs(acts) {
  const problems = [];
  for (const act of acts) {
    for (const beat of act.beats) {
      if (beat.cue !== undefined && !CUES.includes(beat.cue)) problems.push(`${beat.id}: unknown desktop cue ${beat.cue}`);
      for (const step of beat.do ?? []) {
        try {
          parseStep(step);
        } catch (err) {
          problems.push(`${beat.id}: ${err.message}`);
        }
      }
    }
  }
  return problems;
}

/**
 * A dev build of the app (its UI from the Vite server) runs a blob shared worker that WebView2
 * reports without a browser context, and Playwright's `connectOverCDP` then dies inside an event
 * handler instead of rejecting (apps/desktop/drive/README.md, "Two transports"). `/json/list`
 * shows it before attaching: this names the targets that give a dev build away.
 */
export function devBuildSigns(targets) {
  return (targets ?? []).filter(
    (t) => (t?.type === 'shared_worker' && String(t.url ?? '').startsWith('blob:')) || /^https?:\/\/(localhost|127\.0\.0\.1):1431\//.test(String(t?.url ?? '')),
  );
}
