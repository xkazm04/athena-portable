/**
 * A page-level CDP transport for when Playwright cannot attach to the browser.
 *
 * Playwright's `connectOverCDP` auto-attaches to every target and asserts that each carries a
 * `browserContextId`. A dev build of Athena (UI from the Vite server) runs a blob shared worker
 * that WebView2 reports without one, so the attach throws before any page is reachable (measured
 * 2026-10-23 with playwright-core 1.63 and 1.64). This module skips the browser session: it
 * reads `/json/list` and speaks CDP to each page target over that target's own WebSocket.
 *
 * It implements only what `AthenaDriver` uses: `url()`, `evaluate(fn | expression, arg)`,
 * `screenshot({ path })` and a small `locator(selector)` (`first`, `locator`, `count`,
 * `isVisible`, `getAttribute`, `click`, `fill`, `press`). Clicks and keys are real input
 * events (`Input.dispatchMouseEvent` at the element's centre, `Input.dispatchKeyEvent`), not
 * synthetic DOM events.
 */
import { writeFileSync } from "node:fs";

class Session {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 0;
    this.pending = new Map();
    this.ready = null;
    this.ws = null;
  }
  open() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`CDP socket failed: ${this.wsUrl}`));
      ws.onclose = () => {
        for (const { reject: r } of this.pending.values()) r(new Error("CDP socket closed"));
        this.pending.clear();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
        if (msg.id === undefined) return;
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ""}`));
        else waiter.resolve(msg.result);
      };
      this.ws = ws;
    });
    return this.ready;
  }
  async send(method, params = {}) {
    await this.open();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }
}

/** Resolve a selector chain (`[{ sel, nth }]`) to one element, in the page. */
const RESOLVE = `(chain) => {
  let scope = [document];
  for (const step of chain) {
    const found = scope.flatMap((s) => [...s.querySelectorAll(step.sel)]);
    scope = step.nth === null ? found : found.slice(step.nth, step.nth + 1);
  }
  return scope;
}`;

class RawLocator {
  constructor(page, chain) {
    this.page = page;
    this.chain = chain;
  }
  locator(sel) {
    return new RawLocator(this.page, [...this.chain, { sel, nth: null }]);
  }
  first() {
    const last = this.chain[this.chain.length - 1];
    return new RawLocator(this.page, [...this.chain.slice(0, -1), { ...last, nth: 0 }]);
  }
  #on(body, extra) {
    return this.page.evaluate(`((chain, extra) => { const els = (${RESOLVE})(chain); ${body} })(${JSON.stringify(this.chain)}, ${JSON.stringify(extra ?? null)})`);
  }
  count() {
    return this.#on("return els.length;");
  }
  isVisible() {
    return this.#on(`const el = els[0]; if (!el) return false;
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";`);
  }
  getAttribute(name) {
    return this.#on("const el = els[0]; return el ? el.getAttribute(extra) : null;", name);
  }
  /** Where to click, and whether the element would take the click there (Playwright's actionability). */
  async #point() {
    return this.#on(`const el = els[0]; if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true" || Boolean(el.closest("[inert]"));
      return { x, y, w: r.width, h: r.height, hit: Boolean(top && (top === el || el.contains(top))), disabled };`);
  }
  /**
   * A real click at the element's centre, once it is actionable: present, sized, enabled, the
   * topmost element at that point, and in the same place on two polls in a row (not animating).
   */
  async click({ timeout = 30_000 } = {}) {
    const end = Date.now() + timeout;
    let prev = null;
    let p = await this.#point();
    const ready = (a, b) => a && b && a.w > 0 && a.hit && !a.disabled && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
    while (!ready(p, prev) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 150));
      prev = p;
      p = await this.#point();
    }
    if (!p) throw new Error(`no element for ${JSON.stringify(this.chain)}`);
    if (!ready(p, prev)) throw new Error(`element never became actionable: ${JSON.stringify({ chain: this.chain, state: p })}`);
    const s = this.page.session;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await s.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    }
  }
  /** Set a field's value the way React sees typing: the native setter, then `input`. */
  async fill(value) {
    const ok = await this.#on(`const el = els[0]; if (!el) return false; el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, extra);
      el.dispatchEvent(new Event("input", { bubbles: true })); return true;`, value);
    if (!ok) throw new Error(`no field for ${JSON.stringify(this.chain)}`);
  }
  async press(key) {
    await this.#on("const el = els[0]; if (el) el.focus(); return Boolean(el);");
    const keys = { Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" } };
    const k = keys[key];
    if (!k) throw new Error(`press(${key}) is not supported by the raw transport`);
    const s = this.page.session;
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  }
}

class RawPage {
  constructor(target) {
    this.target = target;
    this.session = new Session(target.webSocketDebuggerUrl);
  }
  url() {
    return this.target.url;
  }
  /** `fn` with one JSON argument, or an expression string; the result comes back by value. */
  async evaluate(fn, arg) {
    const expression = typeof fn === "string" ? fn : `(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
    const r = await this.session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text ?? "evaluation failed");
    }
    return r.result?.value;
  }
  locator(sel) {
    return new RawLocator(this, [{ sel, nth: null }]);
  }
  async screenshot({ path }) {
    const r = await this.session.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(r.data, "base64"));
    return path;
  }
  close() {
    this.session.close();
  }
}

/** A Playwright-shaped connection over page targets only: `{ pages(), close() }`. */
export async function rawConnect(cdp) {
  const list = await (await fetch(`${cdp}/json/list`)).json();
  const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl).map((t) => new RawPage(t));
  return {
    transport: "raw",
    pages: () => pages,
    close: async () => {
      for (const p of pages) p.close();
    },
  };
}
