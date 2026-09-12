/**
 * The nine generic hands, in the page's main world — README section 3.4 tier 2, plan c24.
 *
 * Tier 1 is what a page chose to offer. This is what Athena can do on a page that offered
 * nothing, which is nearly every page: read it, find things in it, and operate the things it
 * found. It is the difference between "an agent for apps with a plug-in" and "an agent for the
 * web the user already has open".
 *
 * Three rules run through everything below.
 *
 * **A ref is minted here and nowhere else.** `page_find` and `page_read` hand back opaque
 * `ref_<hex>` tokens; every operating hand takes one. A model never sees a CSS selector and can
 * never compose one, so it cannot reach an element the page did not just show it. A ref is scoped
 * to one document: navigating bumps a generation and every ref minted before it answers
 * `unknown_ref` rather than acting on whatever now occupies that position.
 *
 * **Nothing throws.** Every hand answers `{ ok, output, reason }` and a refusal is a result. A
 * hand that rejected would leave the relay holding a pending entry until its timer, and a panel
 * spinning on a call nobody remembers making.
 *
 * **Bounded output announces itself.** Page text is unbounded by nature — a long list view is a
 * megabyte — so every read is cut and says `(showing N of M)`, in the same words the Python side
 * uses (README section 2, invariant 4).
 *
 * The class of each hand is not decided here. These are *capabilities*; the gate decides, and
 * README section 3.3 makes every hand `GATED` on first sight for a new origin whatever its flags
 * say.
 */

