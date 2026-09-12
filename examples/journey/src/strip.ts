/**
 * docs/demo.md section 1, "The surface on screen" — the strip the take injects over every page.
 *
 * This is the *surface's* own UI, the role the desktop panel plays, and it is deliberately not
 * part of any application: the runner injects it, the apps never see it, and when the shell is
 * ready to be driven the same script runs there with this file simply not used. So it lives in a
 * shadow root — the apps' CSS cannot reach into it and its own cannot leak out — at the very top
 * of the viewport, 56 px tall, dark, one line of text and a right-hand status.
 *
 * What it shows is exactly what a person needs to follow a turn: the command being typed, the
 * tool being called with a one-line rendering of its arguments, the decision card when a GATED
 * call is waiting, the fact when something is remembered, and a small tag when a connector rather
 * than a page is being reached. Nothing animates except the typing and a 150 ms fade on the
 * cards, because a demo where the chrome moves is a demo about the chrome.
 *
 * It is injected with `page.addInitScript`, which re-runs at document start on every navigation,
 * so the strip survives the take walking from Ledgerbox to Hirelane to TidyCRM. The *state* does
 * not survive — a new document is a new shadow root — which is why `Strip` keeps a mirror of the
 * presence line in Node and re-applies it after every move.
 */
import type { Page } from "@playwright/test";

/** What the strip is showing, as the runner asks for it. Every field is optional and merged. */
export interface StripState {
  /** The application the take is on, printed at the left as the surface's own label. */
  app?: string;
  /** The right-hand status: what Athena is attached to and what it offered. */
  presence?: string;
  /** The command line, as typed so far. */
  command?: string;
  /** `true` once Mira has "sent" it. */
  sent?: boolean;
  /** The tool being called, and a one-line rendering of its arguments. */
  tool?: string;
  args?: string;
  /** `mail` or `notes` when the call is going to a connector rather than to the page. */
  connector?: string | null;
  /** Athena's own line, when the beat is her speaking rather than her calling something. */
  say?: string | null;
}

/** The manifest a page just listed: the headline, and the names in their two classes. */
export interface StripManifest {
  /** `Ledgerbox · 23 capabilities` — the app and the count, as the surface listed them. */
  readonly question: string;
  readonly detail: string;
  readonly auto: readonly string[];
  readonly gated: readonly string[];
}

/** A decision card: the question a GATED call is waiting on, and the two answers. */
export interface StripCard {
  readonly title: string;
  readonly question: string;
  /** The tool and arguments the card is *for*, printed small under the question. */
  readonly detail: string;
}

