/**
 * Drive the real Athena desktop app from Node: launch an isolated instance or attach to a running
 * one, then work its UI the way a person does and read back what happened.
 *
 * The shell is Tauri on WebView2. Started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
 * --remote-debugging-port=<n>`, its two privileged webviews (`chrome.html`, the Main window's
 * chrome, and `athena.html`, the companion where the conversation lives) are CDP targets. A
 * browsed tab is not (uat/env.md: tabs run in a second WebView2 environment), so tabs are reached
 * through the shell's own commands from the chrome page: `tabs_list`, `bridge_list`/`bridge_call`
 * for the page's tools, and `hands_call` for DOM hands.
 *
 * What it never does:
 *  - return or log the daemon token (`status()` drops it, `daemon()` uses it inside the page);
 *  - touch a profile it did not create: `launch()` needs an exe built with its own identifier
 *    (`com.athena.portable.e2e` by default, see README.md), and `stop()` removes only that
 *    identifier's app data, and only when the launch created it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright-core";

import { rawConnect } from "./raw-cdp.mjs";

export const E2E_IDENTIFIER = "com.athena.portable.e2e";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns something truthy; the last error or value is in the timeout message. */
export async function waitFor(fn, { label = "condition", timeout = 15_000, every = 250 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  const why = last instanceof Error ? last.message : JSON.stringify(last);
  throw new Error(`timed out after ${timeout} ms waiting for ${label} (last: ${why})`);
}

/** A free loopback port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** `%APPDATA%\<identifier>` and `%LOCALAPPDATA%\<identifier>`: where a Tauri app keeps its data. */
export function appDataDirs(identifier) {
  const dirs = [];
  if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, identifier));
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, identifier));
  return dirs;
}

/** Kill a process tree. Windows: taskkill /T; elsewhere: the process group. */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/**
 * Launch an isolated Athena and attach to it.
 *
 * `exe` must be a build whose identifier is not the user's (`com.athena.portable`): that is what
 * keeps the store, brain, daemon token file and both WebView2 profiles apart from a running copy.
 * `fresh` (default true) refuses to start over existing app data for that identifier, unless
 * `reuse` is set, so a run never inherits another run's state silently.
 */
export async function launch({
  exe,
  identifier = E2E_IDENTIFIER,
  cdpPort,
  startUrl,
  env = {},
  reuse = false,
  bootTimeout = 120_000,
  detach = false,
} = {}) {
  if (!exe || !existsSync(exe)) throw new Error(`no Athena exe at ${exe}; build one (drive/README.md)`);
  if (identifier === "com.athena.portable") throw new Error("refusing to launch over the user's own identifier");
  const existing = appDataDirs(identifier).filter((d) => existsSync(d));
  if (existing.length && !reuse) {
    throw new Error(`app data already exists for ${identifier}: ${existing.join(", ")}; pass reuse or stop() the last run`);
  }
  const port = cdpPort ?? (await freePort());
  const args = startUrl ? [startUrl] : [];
  const child = spawn(exe, args, {
    env: {
      ...process.env,
      ...env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    // A detached instance outlives the CLI process that started it (drive.mjs launch).
    stdio: detach ? "ignore" : ["ignore", "pipe", "pipe"],
    detached: detach || process.platform !== "win32",
    windowsHide: false,
  });
  let output = "";
  const keep = (b) => {
    output = (output + b.toString()).slice(-20_000);
  };
  if (detach) child.unref();
  else {
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
  }
  let exited = null;
  child.on("exit", (code) => {
    exited = code ?? -1;
  });

  const cdp = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => {
      if (exited !== null) throw new Error(`Athena exited ${exited} before CDP came up:\n${output.slice(-2000)}`);
      const r = await fetch(`${cdp}/json/version`).catch(() => null);
      return r?.ok;
    },
    { label: "the CDP endpoint", timeout: bootTimeout, every: 500 },
  );
  const driver = await attach({ cdp, timeout: bootTimeout, transport: "playwright" });
  driver.process = { pid: child.pid, identifier, created: !existing.length, output: () => output, exited: () => exited };
  return driver;
}