(() => {
  "use strict";

  const NS = "athena-hands";
  const DIR_PAGE = "to-page";
  const DIR_EXT = "to-ext";

  // A frame is not the page. `inject.js` installs nothing in one and neither does this: an
  // advertisement in an iframe must not be able to answer for the document around it.
  if (window.top !== window) return;
  // Idempotent: the shell may re-inject after a soft navigation, and two listeners would answer
  // every request twice.
  if (window.__athenaHands) return;

  /** How much text one read may return before it is cut and says so. */
  const READ_CAP = 4000;
  /** How many matches `page_find` returns before it announces the rest. */
  const FIND_CAP = 20;
  /** The longest a label may be in a find result, so one heading cannot fill the answer. */
  const LABEL_CAP = 120;

  /** Elements whose text is markup, not content. */
  const NOT_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);

  /** What `page_find` is willing to hand back a ref to. Anything else is scenery. */
  const OPERABLE =
    "a[href],button,input,select,textarea,summary,[role=button],[role=link]," +
    "[role=checkbox],[role=tab],[role=menuitem],[role=option],[contenteditable=true]";

  // ---- the ref map ----------------------------------------------------------------------------

  /** ref → element, for this document only. */
  let refs = new Map();
  /** Bumped on every navigation, so a ref from the previous document cannot resolve. */
  let generation = 0;

  function mint(el) {
    for (const [token, held] of refs) if (held === el) return token;
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const token = `ref_${generation}_${hex}`;
    refs.set(token, el);
    return token;
  }

  /**
   * The element a ref names, or a refusal naming which of the two things went wrong.
   *
   * `unknown_ref` and a detached element are different failures and the model can act on the
   * difference: the first means "you invented that", the second means "the page moved under you,
   * find it again".
   */
  function resolve(ref) {
    if (typeof ref !== "string" || !ref.startsWith("ref_")) {
      return { error: "unknown_ref", detail: "a ref is minted by page_find or page_read" };
    }
    if (!ref.startsWith(`ref_${generation}_`)) {
      return { error: "unknown_ref", detail: "that ref belongs to a page that has been left" };
    }
    const el = refs.get(ref);
    if (!el) return { error: "unknown_ref", detail: `no element is held under ${ref}` };
    if (!el.isConnected) {
      return { error: "unknown_ref", detail: "that element is no longer in the document" };
    }
    return { el };
  }

  // ---- reading --------------------------------------------------------------------------------

  function squash(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function bounded(text) {
    const whole = String(text ?? "");
    if (whole.length <= READ_CAP) return whole;
    return `${whole.slice(0, READ_CAP)}\n(showing ${READ_CAP} of ${whole.length})`;
  }

  /** Is this element actually on screen? A hidden node is not something a person could click. */
  function shown(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    if (el.closest("[hidden],[aria-hidden=true]")) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  /** The visible text of a subtree, without the parts that are markup. */
  function textOf(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || NOT_TEXT.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (!squash(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      parts.push(squash(node.nodeValue));
    }
    return parts.join(" ");
  }

  /** Form controls whose descendants are their data, not their label. */
  const FIELD = new Set(["SELECT", "INPUT", "TEXTAREA"]);

  /**
   * What a person would call this control.
   *
   * A field's own text is *not* a candidate: a `<select>`'s descendants are its options, so
   * falling through to them labels the tone picker "Friendly Firm" — every value it holds, none
   * of which is its name. For those the fallback runs on to the attributes instead.
   */
  function labelOf(el) {
    const candidates = [
      el.getAttribute?.("aria-label"),
      el.labels?.[0]?.textContent,
      el.getAttribute?.("placeholder"),
      el.getAttribute?.("title"),
      el.tagName === "INPUT" && el.type === "submit" ? el.value : "",
      FIELD.has(el.tagName) ? "" : textOf(el),
      el.getAttribute?.("name"),
      el.getAttribute?.("id"),
    ];
    const found = candidates.map(squash).find(Boolean) ?? "";
    return found.length > LABEL_CAP ? `${found.slice(0, LABEL_CAP)}…` : found;
  }

  function roleOf(el) {
    const explicit = el.getAttribute?.("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textbox";
    if (tag === "input") return (el.type || "text") === "text" ? "textbox" : el.type;
    return tag;
  }

  // ---- the hands ------------------------------------------------------------------------------

  const ok = (output, extra) => ({ ok: true, output: String(output ?? ""), ...extra });
  const no = (reason, detail) => ({ ok: false, reason, error: detail || reason });

  const HANDS = {
    /** The page, or one ref'd part of it, as text. Bounded and announced. */
    page_read(input) {
      let root = document.body;
      if (input.ref !== undefined && input.ref !== null) {
        const found = resolve(input.ref);
        if (found.error) return no(found.error, found.detail);
        root = found.el;
      }
      if (!root) return no("unknown_ref", "this document has no body yet");
      return ok(bounded(textOf(root)), { title: document.title, url: location.href });
    },

    /**
     * Operable elements matching a query, each with a fresh ref.
     *
     * The query is matched against the label a person would read, not against markup: a model
     * that had to guess at class names would be writing selectors, which is the thing refs exist
     * to prevent.
     */
    page_find(input) {
      const query = squash(input.query).toLowerCase();
      const wanted = squash(input.role).toLowerCase();
      const all = Array.from(document.querySelectorAll(OPERABLE)).filter(shown);
      const matched = all.filter((el) => {
        if (wanted && roleOf(el).toLowerCase() !== wanted) return false;
        if (!query) return true;
        return labelOf(el).toLowerCase().includes(query);
      });
      const shownRows = matched.slice(0, FIND_CAP).map((el) => ({
        ref: mint(el),
        role: roleOf(el),
        label: labelOf(el),
        disabled: Boolean(el.disabled),
      }));
      const lines = shownRows.map((r) => `${r.ref}  ${r.role}  ${r.label}${r.disabled ? "  (disabled)" : ""}`);
      if (matched.length > shownRows.length) {
        lines.push(`(showing ${shownRows.length} of ${matched.length})`);
      }
      return ok(lines.join("\n") || "nothing matched", {
        matches: shownRows,
        shown: shownRows.length,
        total: matched.length,
      });
    },

    /** Click a ref. The one hand that is a plain press. */
    page_click(input) {
      const found = resolve(input.ref);
      if (found.error) return no(found.error, found.detail);
      if (found.el.disabled) return no("validator_failed", "that control is disabled");
      found.el.scrollIntoView({ block: "center", behavior: "instant" });
      found.el.click();
      return ok(`clicked ${labelOf(found.el) || roleOf(found.el)}`);
    },

    /**
     * Put a value in a field.
     *
     * The input and change events are dispatched because a framework-rendered field that is
     * assigned to and not told is a field whose application still holds the old value — the page
     * would look filled and submit empty.
     */
    page_fill(input) {
      const found = resolve(input.ref);
      if (found.error) return no(found.error, found.detail);
      const el = found.el;
      const value = String(input.value ?? "");
      if (el.disabled || el.readOnly) return no("validator_failed", "that field cannot be typed in");
      if (el.isContentEditable) {
        el.textContent = value;
      } else if ("value" in el) {
        setValue(el, value);
      } else {
        return no("validator_failed", "that element is not a field");
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return ok(`filled ${labelOf(el) || "the field"}`);
    },

    /** Choose an option by its visible label, or by value when no label matches. */
    page_select(input) {
      const found = resolve(input.ref);
      if (found.error) return no(found.error, found.detail);
      const el = found.el;
      if (el.tagName !== "SELECT") return no("validator_failed", "that element is not a select");
      const wanted = squash(input.value).toLowerCase();
      const options = Array.from(el.options);
      const match =
        options.find((o) => squash(o.textContent).toLowerCase() === wanted) ??
        options.find((o) => String(o.value).toLowerCase() === wanted);
      if (!match) {
        const names = options.slice(0, FIND_CAP).map((o) => squash(o.textContent));
        if (options.length > names.length) names.push(`(showing ${names.length} of ${options.length})`);
        return no("validator_failed", `no such option; it offers: ${names.join(", ")}`);
      }
      el.value = match.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return ok(`selected ${squash(match.textContent)}`);
    },

    /** Submit the form a ref sits in. Separate from a click because a form may have no button. */
    page_submit(input) {
      const found = resolve(input.ref);
      if (found.error) return no(found.error, found.detail);
      const form = found.el.tagName === "FORM" ? found.el : found.el.closest("form");
      if (!form) return no("unknown_ref", "that element is not inside a form");
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
      return ok("submitted the form");
    },

    /** Bring a ref into view, or move the page by a screen. */
    page_scroll(input) {
      if (input.ref !== undefined && input.ref !== null) {
        const found = resolve(input.ref);
        if (found.error) return no(found.error, found.detail);
        found.el.scrollIntoView({ block: "center", behavior: "instant" });
        return ok(`scrolled to ${labelOf(found.el) || roleOf(found.el)}`);
      }
      const direction = squash(input.direction).toLowerCase() === "up" ? -1 : 1;
      window.scrollBy({ top: direction * window.innerHeight * 0.9, behavior: "instant" });
      return ok(`scrolled ${direction < 0 ? "up" : "down"} one screen`);
    },

    /**
     * Wait for text to appear, up to a bound.
     *
     * A hand and not a sleep: the model asks for the thing it is waiting *for*, so a page that is
     * already showing it returns at once and one that never shows it says so instead of a turn
     * quietly costing thirty seconds.
     */
    async page_wait(input) {
      const wanted = squash(input.text).toLowerCase();
      if (!wanted) return no("validator_failed", "page_wait needs the text to wait for");
      const budget = Math.min(Math.max(Number(input.timeout_ms) || 5000, 100), 15000);
      const deadline = Date.now() + budget;
      for (;;) {
        if (textOf(document.body).toLowerCase().includes(wanted)) {
          return ok(`"${squash(input.text)}" is on the page`);
        }
        if (Date.now() >= deadline) {
          return no("timeout", `"${squash(input.text)}" did not appear within ${budget} ms`);
        }
        await new Promise((done) => setTimeout(done, 100));
      }
    },
  };

  /**
   * Assign through the prototype's setter.
   *
   * React and every library like it install their own `value` property on the element and read
   * the shadowed one on change; assigning directly updates what the browser shows and leaves the
   * application holding the old value. This is the one piece of framework knowledge in the file
   * and it is here because the alternative is hands that silently do nothing on most modern pages.
   */
  function setValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  // ---- the wire -------------------------------------------------------------------------------

  async function answer(message) {
    const hand = HANDS[message.hand];
    if (!hand) return no("unknown_ref", `no hand named ${String(message.hand)}`);
    try {
      return await hand(message.input && typeof message.input === "object" ? message.input : {});
    } catch (e) {
      // A hand that threw is still a result. The page is not ours to break and the relay is not
      // ours to hang.
      return no("unknown", `${String(message.hand)} failed: ${e && e.message ? e.message : e}`);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.__ns !== NS || msg.dir !== DIR_PAGE) return;
    void answer(msg).then((result) => {
      window.postMessage({ __ns: NS, dir: DIR_EXT, id: msg.id, ...result }, location.origin);
    });
  });

  /**
   * A navigation invalidates every ref.
   *
   * A single-page application replaces the document without a load event, so the history methods
   * are watched as well as `popstate`. A ref that survived a route change would name whatever
   * element now sits where the old one was, and the hand that used it would act on the wrong row.
   */
  function left() {
    generation += 1;
    refs = new Map();
  }
  addEventListener("popstate", left);
  addEventListener("pagehide", left);
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    history[name] = function patched(...args) {
      left();
      return original.apply(this, args);
    };
  }

  window.__athenaHands = { version: 1, names: Object.keys(HANDS) };
})();
