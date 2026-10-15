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

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

    expect(answer.output).toMatch(/\(showing \d+ of 9999\)$/);
    expect(answer.output?.split("\n")[0]).toMatch(/^cursor: cur_\d+_\d+_\d+ /);
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

  it("reaches content when asked for a structural role, and reads one part of it", async () => {
    // Without this a `page_read` can only be the whole document, because refs come from
    // `page_find` and `page_find` only offered controls. A real remittance page puts the row a
    // model wants and a footnote that contradicts it on the same page.
    document.body.innerHTML = `<table><tbody>
      <tr><td>Halden Studio</td><td>LB-2026-0901</td></tr>
      <tr><td>Marlow &amp; Vine</td><td>MV-88213</td></tr>
    </tbody></table><p>LB-2026-0900 is scheduled for April.</p>`;

    const rows = await ask("page_find", { role: "tr", query: "halden" });
    expect(rows.matches).toHaveLength(1);

    const read = await ask("page_read", { ref: rows.matches![0].ref });

    expect(read.output).toContain("LB-2026-0901");
    expect(read.output, "the footnote is on the page but not in this row").not.toContain("LB-2026-0900");
  });

  it("still answers controls when no role is given", async () => {
    // A bare `page_find` means "what can I do here", and forty table rows is not that.
    const answer = await ask("page_find", {});
    const roles = new Set((answer.matches ?? []).map((m) => m.role));

    expect(roles.has("tr")).toBe(false);
    expect(roles.has("button")).toBe(true);
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

// --- continuing a long read (ADR 0102) ----------------------------------------------------------

describe("continuing", () => {
  /** The lane's per-result cut (`RESULT_CAP`, `turn_frame.py`). A packet over it loses its tail. */
  const LANE_CAP = 1600;
  const CURSOR = /^cursor: (cur_\d+_\d+_\d+) /;

  /** The cursor a packet's first line names, or null on the last packet. */
  const cursorIn = (answer: Answer) => CURSOR.exec(answer.output ?? "")?.[1] ?? null;

  /** Every packet of one read, following cursors until the last; each is checked on the way. */
  async function follow(hand: string, input: Record<string, unknown>): Promise<Answer[]> {
    const packets: Answer[] = [];
    let answer = await ask(hand, input);
    for (;;) {
      expect(answer.ok, answer.error).toBe(true);
      expect((answer.output ?? "").length).toBeLessThanOrEqual(LANE_CAP);
      expect(answer.output).toMatch(/\n\(showing \d+ of \d+\)$/);
      packets.push(answer);
      const cursor = cursorIn(answer);
      if (!cursor) return packets;
      expect(packets.length, "a read that never ends").toBeLessThan(50);
      answer = await ask(hand, { cursor });
    }
  }

  /** A body: the packet without its first line and its footer. */
  const bodyOf = (answer: Answer) => (answer.output ?? "").split("\n").slice(1, -1).join("\n");

  const controls = (n: number) =>
    Array.from({ length: n }, (_, i) => `<button type="button">Approve invoice ${String(i + 1).padStart(2, "0")}</button>`).join("");

  it("hands back every one of 45 matches across cursors, each once, with a live ref", async () => {
    document.body.innerHTML = controls(45);

    const packets = await follow("page_find", { query: "approve" });
    const rows = packets.flatMap((p) => p.matches ?? []);
    const refs = rows.map((r) => r.ref);

    expect(packets.length).toBeGreaterThan(1);
    expect(rows).toHaveLength(45);
    expect(new Set(refs).size, "no ref is handed back twice").toBe(45);
    expect(rows.map((r) => r.label)).toEqual(
      Array.from({ length: 45 }, (_, i) => `Approve invoice ${String(i + 1).padStart(2, "0")}`),
    );
    // Each packet's lines are its rows, so what the model reads is what the structure says.
    for (const packet of packets) {
      for (const row of packet.matches ?? []) expect(packet.output).toContain(row.ref);
      expect(packet.total).toBe(45);
    }
    // A continued ref is minted the ordinary way: it operates like any other.
    const last = rows[44].ref;
    const clicked = await ask("page_click", { ref: last });
    expect(clicked.ok).toBe(true);
    expect(clicked.output).toBe("clicked Approve invoice 45");
  });

  it("packs long labels into fewer rows rather than letting the lane cut the packet", async () => {
    const long = "Reconcile the remittance for ".padEnd(110, "x");
    document.body.innerHTML = Array.from({ length: 30 }, (_, i) => `<button>${long}${i}</button>`).join("");

    const packets = await follow("page_find", { query: "reconcile" });

    expect(packets[0].matches!.length).toBeLessThan(20);
    expect(packets.flatMap((p) => p.matches ?? [])).toHaveLength(30);
  });

  it("reaches a fact past character 4,000 and loses nothing on the way", async () => {
    const before = Array.from({ length: 700 }, (_, i) => `row${i}`).join(" ");
    const after = Array.from({ length: 200 }, (_, i) => `tail${i}`).join(" ");
    document.body.innerHTML = `<p>${before}</p><p>The settlement code is ZX-4471.</p><p>${after}</p>`;
    const whole = `${before} The settlement code is ZX-4471. ${after}`;
    expect(whole.indexOf("ZX-4471")).toBeGreaterThan(4000);

    const packets = await follow("page_read", {});

    expect(packets.some((p) => (p.output ?? "").includes("The settlement code is ZX-4471."))).toBe(true);
    expect(packets.map(bodyOf).join(""), "the bodies are the page, in order, once").toBe(whole);
    expect(packets.at(-1)?.output?.split("\n")[0]).toMatch(/the end$/);
  });

  it("reads a snapshot, so a page that changes under the cursor does not shift it", async () => {
    document.body.innerHTML = controls(45);
    const first = await ask("page_find", { query: "approve" });
    const firstLabels = (first.matches ?? []).map((m) => m.label);
    // A new control at the top would move every index on a live page by one.
    document.body.insertAdjacentHTML("afterbegin", `<button>Approve invoice 00</button>`);

    const rest = await follow("page_find", { cursor: cursorIn(first) });
    const labels = [...firstLabels, ...rest.flatMap((p) => p.matches ?? []).map((m) => m.label)];

    expect(labels).toHaveLength(45);
    expect(new Set(labels).size).toBe(45);
    expect(labels).not.toContain("Approve invoice 00");
  });

  it("answers a short read exactly as before, with no cursor line", async () => {
    const read = await ask("page_read");
    const find = await ask("page_find", { query: "chase" });

    expect(read.output?.startsWith("Overdue invoices")).toBe(true);
    expect(cursorIn(find)).toBeNull();
    expect(find.output).not.toContain("(showing");
  });

  it("refuses a cursor once the page has navigated, and says to read again", async () => {
    document.body.innerHTML = controls(45);
    const cursor = cursorIn(await ask("page_find", { query: "approve" }));
    history.pushState({}, "", "/next-page");

    const answer = await ask("page_find", { cursor });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("unknown_ref");
    expect(answer.error).toContain("page that has been left");
    expect(answer.error).toContain("again without a cursor");
  });

  it("refuses a cursor whose snapshot has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      document.body.innerHTML = `<p>${"word ".repeat(2000)}</p>`;
      const cursor = cursorIn(await ask("page_read"));
      // Used within the window, a cursor keeps its snapshot alive...
      vi.advanceTimersByTime(2 * 60 * 1000);
      const second = await ask("page_read", { cursor });
      expect(second.ok).toBe(true);
      // ...and left alone past it, the snapshot is gone.
      vi.advanceTimersByTime(3 * 60 * 1000 + 1);

      const answer = await ask("page_read", { cursor: cursorIn(second) });

      expect(answer.ok).toBe(false);
      expect(answer.reason).toBe("unknown_ref");
      expect(answer.error).toContain("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most four snapshots, dropping the oldest", async () => {
    document.body.innerHTML = controls(45);
    const cursors = [];
    for (let i = 0; i < 5; i += 1) cursors.push(cursorIn(await ask("page_find", { query: "approve" })));

    const oldest = await ask("page_find", { cursor: cursors[0] });
    const newest = await ask("page_find", { cursor: cursors[4] });

    expect(oldest.reason).toBe("unknown_ref");
    expect(newest.ok).toBe(true);
  });

  it("refuses a cursor it never handed back, one from the other hand, and one too long", async () => {
    document.body.innerHTML = `<p>${"word ".repeat(2000)}</p>`;
    const readCursor = cursorIn(await ask("page_read"));

    const invented = await ask("page_read", { cursor: "cur_0_999_10" });
    const crossed = await ask("page_find", { cursor: readCursor });
    const long = await ask("page_read", { cursor: `${readCursor}${"0".repeat(64)}` });
    const garbage = await ask("page_read", { cursor: "#main" });

    for (const answer of [invented, crossed, long, garbage]) {
      expect(answer.ok).toBe(false);
      expect(answer.reason).toBe("unknown_ref");
    }
  });

  it("declares the cursor in the schemas the surface reads", () => {
    const installed = (window as unknown as {
      __athenaHands: { tools: { name: string; inputSchema: { properties?: Record<string, { maxLength?: number }> } }[] };
    }).__athenaHands;
    const schema = (name: string) => installed.tools.find((t) => t.name === name)?.inputSchema;

    expect(schema("page_read")?.properties?.cursor?.maxLength).toBe(64);
    expect(schema("page_find")?.properties?.cursor?.maxLength).toBe(64);
    expect(schema("page_click")?.properties?.cursor).toBeUndefined();
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

  it("refuses to fill a select, and says which hand to use", async () => {
    // A select has a `value`, so assigning to it looks like it worked; an option it does not hold
    // silently deselects instead. Found against a real page whose client filter is a select.
    const before = (document.getElementById("tone") as HTMLSelectElement).value;

    const answer = await ask("page_fill", { ref: await refFor("", "select"), value: "Northwind" });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("validator_failed");
    expect(answer.error).toContain("page_select");
    expect((document.getElementById("tone") as HTMLSelectElement).value).toBe(before);
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

// --- describing a card's refs (ADR 0099) --------------------------------------------------------

describe("describe", () => {
  function describeRefs(refs: unknown[]): Promise<Answer & { targets?: Record<string, { role: string; label: string }> }> {
    const id = `d:${++seq}`;
    return new Promise((resolve) => {
      const onReply = (event: MessageEvent) => {
        const message = event.data as Record<string, unknown> | null;
        if (!message || message.__ns !== NS || message.dir !== "to-ext" || message.id !== id) return;
        window.removeEventListener("message", onReply);
        resolve(message as never);
      };
      window.addEventListener("message", onReply);
      send({ __ns: NS, dir: "to-page", id, describe: refs });
    });
  }

  it("names what each live ref points at, and leaves out the dead and the invented", async () => {
    const found = await ask("page_find", { query: "send chase" });
    const ref = found.matches![0].ref;
    const live = await describeRefs([ref, "ref_0_000000000000", "#send"]);

    expect(live.ok).toBe(true);
    expect(live.targets).toEqual({ [ref]: { role: "button", label: "Send chase" } });

    // After a re-render the element is detached: the ref no longer describes anything.
    document.body.innerHTML = PAGE;
    expect((await describeRefs([ref])).targets).toEqual({});
  });

  it("changes nothing on the page", async () => {
    const found = await ask("page_find", { query: "send chase" });
    await describeRefs([found.matches![0].ref]);

    expect(clicks).toBe(0);
  });

  it("is not a hand: it is in neither the hands list nor the tools a manifest is built from", async () => {
    const installed = (window as unknown as { __athenaHands: { names: string[]; tools: { name: string }[] } })
      .__athenaHands;

    expect(installed.names).not.toContain("describe");
    expect(installed.tools.map((t) => t.name)).not.toContain("describe");
    // Asked as a hand by name, it is an unknown hand like any other.
    const asHand = await ask("describe", { refs: [] });
    expect(asHand.ok).toBe(false);
    expect(asHand.reason).toBe("unknown_ref");
  });
});