/**
 * Attach to a running Athena whose WebView2 listens on `cdp` (e.g. `http://127.0.0.1:9222`).
 *
 * `transport` is `"raw"` by default: page-level CDP (raw-cdp.mjs), because a dev build's blob
 * shared worker makes Playwright's browser-level attach throw from inside an event handler, which
 * kills the process rather than rejecting. `"playwright"` uses `connectOverCDP` (`launch()` does:
 * its bundled build has no such worker). `ATHENA_DRIVE_TRANSPORT` overrides the default.
 */
export async function attach({ cdp = "http://127.0.0.1:9222", timeout = 30_000, transport = process.env.ATHENA_DRIVE_TRANSPORT ?? "raw" } = {}) {
  let conn;
  if (transport === "playwright") {
    const browser = await chromium.connectOverCDP(cdp);
    conn = { transport, pages: () => browser.contexts().flatMap((c) => c.pages()), close: () => browser.close() };
  } else conn = await rawConnect(cdp);
  const driver = new AthenaDriver(conn, cdp);
  await waitFor(() => driver.chrome && driver.athena, { label: "chrome.html and athena.html", timeout });
  return driver;
}

export class AthenaDriver {
  /** `conn` is `{ transport, pages(), close() }`: Playwright's pages, or raw-cdp.mjs's. */
  constructor(conn, cdp) {
    this.conn = conn;
    this.cdp = cdp;
    /** Set by `launch()`; `null` when attached to someone else's instance. */
    this.process = null;
  }

