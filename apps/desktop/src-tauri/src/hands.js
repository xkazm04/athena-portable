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
 * uses (README section 2, invariant 4). A cut read is not a dead end: its first line names a
 * cursor into a short-lived snapshot, and passing it back reads the next packet (ADR 0102).
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

  /**
   * The most one answer may be, cursor line and footer included (ADR 0102).
   *
   * The lane cuts every tool result at 1,600 characters (`RESULT_CAP`, `turn_frame.py`) and what
   * it cuts is gone: no cursor can reach past a cut the page never saw. So a long read is packed
   * here, under that wall with room to spare, and every packet arrives whole.
   */
  const PACKET_CAP = 1500;
  /** How many matches one `page_find` packet carries, at most, before it hands back a cursor. */
  const FIND_CAP = 20;
  /** The longest cursor token a hand takes; `hands.rs` declares the same bound in its schema. */
  const CURSOR_MAX = 64;
  /** How many snapshots one document keeps for continuing reads; the oldest is dropped first. */
  const SNAPSHOT_MAX = 4;
  /** How long a snapshot outlives its last use. Short: it is a copy of a page that keeps moving. */
  const SNAPSHOT_TTL_MS = 3 * 60 * 1000;
  /** The most page text one snapshot holds. A megabyte list view is read by ref, not by paging. */
  const SNAPSHOT_TEXT_CAP = 200000;
  /** The longest a label may be in a find result, so one heading cannot fill the answer. */
  const LABEL_CAP = 120;

  /** Elements whose text is markup, not content. */
  const NOT_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);

  /** What `page_find` hands back a ref to by default: the things a person can press or type in. */
  const OPERABLE =
    "a[href],button,input,select,textarea,summary,[role=button],[role=link]," +
    "[role=checkbox],[role=tab],[role=menuitem],[role=option],[contenteditable=true]";

  /**
   * The parts of a page that hold *content* rather than controls, addressable by asking for one
   * of them by name.
   *
   * Without this a `page_read` can only be the whole document: refs come from `page_find`, and
   * `page_find` only offered controls. A model that wanted one row of a table had to read the
   * page and hope the answer was small enough to reason over — which on a real remittance page it
   * is not, because the row it wants and the footnote that contradicts it are both on it.
   *
   * They are behind an explicit `role` rather than in the default list because a bare `page_find`
   * should answer "what can I do here", and forty table rows is not that.
   */
  const STRUCTURE = new Set([
    "table", "thead", "tbody", "tr", "td", "th",
    "ul", "ol", "li", "dl",
    "section", "article", "main", "aside", "nav", "header", "footer",
    "h1", "h2", "h3", "h4", "p", "form", "figure", "blockquote",
  ]);

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

  // ---- snapshots, for continuing a long read (ADR 0102) ----------------------------------------

  /**
   * id → `{ kind, generation, at, text | elements }`, for this document only.
   *
   * A continuation reads the copy taken at the first call, never the live page, so an offset or a
   * match index means the same thing on the third packet as on the first. The copy is bounded in
   * number and in age: it is the page as it was, and the longer it is kept the less that is worth.
   */
  let snapshots = new Map();
  /** Never reused, across documents too, so a cursor cannot name a later snapshot by accident. */
  let snapshotSeq = 0;

  function keep(snapshot) {
    const now = Date.now();
    for (const [id, held] of snapshots) if (now - held.at > SNAPSHOT_TTL_MS) snapshots.delete(id);
    snapshotSeq += 1;
    snapshots.set(snapshotSeq, { ...snapshot, generation, at: now });
    while (snapshots.size > SNAPSHOT_MAX) snapshots.delete(snapshots.keys().next().value);
    return snapshotSeq;
  }

  const cursorOf = (id, offset) => `cur_${generation}_${id}_${offset}`;

  /**
   * The snapshot and offset a cursor names, or a refusal that tells the model to read again.
   *
   * Every failure is `unknown_ref`, the reason a stale ref already answers: the cursor is a ref to
   * a place in a copy, and the fix is the same — ask the page again.
   */
  function reopen(cursor, kind) {
    const again = `; call ${kind} again without a cursor`;
    const token = typeof cursor === "string" && cursor.length <= CURSOR_MAX ? cursor : "";
    const parts = /^cur_(\d+)_(\d+)_(\d+)$/.exec(token);
    if (!parts) return { error: "unknown_ref", detail: `a cursor is handed back by ${kind}${again}` };
    if (Number(parts[1]) !== generation) {
      return { error: "unknown_ref", detail: `that cursor belongs to a page that has been left${again}` };
    }
    const id = Number(parts[2]);
    const held = snapshots.get(id);
    if (held && Date.now() - held.at > SNAPSHOT_TTL_MS) snapshots.delete(id);
    const live = snapshots.get(id);
    if (!live) return { error: "unknown_ref", detail: `that cursor has expired${again}` };
    if (live.kind !== kind) {
      return { error: "unknown_ref", detail: `that cursor was handed back by ${live.kind}${again}` };
    }
    const offset = Number(parts[3]);
    const size = kind === "page_read" ? live.text.length : live.elements.length;
    if (offset <= 0 || offset >= size) {
      return { error: "unknown_ref", detail: `that cursor points outside its snapshot${again}` };
    }
    // Used, so kept: it moves to the back of the eviction order and its clock starts again.
    live.at = Date.now();
    snapshots.delete(id);
    snapshots.set(id, live);
    return { id, snapshot: live, offset };
  }

  /**
   * The first line of a packet: the cursor for the next one, or where the end is.
   *
   * `more` is false on the last packet, which then has no cursor to name — but it still says
   * which snapshot it came from and that nothing follows, so a model does not ask for a part
   * that is not there.
   */
  function headOf(unit, id, start, end, total, more, tail = "") {
    const span = `${unit} ${start + 1}-${end} of ${total}, snapshot s${id}`;
    return more
      ? `cursor: ${cursorOf(id, end)} (${span}; pass it as cursor for the next part)`
      : `${span}, the end${tail}`;
  }

  /**
   * How much content a packet may carry once its first line and its footer are spelled.
   *
   * Both are sized for the widest numbers they could hold, cursor or not, before anything is cut,
   * so the finished packet can only come out shorter than `PACKET_CAP`, never longer.
   */
  function roomFor(unit, id, total, tail) {
    const wide = Number(String(total).replace(/\d/g, "9"));
    const head = Math.max(
      headOf(unit, id, wide, wide, wide, true).length,
      headOf(unit, id, wide, wide, wide, false, tail).length,
    );
    return PACKET_CAP - head - `(showing ${wide} of ${wide})`.length - 2;
  }

  /** One packet of a snapshot's text: a first line, the text, the footer — under `PACKET_CAP`. */
  function textPacket(id, snapshot, start) {
    const { text, total } = snapshot;
    const tail = text.length < total ? "; the rest is not kept, read a part of it by ref" : "";
    const room = roomFor("chars", id, total, tail);
    let end = Math.min(text.length, start + room);
    // Back off to a space so a figure is not split across two packets, when one is near.
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + room - 80) end = space;
    }
    const head = headOf("chars", id, start, end, total, end < text.length, tail);
    const body = text.slice(start, end);
    return { output: [head, body, `(showing ${body.length} of ${total})`].join("\n"), next: end };
  }

  /** One packet of a snapshot's matches, each minted a ref the ordinary way. */
  function findPacket(id, snapshot, start) {
    const { elements } = snapshot;
    const total = elements.length;
    const room = roomFor("matches", id, total, "");
    const rows = [];
    const lines = [];
    let used = 0;
    for (let at = start; at < total && rows.length < FIND_CAP; at += 1) {
      const described = describeRow(elements[at]);
      const line = lineOf(described);
      if (rows.length && used + line.length + 1 > room) break;
      const row = { ref: mint(elements[at]), ...described };
      rows.push(row);
      lines.push(lineOf(row));
      used += line.length + 1;
    }
    const end = start + rows.length;
    const head = headOf("matches", id, start, end, total, end < total);
    const output = [head, ...lines, `(showing ${rows.length} of ${total})`].join("\n");
    return { output, rows, next: end };
  }

  /** A row before its ref is minted, so a row that will not fit does not get one. */
  function describeRow(el) {
    return { role: roleOf(el), label: labelOf(el), disabled: Boolean(el.disabled) };
  }

  /** One match as the model reads it. A ref is always `ref_<generation>_<12 hex>`, so the length
   * of a row before minting is the length after, give or take the generation's digits. */
  function lineOf(r) {
    const ref = r.ref ?? `ref_${generation}_000000000000`;
    return `${ref}  ${r.role}  ${r.label}${r.disabled ? "  (disabled)" : ""}`;
  }

  // ---- reading --------------------------------------------------------------------------------

  function squash(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
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
      // An icon link has no text at all. Wikipedia and Hacker News both put one in their first
      // twenty controls, and a row a model cannot name is a row it cannot choose.
      el.querySelector?.("img[alt]")?.getAttribute("alt"),
      el.getAttribute?.("name"),
      el.getAttribute?.("id"),
      hrefTail(el),
    ];
    const found = candidates.map(squash).find(Boolean) ?? "";
    return found.length > LABEL_CAP ? `${found.slice(0, LABEL_CAP)}…` : found;
  }

  /**
   * The last meaningful part of a link's target, as a last-resort label.
   *
   * Not the whole href: a tracking URL is three hundred characters of query string and none of it
   * is a name. The last path segment is what a person reads off a status bar.
   */
  function hrefTail(el) {
    const href = el.getAttribute?.("href");
    if (!href || href.startsWith("javascript:") || href === "#") return "";
    try {
      const path = new URL(href, location.href).pathname;
      const tail = path.split("/").filter(Boolean).pop() ?? "";
      return decodeURIComponent(tail).replace(/[_-]+/g, " ");
    } catch {
      return "";
    }
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

  /** One line each, for the capability block a model actually reads. */
  const DESCRIPTIONS = {
    page_read:
      "The visible text of the page, or of one element you have a ref for. A long answer comes in parts; its first line names a cursor, pass it back as cursor for the next part.",
    page_find:
      "Operable elements whose label matches a query, each with a ref to act on. Many matches come in parts; the first line names a cursor, pass it back as cursor for the next part.",
    page_wait: "Wait, up to a bound, for text to appear on the page.",
    page_scroll: "Bring a ref into view, or move the page by one screen.",
    page_click:
      "Click the element a ref names. Pass expect, the label page_find gave it: if the element no longer reads that, nothing is clicked.",
    page_fill:
      "Put a value into the field a ref names. Pass expect, the label page_find gave it: if the field no longer reads that, nothing is typed.",
    page_select:
      "Choose an option, by its visible label, in the select a ref names. Pass expect, the label page_find gave it: if the select no longer reads that, nothing changes.",
    page_submit:
      "Submit the form the ref sits in. Pass expect, the label page_find gave the ref: if the element no longer reads that, nothing is submitted.",
  };

  const ok = (output, extra) => ({ ok: true, output: String(output ?? ""), ...extra });
  const no = (reason, detail) => ({ ok: false, reason, error: detail || reason });

  /**
   * The label check an acting hand makes before it touches anything (ADR 0104).
   *
   * `expect` is the label `page_find` handed back with the ref, and the card showed it to the
   * person who approved the call. If the element now reads otherwise - the page re-rendered, a
   * row moved, the button was relabelled - the hand does nothing and says what it saw. Optional:
   * a call without one acts as it always did. Compared as `labelOf` writes a label, squashed and
   * case-blind, so a label cut at LABEL_CAP compares equal to the same cut.
   */
  function mislabelled(el, input) {
    if (input.expect === undefined || input.expect === null) return null;
    const wanted = squash(input.expect);
    const seen = labelOf(el);
    if (wanted.toLowerCase() === squash(seen).toLowerCase()) return null;
    return no(
      "validator_failed",
      `expected "${wanted}" but that element now reads "${seen || roleOf(el)}"; nothing was done`,
    );
  }

  /** The longest query a scoped read takes; `hands.rs` bounds `tabs_read`'s query the same. */
  const QUERY_MAX = 200;
  /** Structure that is a whole row of content: a label and its figure live inside one of these. */
  const ROW = new Set(["TR", "LI", "P", "DD", "DT", "BLOCKQUOTE", "FIGURE", "H1", "H2", "H3", "H4"]);

  /**
   * The parts of the page that mention `query`, each the smallest row that holds it (L2).
   *
   * Not a hand of its own: `page_read` with a query, which the shell's `tabs_read` sends when the
   * model scoped its read of another tab. A whole-page read is cut at the packet, so a closing
   * balance at character 3,000 of a statement is past the first part; this keeps only the rows
   * that mention the query, so the figure lands inside the first packet. A match is the deepest
   * element whose text holds the query, widened to its row - or to the first ancestor that holds
   * more than the query itself, so a label in its own cell carries the figure beside it. Hidden
   * subtrees and markup are skipped. The footer counts what was kept against the whole page.
   */
  function scopedRead(raw) {
    const query = squash(raw).slice(0, QUERY_MAX).toLowerCase();
    if (!query) return no("validator_failed", "a scoped read needs a non-empty query");
    const body = document.body;
    if (!body) return no("unknown_ref", "this document has no body yet");
    const total = textOf(body).length;
    const holds = (el) =>
      !NOT_TEXT.has(el.tagName) &&
      !el.closest("[hidden],[aria-hidden=true]") &&
      squash(el.textContent).toLowerCase().includes(query);
    const matching = Array.from(body.querySelectorAll("*")).filter(holds);
    const deepest = matching.filter((el) => !Array.from(el.children).some(holds));
    const picked = [];
    for (const el of deepest) {
      let at = el;
      while (at !== body && !ROW.has(at.tagName) && squash(textOf(at)).length <= query.length + 2) {
        at = at.parentElement ?? body;
      }
      // Widening that reached the whole page found nothing beside the label: keep the label alone.
      if (at === body) at = el;
      if (picked.some((p) => p === at || p.contains(at))) continue;
      for (let i = picked.length - 1; i >= 0; i -= 1) if (at.contains(picked[i])) picked.splice(i, 1);
      picked.push(at);
    }
    const parts = picked.map(textOf).filter(Boolean);
    if (parts.length === 0) {
      const said = squash(raw).slice(0, QUERY_MAX);
      return ok(`nothing on this page mentions "${said}"\n(showing 0 of ${total})`, {
        title: document.title,
        url: location.href,
      });
    }
    const joined = parts.join("\n");
    const footer = `(showing ${joined.length} of ${total})`;
    if (joined.length + footer.length + 1 <= PACKET_CAP) {
      return ok(`${joined}\n${footer}`, { title: document.title, url: location.href });
    }
    const snapshot = { kind: "page_read", text: joined.slice(0, SNAPSHOT_TEXT_CAP), total: joined.length };
    const id = keep(snapshot);
    const packet = textPacket(id, snapshot, 0);
    return ok(packet.output, { title: document.title, url: location.href, next: packet.next });
  }

  const HANDS = {
    /**
     * The page, or one ref'd part of it, as text. Bounded and announced.
     *
     * An answer that fits one packet is the text itself, exactly as before cursors existed. One
     * that does not is a snapshot read in packets, each starting with the cursor for the next
     * (ADR 0102). A call with a cursor reads that snapshot and nothing else: its `ref` is the one
     * the first call named, whatever this call says.
     */
    page_read(input) {
      if (input.cursor !== undefined && input.cursor !== null) {
        const held = reopen(input.cursor, "page_read");
        if (held.error) return no(held.error, held.detail);
        const packet = textPacket(held.id, held.snapshot, held.offset);
        return ok(packet.output, { title: document.title, url: location.href, next: packet.next });
      }
      if (input.query !== undefined && input.query !== null) return scopedRead(input.query);
      let root = document.body;
      if (input.ref !== undefined && input.ref !== null) {
        const found = resolve(input.ref);
        if (found.error) return no(found.error, found.detail);
        root = found.el;
      }
      if (!root) return no("unknown_ref", "this document has no body yet");
      const text = textOf(root);
      if (text.length <= PACKET_CAP) return ok(text, { title: document.title, url: location.href });
      const snapshot = { kind: "page_read", text: text.slice(0, SNAPSHOT_TEXT_CAP), total: text.length };
      const id = keep(snapshot);
      const packet = textPacket(id, snapshot, 0);
      return ok(packet.output, { title: document.title, url: location.href, next: packet.next });
    },

    /**
     * Operable elements matching a query, each with a fresh ref.
     *
     * The query is matched against the label a person would read, not against markup: a model
     * that had to guess at class names would be writing selectors, which is the thing refs exist
     * to prevent. More matches than one packet holds come as a snapshot of the match list, read
     * on with the cursor its first line names; each continued row is minted a ref the ordinary
     * way, and no row is handed back twice (ADR 0102).
     */
    page_find(input) {
      if (input.cursor !== undefined && input.cursor !== null) {
        const held = reopen(input.cursor, "page_find");
        if (held.error) return no(held.error, held.detail);
        const packet = findPacket(held.id, held.snapshot, held.offset);
        return ok(packet.output, {
          matches: packet.rows,
          shown: packet.rows.length,
          total: held.snapshot.elements.length,
        });
      }
      const query = squash(input.query).toLowerCase();
      const wanted = squash(input.role).toLowerCase();
      // Asking for a structural role searches content; asking for anything else, or for nothing,
      // searches the controls. So `page_find` with no role still answers "what can I do here".
      const selector = STRUCTURE.has(wanted) ? wanted : OPERABLE;
      const all = Array.from(document.querySelectorAll(selector)).filter(shown);
      const matched = all.filter((el) => {
        if (wanted && !STRUCTURE.has(wanted) && roleOf(el).toLowerCase() !== wanted) return false;
        if (!query) return true;
        return labelOf(el).toLowerCase().includes(query);
      });
      const described = matched.slice(0, FIND_CAP).map(describeRow);
      const width = described.reduce((sum, row) => sum + lineOf(row).length + 1, 0);
      if (described.length === matched.length && width <= PACKET_CAP) {
        const whole = described.map((row, at) => ({ ref: mint(matched[at]), ...row }));
        return ok(whole.map(lineOf).join("\n") || "nothing matched", {
          matches: whole,
          shown: whole.length,
          total: matched.length,
        });
      }
      const snapshot = { kind: "page_find", elements: matched };
      const id = keep(snapshot);
      const packet = findPacket(id, snapshot, 0);
      return ok(packet.output, {
        matches: packet.rows,
        shown: packet.rows.length,
        total: matched.length,
      });
    },

    /** Click a ref. The one hand that is a plain press. */
    page_click(input) {
      const found = resolve(input.ref);
      if (found.error) return no(found.error, found.detail);
      const moved = mislabelled(found.el, input);
      if (moved) return moved;
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
      const moved = mislabelled(el, input);
      if (moved) return moved;
      const value = String(input.value ?? "");
      if (el.disabled || el.readOnly) return no("validator_failed", "that field cannot be typed in");
      // A select has a `value` and assigning an option it does not hold silently deselects it, so
      // this hand would report success and do nothing — the one failure a hand must never have.
      // Found on a real page whose "Filter by client" control is a select, not a text field.
      if (el.tagName === "SELECT") {
        return no("validator_failed", "that is a select; use page_select to choose an option");
      }
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
      const moved = mislabelled(el, input);
      if (moved) return moved;
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
      const moved = mislabelled(found.el, input);
      if (moved) return moved;
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

  // ---- describing, for the card ----------------------------------------------------------------

  /** The most refs one `describe` answers for: a card has a handful of parameters, not a page. */
  const DESCRIBE_CAP = 32;

  /**
   * What each ref still names on this document, as `{ ref: { role, label } }`, for the panel's
   * card (ADR 0099). A ref that is dead, left behind by a navigation or never minted is simply
   * absent: the card then shows the raw ref and says it could not be described.
   *
   * Not a hand, and deliberately not in `HANDS`: nothing here is offered to a model, it reads
   * nothing a `page_find` did not already hand back, and it changes nothing. The label is the
   * page's claim about its own control; the card shows it as that and the gate never reads it.
   */
  function describe(asked) {
    const targets = {};
    for (const ref of asked.slice(0, DESCRIBE_CAP)) {
      const found = resolve(ref);
      if (found.error) continue;
      targets[ref] = { role: roleOf(found.el), label: labelOf(found.el) };
    }
    return { ok: true, output: "", targets };
  }

  // ---- the wire -------------------------------------------------------------------------------

  async function answer(message) {
    // The panel's question about its card, kept apart from the hands by its own field: a message
    // naming a hand `describe` is still an unknown hand.
    if (Array.isArray(message.describe)) return describe(message.describe);
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
    snapshots = new Map();
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

  /**
   * What each hand claims about itself, in the two flags every tool in this system carries.
   *
   * `hands.rs` holds the same table and a test asserts the two agree, the way
   * `tests/test_refusal_parity.py` pins `gate.js`'s refusal vocabulary to the Python's. Two
   * declarations because nothing imports across the boundary, and a test because a drift here is
   * a hand that is `AUTO` on one surface and `GATED` on another.
   *
   * `[reversible, side_effects]`. No hand claims `external`: it cannot know whether the button it
   * presses sends an email, and guessing low is how a chase goes out unasked.
   */
  const FLAGS = {
    page_read: [true, "none"],
    page_find: [true, "none"],
    page_wait: [true, "none"],
    page_scroll: [true, "internal"],
    page_click: [false, "internal"],
    page_fill: [false, "internal"],
    page_select: [false, "internal"],
    page_submit: [false, "internal"],
  };

  /** The label an acting hand checks before it acts (ADR 0104); `labelOf` cuts at the same bound. */
  const EXPECT = { type: "string", maxLength: LABEL_CAP };
  const REF = { type: "string", maxLength: 64 };
  const VALUE = { type: "string", maxLength: 2000 };

  /**
   * The parameters of the two continuing reads and the four acting hands, spelled as `hands.rs`'s
   * `schema_for` spells them; a Rust test holds the bounds to the same numbers. The other hands
   * keep the bare object they always had here, because `hands.rs` is the catalogue the daemon reads.
   */
  const SCHEMAS = {
    page_click: { type: "object", properties: { ref: REF, expect: EXPECT }, required: ["ref"] },
    page_submit: { type: "object", properties: { ref: REF, expect: EXPECT }, required: ["ref"] },
    page_fill: { type: "object", properties: { ref: REF, value: VALUE, expect: EXPECT }, required: ["ref", "value"] },
    page_select: { type: "object", properties: { ref: REF, value: VALUE, expect: EXPECT }, required: ["ref", "value"] },
    page_read: {
      type: "object",
      properties: {
        ref: { type: "string", maxLength: 64 },
        cursor: { type: "string", maxLength: CURSOR_MAX },
      },
    },
    page_find: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200 },
        role: { type: "string", maxLength: 40 },
        cursor: { type: "string", maxLength: CURSOR_MAX },
      },
    },
  };

  /**
   * The hands as WebMCP tool descriptors — the shape `inject.js` reports a page's own tools in.
   *
   * A surface appends these to whatever the page listed and hands the one list to `gate.js`'s
   * `manifestOf`, so a hand and a page tool are classified by the same derivation. The standard
   * annotations are filled in beside the `athena` block so a surface that reads only the hints
   * still reaches the same class.
   */
  const tools = Object.keys(HANDS).map((name) => {
    const [reversible, sideEffects] = FLAGS[name];
    return {
      name,
      title: name,
      description: DESCRIPTIONS[name] ?? "",
      inputSchema: SCHEMAS[name] ?? { type: "object" },
      annotations: { readOnlyHint: sideEffects === "none", consequentialHint: !reversible },
      athena: { reversible, side_effects: sideEffects },
    };
  });

  window.__athenaHands = { version: 1, names: Object.keys(HANDS), tools };
})();