const SOURCE = String.raw`(() => {
  "use strict";
  if (window.__athenaStrip) return;

  var HEIGHT = 56;
  var state = { app: "", presence: "", command: "", sent: false, tool: "", args: "", connector: null, say: null };
  var host = null;
  var root = null;
  var nodes = null;

  var CSS = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }",
    ".bar { position: fixed; inset: 0 0 auto 0; height: " + HEIGHT + "px; background: #0b0e14; color: #f2f4f8;",
    "  border-bottom: 1px solid #2b3446; display: flex; align-items: center; gap: 14px; padding: 0 16px;",
    "  font-size: 15px; line-height: 1.2; z-index: 2147483647; }",
    ".mark { font-weight: 700; letter-spacing: .04em; font-size: 13px; color: #8fd0ff; text-transform: uppercase; flex: none; }",
    ".app { font-size: 12px; color: #97a3b8; flex: none; letter-spacing: .04em; text-transform: uppercase; }",
    ".field { flex: 1 1 55%; min-width: 0; display: flex; align-items: center; gap: 10px; background: #151a24;",
    "  border: 1px solid #2b3446; border-radius: 8px; height: 34px; padding: 0 12px; overflow: hidden; }",
    ".chev { color: #8fd0ff; font-weight: 700; flex: none; }",
    ".text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px; color: #f2f4f8; }",
    ".text.dim { color: #7d8799; }",
    ".caret { display: inline-block; width: 8px; height: 17px; background: #8fd0ff; vertical-align: -3px; margin-left: 1px; }",
    ".sent { flex: none; font-size: 12px; color: #1f2a1c; background: #a6e77f; border-radius: 999px; padding: 3px 9px; font-weight: 700; }",
    ".call { flex: 0 1 auto; display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 34%; }",
    ".tool { font-family: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace; font-size: 13px; color: #ffd79a;",
    "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".tag { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #0b0e14; background: #8fd0ff;",
    "  border-radius: 4px; padding: 2px 7px; font-weight: 700; flex: none; }",
    ".status { flex: none; font-size: 13px; color: #b8c2d4; max-width: 22%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #a6e77f; margin-right: 7px; vertical-align: 0px; }",
    ".cards { position: fixed; top: " + (HEIGHT + 12) + "px; right: 16px; width: 400px; max-width: 42vw;",
    "  display: flex; flex-direction: column; gap: 10px; z-index: 2147483647; }",
    ".card { background: #0b0e14; color: #f2f4f8; border: 1px solid #33405a; border-left: 4px solid #ffd79a;",
    "  border-radius: 10px; padding: 12px 14px; font-size: 14px; opacity: 0; transition: opacity 150ms linear;",
    "  box-shadow: 0 8px 24px rgba(0,0,0,.45); }",
    ".card.in { opacity: 1; }",
    ".card .kind { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #ffd79a; font-weight: 700; margin-bottom: 6px; }",
    ".card.fact { border-left-color: #8fd0ff; }",
    ".card.fact .kind { color: #8fd0ff; }",
    ".card.manifest { border-left-color: #a6e77f; }",
    ".card.manifest .kind { color: #a6e77f; }",
    ".card .group { margin-top: 9px; }",
    ".card .group .head { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; font-weight: 700; color: #8aa0bd; }",
    ".card .group.gated .head { color: #ffd79a; }",
    ".card .group .names { margin-top: 3px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;",
    "  line-height: 1.5; color: #e4e9f2; word-break: break-word; }",
    ".card .group.gated .names { color: #ffd79a; }",
    ".card .q { font-size: 15px; line-height: 1.35; }",
    ".card .detail { margin-top: 6px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: #97a3b8;",
    "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".card .row { margin-top: 11px; display: flex; gap: 8px; }",
    ".btn { font-size: 13px; font-weight: 700; border-radius: 7px; padding: 6px 14px; border: 1px solid #33405a;",
    "  background: #151a24; color: #e4e9f2; }",
    ".btn.yes { background: #a6e77f; color: #16210f; border-color: #a6e77f; }",
    ".btn.no { background: #151a24; color: #e4e9f2; }",
    ".btn.pressed { outline: 3px solid #8fd0ff; outline-offset: 2px; }",
    ".card .answer { margin-top: 10px; font-size: 13px; font-weight: 700; }",
    ".card .answer.approved { color: #a6e77f; }",
    ".card .answer.declined { color: #ff9f9f; }"
  ].join("\n");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount() {
    if (host && host.isConnected) return true;
    if (!document.body) return false;
    host = document.createElement("athena-surface-strip");
    host.style.cssText = "all: initial; position: fixed; inset: 0 0 auto 0; height: 0; z-index: 2147483647;";
    root = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    var bar = el("div", "bar");
    var mark = el("span", "mark", "Athena");
    var app = el("span", "app", "");
    var field = el("div", "field");
    var chev = el("span", "chev", ">");
    var text = el("span", "text dim", "");
    var caret = el("span", "caret");
    caret.style.display = "none";
    var sent = el("span", "sent", "sent");
    sent.style.display = "none";
    field.appendChild(chev);
    field.appendChild(text);
    field.appendChild(caret);
    var call = el("div", "call");
    var tag = el("span", "tag", "");
    tag.style.display = "none";
    var tool = el("span", "tool", "");
    call.appendChild(tag);
    call.appendChild(tool);
    var status = el("div", "status", "");
    bar.appendChild(mark);
    bar.appendChild(app);
    bar.appendChild(field);
    bar.appendChild(sent);
    bar.appendChild(call);
    bar.appendChild(status);

    var cards = el("div", "cards");
    root.appendChild(bar);
    root.appendChild(cards);
    document.documentElement.appendChild(host);
    nodes = { app: app, text: text, caret: caret, sent: sent, tool: tool, tag: tag, status: status, cards: cards };
    render();
    return true;
  }

  function render() {
    if (!nodes) return;
    nodes.app.textContent = state.app || "";
    var line = state.say ? state.say : state.command;
    nodes.text.textContent = line || "waiting for a command";
    nodes.text.className = line ? "text" : "text dim";
    nodes.sent.style.display = state.sent ? "" : "none";
    nodes.tool.textContent = state.tool ? state.tool + (state.args ? "  " + state.args : "") : "";
    nodes.tag.style.display = state.connector ? "" : "none";
    nodes.tag.textContent = state.connector ? "connector: " + state.connector : "";
    nodes.status.innerHTML = "";
    if (state.presence) {
      nodes.status.appendChild(el("span", "dot"));
      nodes.status.appendChild(document.createTextNode(state.presence));
    }
  }

  function fadeIn(card) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { card.className = card.className + " in"; });
    });
  }

  var api = {
    ensure: function () { return mount(); },
    set: function (patch) {
      mount();
      for (var key in patch) state[key] = patch[key];
      render();
      return state;
    },
    read: function () { return state; },
    /** Type the text into the command field over the given milliseconds, one character at a time. */
    type: function (text, ms) {
      mount();
      state.say = null;
      state.sent = false;
      state.command = "";
      render();
      if (!nodes) return Promise.resolve();
      nodes.caret.style.display = "";
      var step = Math.max(12, Math.floor(ms / Math.max(1, text.length)));
      return new Promise(function (done) {
        var at = 0;
        var timer = setInterval(function () {
          at += 1;
          state.command = text.slice(0, at);
          render();
          if (at >= text.length) {
            clearInterval(timer);
            if (nodes) nodes.caret.style.display = "none";
            done(undefined);
          }
        }, step);
      });
    },
    send: function () { mount(); state.sent = true; render(); },
    /** A decision card. Returns its index so the runner can answer that one. */
    card: function (spec) {
      mount();
      if (!nodes) return -1;
      var card = el("div", "card " + (spec.kind || "decision"));
      var kind = spec.kind === "fact" ? "remembered" : spec.kind === "manifest" ? "manifest" : "decision";
      card.appendChild(el("div", "kind", kind));
      card.appendChild(el("div", "q", spec.question));
      if (spec.detail) card.appendChild(el("div", "detail", spec.detail));
      // A manifest card is the page's own list, in two groups: what the gate called ordinary and
      // what it called consequential, the second named tool by tool.
      var groups = spec.groups || [];
      for (var g = 0; g < groups.length; g += 1) {
        var group = el("div", "group " + (groups[g].gated ? "gated" : "auto"));
        group.appendChild(el("div", "head", groups[g].head));
        group.appendChild(el("div", "names", groups[g].names));
        card.appendChild(group);
      }
      if (spec.kind === "decision") {
        var row = el("div", "row");
        var yes = el("button", "btn yes", "Approve");
        var no = el("button", "btn no", "Decline");
        row.appendChild(yes);
        row.appendChild(no);
        card.appendChild(row);
        card.__yes = yes;
        card.__no = no;
      }
      nodes.cards.appendChild(card);
      fadeIn(card);
      return nodes.cards.children.length - 1;
    },
    /** Press one of the card's buttons, visibly, and print the answer under it. */
    answer: function (index, choice) {
      if (!nodes) return;
      var card = nodes.cards.children[index];
      if (!card) return;
      var button = choice === "approve" ? card.__yes : card.__no;
      if (button) button.className = button.className + " pressed";
      var answer = el("div", "answer " + (choice === "approve" ? "approved" : "declined"),
        choice === "approve" ? "Approved by Mira" : "Declined by Mira — recorded as user_denied");
      card.appendChild(answer);
    },
    /** What one card says on screen, so the runner can assert the picture and not its intent. */
    cardText: function (index) {
      if (!nodes) return "";
      var card = nodes.cards.children[index];
      return card ? card.textContent || "" : "";
    },
    /** Drop every card, after the 150 ms fade the stylesheet already declares. */
    clearCards: function () {
      if (!nodes) return Promise.resolve();
      var cards = nodes.cards;
      for (var i = 0; i < cards.children.length; i += 1) {
        cards.children[i].className = cards.children[i].className.replace(" in", "");
      }
      return new Promise(function (done) {
        setTimeout(function () { if (nodes) nodes.cards.innerHTML = ""; done(undefined); }, 180);
      });
    }
  };

  window.__athenaStrip = api;
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();`;

