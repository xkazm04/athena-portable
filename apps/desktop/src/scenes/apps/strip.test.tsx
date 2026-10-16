/**
 * @vitest-environment jsdom
 *
 * The page's band, driven — README section 3.1, 3.4 and 3.5, ADR 0088.
 *
 * The strip is the one part of the Apps depth on screen while a page is, so what it says about the
 * page has to agree with what the field and the app's own level say about the same page.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fixtures } from "@/modules/browser/fixtures";
import type { BrowserModel, BrowserTools } from "@/modules/browser/model";

import { StripView } from "./strip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(model: BrowserModel) {
  act(() => root.render(<StripView model={model} />));
}

const withTools = (tools: BrowserTools): BrowserModel => ({ ...fixtures.typical!, tools });
const pill = () => host.querySelector(".tab-strip > :last-child") as HTMLElement;

describe("the tools pill counts as the field does", () => {
  it("says one tool, not one tools, in its words and its title", () => {
    mount(withTools({ count: 1, transport: "webmcp-polyfill", problem: null, asking: false }));
    expect(pill().textContent).toBe("1 tool");
    expect(pill().getAttribute("title")).toBe("1 tool over webmcp-polyfill");
  });

  it("says the plural for none and for many", () => {
    mount(withTools({ count: 0, transport: null, problem: null, asking: false }));
    expect(pill().textContent).toBe("0 tools");
    expect(pill().getAttribute("title")).toBe("0 tools over no transport");
    mount(withTools({ count: 3, transport: "webmcp-native", problem: null, asking: false }));
    expect(pill().textContent).toBe("3 tools");
  });
});
