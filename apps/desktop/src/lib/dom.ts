/**
 * Twelve lines of DOM, which is the whole of this panel's rendering (ADR 0012).
 *
 * A view in this build is a pure function from a view-model to an element. That is all a framework
 * would be giving us here, and a framework would also be giving us a build step, a lockfile full of
 * transitive dependencies and a preview harness that needs a bundler — in a repository whose fifth
 * invariant is that nothing heavy is mandatory.
 *
 * `h` sets text through `textContent` and never through `innerHTML`. Everything this panel renders
 * came from a page the user was browsing, a model, or a tool's output, and exactly none of it is
 * trusted markup.
 */

type Child = Node | string | null | undefined | false;

export interface Attrs {
  class?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  href?: string;
  src?: string;
  role?: string;
  /** `data-*` pairs, which is how a test finds a node without depending on class names. */
  data?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  const { data, on, ...plain } = attrs;
  for (const [key, value] of Object.entries(plain)) {
    if (value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const [key, value] of Object.entries(data ?? {})) {
    el.dataset[key] = value;
  }
  for (const [event, handler] of Object.entries(on ?? {})) {
    if (handler) el.addEventListener(event, handler);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/** Replace an element's children in one operation, so a re-render never shows a half-empty panel. */
export function replace(host: Element, next: Node): void {
  host.replaceChildren(next);
}

/** A class list built from conditions, because the alternative is string concatenation with holes. */
export function classes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
