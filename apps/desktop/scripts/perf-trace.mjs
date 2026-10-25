/**
 * What a perf drive did, and when — README section 3.1, ADR 0089.
 *
 * The gate hands each drive a recording page instead of the raw one: every action the drive takes
 * (a click, a key, a hover, a fill, a wait for a selector, a query) is logged with its selector and
 * a timestamp before it is forwarded. The clock is the epoch in milliseconds at sub-millisecond
 * resolution (`performance.timeOrigin + performance.now()`), the same clock a page's long-task
 * `startTime` lands on once the page's own `timeOrigin` is added, so a long task can be tied to the
 * step it happened under. No drive is edited: the steps are the actions the drives already take.
 *
 * `attributeTasks` is pure, so the rule is tested without a browser.
 */

/** The step a task gets when it starts before the drive's first action. */
export const PAGE_LOAD = "before the first step (page load)";
/** The step a task gets when it ran in the quiet second after the drive returned. */
export const IDLE = "the idle second";

/** Calls that act on the page, or wait on it: each is a step. */
const ACTS = new Set([
  "click",
  "dblclick",
  "hover",
  "focus",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "selectOption",
  "tap",
  "waitFor",
  "waitForSelector",
  "$",
  "$$",
]);
/** Calls on a locator that narrow it: the result is recorded under the same selector. */
const NARROWS = new Set(["first", "last", "nth"]);

const clock = () => performance.timeOrigin + performance.now();

/**
 * Wrap a Playwright page so every action is recorded.
 *
 * @param {object} page    a Playwright page, or anything shaped like one
 * @param {() => number} [now]  the clock, epoch ms
 * @returns {{ page: object, actions: { t: number, kind: string, selector?: string, key?: string, what: string }[] }}
 *   `selector` for an action on an element (for a role, its name), `key` for a key; `what` is the
 *   step as a failure names it.
 */
export function recordingPage(page, now = clock) {
  const actions = [];
  let last = -Infinity;
  const log = (kind, selector, label = selector) => {
    // Monotonic even if the clock is coarse: a step never lands before the one it follows.
    last = Math.max(last, now());
    actions.push({ t: last, kind, selector, what: `${kind} ${label}` });
  };

  /** A locator or an element handle that records its actions under `selector`. */
  const target = (inner, selector, label) =>
    new Proxy(inner, {
      get(obj, name) {
        const value = Reflect.get(obj, name);
        if (typeof value !== "function" || typeof name !== "string") return value;
        if (ACTS.has(name))
          return (...args) => {
            log(name, selector, name === "press" || name === "fill" ? `${label} ${JSON.stringify(args[0])}` : label);
            return value.apply(obj, args);
          };
        if (NARROWS.has(name)) return (...args) => target(value.apply(obj, args), selector, label);
        if (name === "locator") return (sel, ...rest) => target(value.call(obj, sel, ...rest), `${selector} ${sel}`, `${label} ${sel}`);
        return value.bind(obj);
      },
    });

  /** The keyboard (each key is a step: `press Escape`) or the mouse (`mouse move 5,5`). */
  const device = (inner, kind) =>
    new Proxy(inner, {
      get(obj, name) {
        const value = Reflect.get(obj, name);
        if (typeof value !== "function" || typeof name !== "string") return value;
        return (...args) => {
          last = Math.max(last, now());
          if (kind === "keyboard") actions.push({ t: last, kind: name, key: String(args[0]), what: `${name} ${args[0]}` });
          else actions.push({ t: last, kind: "mouse", what: `mouse ${name} ${args.join(",")}` });
          return value.apply(obj, args);
        };
      },
    });

  const proxy = new Proxy(page, {
    get(obj, name) {
      const value = Reflect.get(obj, name);
      if (name === "keyboard" && value) return device(value, "keyboard");
      if (name === "mouse" && value) return device(value, "mouse");
      if (typeof value !== "function" || typeof name !== "string") return value;
      if (name === "$$")
        return async (selector, ...rest) => {
          log("query", selector);
          const found = await value.call(obj, selector, ...rest);
          return found.map((el, i) => target(el, selector, `${selector} #${i}`));
        };
      if (name === "$")
        return async (selector, ...rest) => {
          log("query", selector);
          const found = await value.call(obj, selector, ...rest);
          return found ? target(found, selector, selector) : found;
        };
      if (ACTS.has(name))
        return (selector, ...rest) => {
          log(name === "waitForSelector" ? "wait for" : name, selector, name === "fill" || name === "press" ? `${selector} ${JSON.stringify(rest[0])}` : selector);
          return value.call(obj, selector, ...rest);
        };
      if (name === "locator") return (selector, ...rest) => target(value.call(obj, selector, ...rest), selector, selector);
      if (name === "getByRole")
        return (role, options, ...rest) => {
          const named = options?.name === undefined ? "" : String(options.name);
          return target(value.call(obj, role, options, ...rest), named, `${role} "${named}"`);
        };
      if (name.startsWith("getBy"))
        return (text, ...rest) => target(value.call(obj, text, ...rest), String(text), `${name.slice(5).toLowerCase()} "${text}"`);
      return value.bind(obj);
    },
  });

  return { page: proxy, actions };
}

/**
 * Tie each long task to the drive step it happened under: the last action at or before its start,
 * with the offset from that action. A task before the first action is page load; a task marked
 * `idle` ran in the quiet second after the drive returned.
 *
 * @param {{ start: number, duration: number, idle?: boolean }[]} tasks  start on the page's clock
 * @param {{ t: number, what: string }[]} actions  in the order they were taken
 * @param {number} [timeOrigin]  the page's `performance.timeOrigin`, added to each start (0 when
 *                               the starts are already on the actions' clock)
 * @returns {{ duration: number, step: string, offset: number | null }[]}
 */
export function attributeTasks(tasks, actions, timeOrigin = 0) {
  return tasks.map((task) => {
    if (task.idle) return { duration: task.duration, step: IDLE, offset: null };
    const at = timeOrigin + task.start;
    let step = null;
    for (const a of actions) {
      if (a.t > at) break;
      step = a;
    }
    if (!step) return { duration: task.duration, step: PAGE_LOAD, offset: null };
    return { duration: task.duration, step: step.what, offset: Math.round(at - step.t) };
  });
}