interface StripApi {
  ensure(): boolean;
  set(patch: StripState): StripState;
  read(): StripState;
  type(text: string, ms: number): Promise<void>;
  send(): void;
  card(spec: {
    kind: string;
    question: string;
    detail: string;
    groups?: readonly { head: string; names: string; gated: boolean }[];
  }): number;
  cardText(index: number): string;
  answer(index: number, choice: "approve" | "decline"): void;
  clearCards(): Promise<void>;
}

type WithStrip = Window & { __athenaStrip: StripApi };

/**
 * The strip, from Node.
 *
 * One instance for the whole take. It remembers the presence line and the app name because a
 * navigation throws the document — and therefore the shadow root — away, and the audience should
 * not watch the surface forget what it is attached to every time the take changes application.
 */
export class Strip {
  private presence = "";
  private app = "";

  constructor(private readonly page: Page) {}

  /** Add the strip at document start, for this page and every document it loads after. */
  static async install(page: Page): Promise<Strip> {
    await page.addInitScript({ content: SOURCE });
    return new Strip(page);
  }

  /** Put it back after a navigation, with the presence line it had before the move. */
  async reattach(): Promise<void> {
    await this.page.evaluate((source) => {
      if (!(window as unknown as { __athenaStrip?: unknown }).__athenaStrip) {
        const script = document.createElement("script");
        script.textContent = source;
        document.documentElement.appendChild(script);
        script.remove();
      }
      (window as unknown as WithStrip).__athenaStrip.ensure();
    }, SOURCE);
    await this.set({ app: this.app, presence: this.presence, command: "", sent: false, tool: "", args: "", connector: null, say: null });
  }

