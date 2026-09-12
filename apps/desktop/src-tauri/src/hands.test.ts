/**
 * @vitest-environment jsdom
 *
 * The nine generic hands, driven the way the relay drives them — README section 3.4 tier 2.
 *
 * `hands.rs` is the catalogue and the wire and is tested by `cargo test`. This is the other half:
 * the script that runs in the page's main world, exercised through the one interface it has, which
 * is `postMessage` in and `postMessage` out. Nothing here imports a function — the script is
 * evaluated exactly as the shell injects it, because a hand that works when imported and not when
 * injected is a hand that works nowhere.
 *
 * jsdom populates neither `origin` nor `source` on a delivered message, and `hands.js` refuses a
 * message that has the wrong value for either. So requests are dispatched as a synthetic
 * `MessageEvent` with both set, exactly as `packages/athena-bridge/test/inject.test.js` does for
 * the same reason — and the two guards get their own test with the values deliberately wrong.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "hands.js"),
  "utf8",
);

const NS = "athena-hands";
/** jsdom serves the document from its own URL; the script compares against exactly that. */
const ORIGIN = () => window.location.origin;

const PAGE = `<h1>Overdue invoices</h1>
  <p>Three invoices are past thirty days.</p>
  <form id="chase">
    <label for="note">Chase note</label>
    <input id="note" name="note" type="text" placeholder="Chase note">
    <select id="tone"><option value="f">Friendly</option><option value="s">Firm</option></select>
    <button type="button" id="send">Send chase</button>
    <button type="button" id="off" disabled>Void invoice</button>
  </form>
  <div hidden><button id="ghost">Hidden button</button></div>`;

interface Match {
  ref: string;
  role: string;
  label: string;
  disabled: boolean;
}

interface Answer {
  ok: boolean;
  output?: string;
  reason?: string;
  error?: string;
  matches?: Match[];
  total?: number;
}

let seq = 0;
let clicks = 0;

function ask(hand: string, input: Record<string, unknown> = {}): Promise<Answer> {
  const id = `t:${++seq}`;
  return new Promise((resolve) => {
    const onReply = (event: MessageEvent) => {
      const message = event.data as Record<string, unknown> | null;
      if (!message || message.__ns !== NS || message.dir !== "to-ext" || message.id !== id) return;
      window.removeEventListener("message", onReply);
      resolve(message as unknown as Answer);
    };
    window.addEventListener("message", onReply);
    send({ __ns: NS, dir: "to-page", id, hand, input });
  });
}

/** One request, with the two fields jsdom leaves empty filled in. */
function send(data: unknown, from: { origin?: string; source?: unknown } = {}): void {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data,
      origin: from.origin ?? ORIGIN(),
      source: ("source" in from ? from.source : window) as MessageEventSource | null,
    }),
  );
}

beforeAll(() => {
  // jsdom does no layout, so every element measures zero and `shown()` would reject all of them.
  // A hidden subtree still measures zero, which is the distinction the script actually asks about.
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const hidden = Boolean(this.closest("[hidden]"));
    const box = { width: hidden ? 0 : 100, height: hidden ? 0 : 20, x: 0, y: 0 };
    return { ...box, top: 0, left: 0, right: box.width, bottom: box.height, toJSON: () => box };
  } as Element["getBoundingClientRect"];
  // jsdom has no layout, so it has no scrolling either. Both are no-ops here; in a webview they
  // are what brings a control into view before it is pressed.
  Element.prototype.scrollIntoView = () => {};
  window.scrollBy = () => {};

  // Evaluated exactly once, because vitest shares one window across a file and the script adds a
  // message listener each time it runs. Two installed copies answer every request twice, each out
  // of its own ref map, and the caller resolves on whichever replied first — which is a test that
  // fails for a reason that has nothing to do with the hands.
  window.eval(SCRIPT);
});

beforeEach(() => {
  seq = 0;
  clicks = 0;
  // A fresh document rather than a fresh script. Refs the previous test minted now name detached
  // elements, which is exactly what they would be after a real re-render.
  document.body.innerHTML = PAGE;
  document.getElementById("send")?.addEventListener("click", () => {
    clicks += 1;
  });
});