  pages() {
    return this.conn.pages();
  }
  #byUrl(fragment) {
    return this.pages().find((p) => p.url().includes(fragment));
  }
  /** The Main window's chrome (tab strip, scenes, the app register form). */
  get chrome() {
    return this.#byUrl("chrome.html");
  }
  /** The companion window: the conversation, the cards, the record. */
  get athena() {
    return this.#byUrl("athena.html");
  }

  /** A Tauri command, invoked from the chrome page (the privileged webview with every capability). */
  invoke(cmd, args = {}) {
    return this.chrome.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
  }

  /** The daemon's status without its token. */
  async status() {
    const s = await this.invoke("daemon_status");
    if (s && typeof s === "object") delete s.token;
    return s;
  }

  /** One daemon route, authenticated inside the page so the token never leaves it. */
  daemon(route, init = {}) {
    return this.chrome.evaluate(
      async ([r, i]) => {
        const s = await window.__TAURI_INTERNALS__.invoke("daemon_status");
        if (!s?.url) return { ok: false, reason: "no daemon url", status: s?.state };
        const res = await fetch(s.url + r, { ...i, headers: { ...(i.headers ?? {}), "X-Athena-Token": s.token } });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { ok: false, status: res.status, text: text.slice(0, 500) };
        }
      },
      [route, init],
    );
  }

  /** Wait for the daemon to answer `/health`. */
  async ready(timeout = 180_000) {
    return waitFor(
      async () => {
        const h = await this.daemon("/health");
        return h?.ok ? h : null;
      },
      { label: "the daemon's /health", timeout, every: 1000 },
    );
  }

  /** Skip the first-run wizard: `settings.onboarded = true`, then bring Main forward. */
  async onboard() {
    await this.invoke("store_set", { table: "settings", key: "onboarded", value: true });
    await this.invoke("athena_open_main").catch(() => undefined);
  }

  // ── apps and tabs ────────────────────────────────────────────────────────────────────────────

  /**
   * Register an app through the chrome's own form ("Address of the app to register", then Enter):
   * the origin is saved enabled and the tab opens, exactly as a person does it. Returns the tab.
   */
  async register(url) {
    const before = new Set((await this.tabs()).map((t) => t.id));
    const input = this.chrome.locator('input[aria-label="Address of the app to register"]');
    // A collapsed Main (the pill: a chrome webview a few pixels tall) shows no surface at all.
    // Bring it forward the way the shell's own "open Main" does.
    if ((await this.chrome.evaluate(() => innerHeight)) < 200) {
      await this.invoke("athena_open_main").catch(() => undefined);
      await waitFor(async () => (await this.chrome.evaluate(() => innerHeight)) >= 200, { label: "Main to open", timeout: 15_000 });
    }
    if (!(await input.isVisible().catch(() => false))) {
      // The form lives on the Apps scene: the surface's "Apps, ..." light opens it.
      await this.invoke("layout_select", { shape: "scene" }).catch(() => undefined);
      const apps = this.chrome.locator('button[aria-label^="Apps"]');
      await waitFor(() => apps.count(), { label: "the Apps light", timeout: 20_000 });
      await apps.first().click();
    }
    await waitFor(() => input.isVisible(), { label: "the register form", timeout: 20_000 });
    await input.fill(url);
    await input.press("Enter");
    const tab = await waitFor(async () => (await this.tabs()).find((t) => !before.has(t.id)), { label: `a tab for ${url}`, timeout: 30_000 });
    // The tab is listed before its webview's bridge answers ("no tab <id>"): wait for a list.
    await waitFor(
      async () => {
        const listed = await this.tools(tab.id);
        return listed?.ok === true;
      },
      { label: `tab ${tab.id}'s bridge`, timeout: 30_000, every: 500 },
    );
    return tab;
  }

  /** Open the companion's tab (`talk`, `record` or `origins`). */
  async athenaTab(name) {
    await this.showAthena();
    await this.athena.locator(`[data-tab="${name}"]`).first().click();
  }

  /**
   * The tool classes the Origins tab shows for `host` (e.g. `localhost:5191`): `{ enabled, tools:
   * { name: "AUTO" | "GATED" | ... } }`. Leaves the Origins tab open.
   */
  async origin(host) {
    await this.athenaTab("origins");
    return this.athena.evaluate((h) => {
      const region = document.querySelector('[aria-label="Origins"]');
      if (!region) return null;
      // "This page offers": each row is a class chip, the tool's short name in <b>, a description.
      // The list is paged; its footer ("showing N of M") is returned beside it.
      const tools = {};
      for (const li of region.querySelectorAll("ul.offers > li")) {
        const name = li.querySelector("b")?.textContent?.trim();
        const cls = /^(AUTO|GATED|READ)/.exec((li.textContent ?? "").trim())?.[1];
        if (name && cls) tools[name] = cls;
      }
      const footers = [...region.querySelectorAll("p.lg-foot")].map((p) => (p.textContent ?? "").trim()).filter(Boolean);
      const enable = region.querySelector(`button[aria-label="Enable ${h}"]`);
      const disable = region.querySelector(`button[aria-label="Disable ${h}"]`);
      return { host: h, enabled: Boolean(disable) && !enable, listed: Boolean(enable || disable), tools, footers };
    }, host);
  }

  /**
   * Trust `host` again with the tools its tabs list now (ADR 0100): press Disable, then Enable, in
   * the Origins tab. Enabling records the current contracts as accepted, which is the designed
   * way to accept tools that appeared after the app was first trusted.
   */
  async retrust(host) {
    await this.athenaTab("origins");
    const disable = this.athena.locator(`button[aria-label="Disable ${host}"]`);
    const enable = this.athena.locator(`button[aria-label="Enable ${host}"]`);
    if (await disable.count()) await disable.first().click();
    await waitFor(() => enable.count(), { label: `Enable ${host}`, timeout: 15_000 });
    await enable.first().click();
    await waitFor(() => disable.count(), { label: `${host} enabled`, timeout: 15_000 });
    return this.origin(host);
  }

  tabs() {
    return this.invoke("tabs_list");
  }
  focus(id) {
    return this.invoke("tabs_focus", { id });
  }
  /** What the tab's page registered on `document.modelContext`. */
  tools(tabId) {
    return this.invoke("bridge_list", { tab_id: tabId });
  }
  /** Call one of the page's own tools directly (the shell's relay, no model, no gate). */
  call(tabId, name, params = {}) {
    return this.invoke("bridge_call", { tab_id: tabId, name, params });
  }
  /** A DOM hand in the tab (`page_read`, `page_click`, `page_find`, ...), run by the shell. */
  hand(tabId, name, input = {}) {
    return this.invoke("hands_call", { tab_id: tabId, name, input });
  }

  // ── the conversation ─────────────────────────────────────────────────────────────────────────

  async showAthena() {
    await this.invoke("athena_show", { focus: false }).catch(() => undefined);
    const box = this.athena.locator('textarea[name="message"]');
    if (await box.isVisible().catch(() => false)) return;
    const talk = this.athena.locator('[data-tab="talk"]');
    // Card-forward ("waiting on you"): a decision is in front and that IS the view to read; the
    // ledger opens again once it is answered.
    if (!(await talk.count()) && (await this.athena.locator("article.slip").count())) return;
    // Collapsed to her seal: pressing it opens the ledger, where the conversation lives. (With
    // the ledger open the seal would put it away, so it is pressed only when there is no rail.)
    if (!(await talk.count())) {
      const seal = this.athena.locator(".aw-seal");
      if (await seal.count()) await seal.first().click();
    }
    await waitFor(() => talk.count(), { label: "her ledger", timeout: 15_000 });
    if ((await talk.first().getAttribute("aria-selected")) !== "true") await talk.first().click();
    await waitFor(() => box.isVisible(), { label: "the message box", timeout: 15_000 });
  }

  /** Every message in the conversation log, oldest first. */
  async transcript() {
    await this.showAthena();
    // The log's children in order: `.msg` rows (a `.msg-who` label, then the body), each turn's
    // "What ran" list as the sibling after Athena's message, cards and sheets.
    return await this.athena.evaluate(() => {
      const log = document.querySelector('[role="log"][aria-label="Conversation"]');
      const out = [];
      for (const el of log ? [...log.children] : []) {
        if (el.classList.contains("msg")) {
          const who = el.classList.contains("msg-you") ? "you" : el.classList.contains("msg-athena") ? "athena" : "other";
          const label = el.querySelector(".msg-who")?.textContent ?? "";
          const text = (el.textContent ?? "").slice(label.length).trim();
          out.push({ who, text, acts: [] });
        } else if (el.matches('ul.acts[aria-label="What ran"]') && out.length) {
          out[out.length - 1].acts.push(
            ...[...el.querySelectorAll("li")].map((li) => ({ text: (li.textContent ?? "").trim(), ok: li.getAttribute("data-ok") })),
          );
        }
      }
      return out;
    });
  }

  /** Whether a turn is running (the stop control is up). */
  busy() {
    return this.athena.locator('[data-act="stop"]').count().then((n) => n > 0);
  }

  /** The conversation's visible errors. */
  errors() {
    return this.athena.evaluate(() => [...document.querySelectorAll(".msg-error")].map((e) => (e.textContent ?? "").trim()));
  }

  /**
   * Type a message into "Message Athena" and send it. With `wait` (default), resolve once the
   * turn is over: the stop control is gone and Athena has said something after this message, or a
   * card is waiting on the user. Returns `{ reply, cards, errors }`.
   */
  async say(text, { wait = true, timeout = 300_000 } = {}) {
    await this.showAthena();
    const before = (await this.transcript()).length;
    const box = this.athena.locator('textarea[name="message"]');
    await waitFor(() => box.isVisible(), { label: "the message box", timeout: 20_000 });
    await box.fill(text);
    await box.press("Enter");
    if (!wait) return null;
    await waitFor(() => this.transcript().then((t) => t.length > before), { label: "the message in the log", timeout: 20_000 });
    return this.settle({ after: before, timeout });
  }

  /** Wait until the running turn is over (see `say`). */
  async settle({ after = 0, timeout = 300_000 } = {}) {
    await waitFor(
      async () => {
        const [busy, cards, t, errors] = await Promise.all([this.busy(), this.cards(), this.transcript(), this.errors()]);
        const pending = cards.filter((c) => c.pending);
        const said = t.slice(after).some((m) => m.who === "athena" && m.text.length > 0);
        return (!busy && (said || pending.length || errors.length)) || (pending.length && !busy);
      },
      { label: "the turn to settle", timeout, every: 1000 },
    );
    const t = await this.transcript();
    const reply = t.slice(after).filter((m) => m.who === "athena").at(-1) ?? null;
    return { reply, messages: t.slice(after), cards: await this.cards(), errors: await this.errors() };
  }

  /**
   * Every decision on screen: single cards (`article.slip[data-card]`, id = the card id) and batch
   * sheets (`article.slip[data-sheet]`, id = `sheet:<data-sheet>`), with `decision` absent while
   * pending. `waiting` is the ledger's "and N more waiting" count beyond the ones shown.
   */
  async cards() {
    await this.showAthena();
    return await this.athena.evaluate(() =>
      [...document.querySelectorAll("article.slip[data-card], article.slip[data-sheet]")].map((a) => ({
        id: a.hasAttribute("data-card") ? a.getAttribute("data-card") : `sheet:${a.getAttribute("data-sheet")}`,
        kind: a.hasAttribute("data-card") ? "card" : "sheet",
        label: a.getAttribute("aria-label") ?? "",
        decision: a.getAttribute("data-decision") ?? undefined,
        pending: /waiting on you/.test(a.getAttribute("aria-label") ?? "") && !a.getAttribute("data-decision"),
        text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
      })),
    );
  }

  #slip(id) {
    return id.startsWith("sheet:")
      ? this.athena.locator(`article.slip[data-sheet="${id.slice("sheet:".length)}"]`)
      : this.athena.locator(`article.slip[data-card="${id}"]`);
  }

  async #decide(id, act) {
    const slip = this.#slip(id);
    await waitFor(() => slip.count(), { label: `${id} on screen`, timeout: 15_000 });
    // In the ledger a slip carries its own buttons; in the card-forward view ("waiting on you")
    // the one slip shown is answered by the window's Approve/Decline, outside the article.
    const own = slip.locator(`[data-act="${act}"]`);
    const button = (await own.count()) ? own.first() : this.athena.locator(`button[data-act="${act}"]`).first();
    // Answered: the slip is stamped, leaves the ledger (a sheet is replaced by its rows' results),
    // or the button reads "Sending…" (aria-busy) while the daemon confirms.
    const answered = async () =>
      (await slip.count()) === 0 ||
      Boolean(await slip.getAttribute("data-decision")) ||
      !/waiting on you/.test((await slip.getAttribute("aria-label")) ?? "") ||
      (await button.getAttribute("aria-busy")) === "true";
    // A click that lands just as a card arrives can be dropped: the companion's machine ignores a
    // decision while it still holds the previous one or has not counted the new card yet
    // (companion/machine.ts, "decide"). Pressing again is safe for the same reason (an answer
    // already taken makes every later press a no-op), so press until it takes, up to 60 s.
    const end = Date.now() + 60_000;
    for (;;) {
      await button.click();
      const took = await waitFor(answered, { label: `${id} to be ${act}d`, timeout: 5_000 }).catch(() => false);
      if (took) break;
      if (Date.now() > end) throw new Error(`${id} was never ${act}d after repeated presses`);
    }
    // Then wait for the stamp itself (or the slip leaving).
    await waitFor(
      async () => (await slip.count()) === 0 || Boolean(await slip.getAttribute("data-decision")) || !/waiting on you/.test((await slip.getAttribute("aria-label")) ?? ""),
      { label: `${id} to be ${act}d`, timeout: 30_000 },
    );
  }
  /** Press the card's own Approve button. */
  approve(id) {
    return this.#decide(id, "approve");
  }
  /** Press the card's own Decline button. */
  decline(id) {
    return this.#decide(id, "decline");
  }

  /** A PNG of one of the two privileged webviews (`chrome` or `athena`). */
  async shot(which, path) {
    const page = which === "athena" ? this.athena : this.chrome;
    await page.screenshot({ path });
    return path;
  }

  /** Disconnect; with `stop`, also kill the instance this driver launched and remove its data. */
  async close({ stop = false } = {}) {
    await Promise.resolve(this.conn.close()).catch(() => undefined);
    if (stop && this.process) stopInstance(this.process);
  }
}

/** Kill a launched instance's tree and remove the app data it created. */
export function stopInstance({ pid, identifier, created }) {
  killTree(pid);
  if (created && identifier && identifier !== "com.athena.portable") {
    // WebView2's processes release their profile a moment after the tree is killed, so a removal
    // right away can meet a locked file: retry for up to 15 s.
    for (const d of appDataDirs(identifier)) {
      for (let i = 0; i < 30 && existsSync(d); i++) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"]);
        }
      }
    }
  }
}