  async set(patch: StripState): Promise<void> {
    if (patch.presence !== undefined) this.presence = patch.presence;
    if (patch.app !== undefined) this.app = patch.app;
    await this.page.evaluate((next) => (window as unknown as WithStrip).__athenaStrip.set(next), patch);
  }

  /** Mira's line, typed into the command field over the length of her clip, then "sent". */
  async typeCommand(text: string, overMs: number): Promise<void> {
    await this.page.evaluate(
      ([line, ms]) => (window as unknown as WithStrip).__athenaStrip.type(line as string, ms as number),
      [text, Math.max(400, Math.round(overMs * 0.8))] as [string, number],
    );
    await this.page.evaluate(() => (window as unknown as WithStrip).__athenaStrip.send());
  }

  /** Athena speaking rather than calling: her line sits where the command was. */
  async say(line: string): Promise<void> {
    await this.set({ say: line, sent: false });
  }

  /** The tool this beat is calling, with a one-line rendering of its arguments. */
  async call(tool: string, args = "", connector: string | null = null): Promise<void> {
    await this.set({ tool, args, connector });
  }

  /** A decision card, waiting. The runner answers it after the clip, visibly. */
  async decision(card: StripCard): Promise<number> {
    return this.page.evaluate(
      (spec) => (window as unknown as WithStrip).__athenaStrip.card({ kind: "decision", question: spec.question, detail: spec.detail }),
      { question: card.question, detail: card.detail },
    );
  }

  async answer(index: number, choice: "approve" | "decline"): Promise<void> {
    await this.page.evaluate(
      ([at, pick]) => (window as unknown as WithStrip).__athenaStrip.answer(at as number, pick as "approve" | "decline"),
      [index, choice] as [number, "approve" | "decline"],
    );
  }

  /** "Remembered: Pinegrove Collective pays as PINEGROVE COOP", with what it cites. */
  async fact(claim: string, cites: string): Promise<void> {
    await this.page.evaluate(
      (spec) => (window as unknown as WithStrip).__athenaStrip.card({ kind: "fact", question: spec.question, detail: spec.detail }),
      { question: claim, detail: cites },
    );
  }

  /**
   * "Ledgerbox listed 23 capabilities", with the names in the two groups the gate put them in.
   *
   * The card is the manifest arriving, which is the only moment in the film where the audience can
   * see that the classes are the *page's* list read through the gate rather than a caption. So the
   * runner hands it the names it read off the surface and gets back what the card actually says,
   * and the take asserts on that text rather than on the numbers it meant to print.
   */
  async manifest(card: StripManifest): Promise<string> {
    const index = await this.page.evaluate(
      (spec) =>
        (window as unknown as WithStrip).__athenaStrip.card({
          kind: "manifest",
          question: spec.question,
          detail: spec.detail,
          groups: spec.groups,
        }),
      {
        question: card.question,
        detail: card.detail,
        groups: [
          { head: `AUTO · ${card.auto.length}`, names: card.auto.join("  "), gated: false },
          { head: `GATED · ${card.gated.length}`, names: card.gated.join("  "), gated: true },
        ],
      },
    );
    return this.page.evaluate((at) => (window as unknown as WithStrip).__athenaStrip.cardText(at), index);
  }

  async clearCards(): Promise<void> {
    await this.page.evaluate(() => (window as unknown as WithStrip).__athenaStrip.clearCards());
  }
}

/** `match_bank_line inv_0930 ← bl_00122` — arguments a person can read in one line. */
export function argLine(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? `[${value.length}]`
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
      return `${key}=${rendered.length > 42 ? `${rendered.slice(0, 42)}…` : rendered}`;
    })
    .join("  ");
}