// --- reading ------------------------------------------------------------------------------------

describe("reading", () => {
  it("returns the page as text, without the markup", async () => {
    const answer = await ask("page_read");

    expect(answer.ok).toBe(true);
    expect(answer.output).toContain("Three invoices are past thirty days.");
    expect(answer.output).not.toContain("<p>");
  });

  it("bounds a long page and says what it left out", async () => {
    document.body.innerHTML = `<p>${"word ".repeat(2000)}</p>`;
    const answer = await ask("page_read");

    expect(answer.output).toMatch(/\(showing 4000 of \d+\)$/);
  });

  it("finds operable elements by the label a person would read", async () => {
    const answer = await ask("page_find", { query: "chase" });

    expect(answer.ok).toBe(true);
    const labels = (answer.matches ?? []).map((m) => m.label);
    expect(labels).toContain("Send chase");
    expect(labels).toContain("Chase note");
  });

  it("filters by role", async () => {
    const answer = await ask("page_find", { role: "select" });

    expect(answer.matches).toHaveLength(1);
    // Not "Friendly Firm": a select's descendants are its options, not its name.
    expect(answer.matches?.[0].label).toBe("tone");
  });

  it("does not offer a hidden control", async () => {
    // A model cannot press what a person cannot see, and offering it is how a turn wastes a round.
    const answer = await ask("page_find", { query: "hidden" });

    expect(answer.matches).toEqual([]);
  });

  it("marks a disabled control rather than hiding it", async () => {
    const answer = await ask("page_find", { query: "void" });

    expect(answer.matches?.[0].disabled).toBe(true);
  });
});

// --- acting -------------------------------------------------------------------------------------

describe("acting", () => {
  const refFor = async (query: string, role?: string) => {
    const found = await ask("page_find", role ? { query, role } : { query });
    return found.matches?.[0]?.ref ?? "";
  };

  it("clicks the element a ref names", async () => {
    const answer = await ask("page_click", { ref: await refFor("send chase") });

    expect(answer.ok).toBe(true);
    expect(clicks).toBe(1);
  });

  it("refuses a disabled control rather than clicking nothing", async () => {
    const answer = await ask("page_click", { ref: await refFor("void") });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("validator_failed");
  });

  it("fills a field and tells the application it changed", async () => {
    // The events are the point: a framework-rendered field that is assigned to and not told is a
    // field whose application still holds the old value, so the page looks filled and submits empty.
    const seen: string[] = [];
    document.getElementById("note")?.addEventListener("input", () => seen.push("input"));
    document.getElementById("note")?.addEventListener("change", () => seen.push("change"));

    const answer = await ask("page_fill", {
      ref: await refFor("chase note"),
      value: "Thirty days, gently.",
    });

    expect(answer.ok).toBe(true);
    expect((document.getElementById("note") as HTMLInputElement).value).toBe("Thirty days, gently.");
    expect(seen).toEqual(["input", "change"]);
  });

  it("selects an option by its visible label", async () => {
    const answer = await ask("page_select", { ref: await refFor("", "select"), value: "Firm" });

    expect(answer.ok).toBe(true);
    expect((document.getElementById("tone") as HTMLSelectElement).value).toBe("s");
  });

  it("names the options it does have when the one asked for is not there", async () => {
    const answer = await ask("page_select", { ref: await refFor("", "select"), value: "Furious" });

    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("Friendly");
  });

  it("scrolls to a ref, and by a screen without one", async () => {
    const toRef = await ask("page_scroll", { ref: await refFor("send chase") });
    const byScreen = await ask("page_scroll", { direction: "down" });

    expect(toRef.ok).toBe(true);
    expect(byScreen.ok).toBe(true);
    expect(byScreen.output).toContain("down");
  });

  it("submits the form a ref sits in", async () => {
    let submitted = 0;
    document.getElementById("chase")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });

    const answer = await ask("page_submit", { ref: await refFor("chase note") });

    expect(answer.ok).toBe(true);
    expect(submitted).toBe(1);
  });
});

// --- refs ---------------------------------------------------------------------------------------

describe("refs", () => {
  it("refuses a ref it never minted", async () => {
    const answer = await ask("page_click", { ref: "ref_0_deadbeefcafe" });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("unknown_ref");
  });

  it("refuses anything that is not a ref at all", async () => {
    // Which is what stops a model composing a selector: there is no spelling that works.
    const answer = await ask("page_click", { ref: "#send" });

    expect(answer.reason).toBe("unknown_ref");
  });

  it("retires every ref when the page navigates", async () => {
    // A single-page application replaces the document with no load event. A ref that survived
    // would name whatever element now sits where the old one was, and the hand would act on the
    // wrong row.
    const found = await ask("page_find", { query: "send chase" });
    const ref = found.matches?.[0].ref ?? "";
    history.pushState({}, "", "/elsewhere");

    const answer = await ask("page_click", { ref });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("unknown_ref");
    expect(answer.error).toContain("page that has been left");
  });

  it("refuses a ref whose element has left the document", async () => {
    const found = await ask("page_find", { query: "send chase" });
    document.getElementById("send")?.remove();

    const answer = await ask("page_click", { ref: found.matches?.[0].ref ?? "" });

    expect(answer.reason).toBe("unknown_ref");
    expect(answer.error).toContain("no longer in the document");
  });

  it("hands back the same ref for the same element", async () => {
    const first = await ask("page_find", { query: "send chase" });
    const second = await ask("page_find", { query: "send" });

    expect(second.matches?.[0].ref).toBe(first.matches?.[0].ref);
  });
});

// --- waiting ------------------------------------------------------------------------------------

describe("waiting", () => {
  it("returns at once when the text is already there", async () => {
    const answer = await ask("page_wait", { text: "past thirty days", timeout_ms: 500 });

    expect(answer.ok).toBe(true);
  });

  it("times out with a reason rather than hanging", async () => {
    const answer = await ask("page_wait", { text: "nothing like this", timeout_ms: 200 });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("timeout");
  });
});

// --- the guards ---------------------------------------------------------------------------------

describe("what it will not answer", () => {
  it("ignores a message from a frame and one from another origin", async () => {
    const replies: unknown[] = [];
    window.addEventListener("message", (event) => {
      const m = event.data as Record<string, unknown>;
      if (m && m.__ns === NS && m.dir === "to-ext") replies.push(m);
    });

    send({ __ns: NS, dir: "to-page", id: "f1", hand: "page_read", input: {} }, { source: null });
    send(
      { __ns: NS, dir: "to-page", id: "f2", hand: "page_read", input: {} },
      { origin: "https://evil.example" },
    );
    await new Promise((done) => setTimeout(done, 30));

    expect(replies).toEqual([]);
  });

  it("ignores a message that is not ours", async () => {
    const replies: unknown[] = [];
    window.addEventListener("message", (event) => {
      const m = event.data as Record<string, unknown>;
      if (m && m.__ns === NS && m.dir === "to-ext") replies.push(m);
    });

    send({ __ns: "athena-webmcp", dir: "to-page", id: "x", type: "list" });
    await new Promise((done) => setTimeout(done, 30));

    expect(replies).toEqual([]);
  });

  it("answers an unknown hand rather than staying silent", async () => {
    // Silence would leave the relay holding a pending entry until its timer, and a panel spinning
    // on a call nobody remembers making.
    const answer = await ask("page_teleport");

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("unknown_ref");
  });

  it("declares the eight names the Rust half declares", async () => {
    const installed = (window as unknown as { __athenaHands: { names: string[] } }).__athenaHands;

    expect(installed.names.sort()).toEqual([
      "page_click",
      "page_fill",
      "page_find",
      "page_read",
      "page_scroll",
      "page_select",
      "page_submit",
      "page_wait",
    ]);
  });
});
