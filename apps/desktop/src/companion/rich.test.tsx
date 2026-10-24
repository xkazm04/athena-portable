/** Her words' bold and code are drawn, never printed as marks, and never become HTML. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { richText } from "./rich";

const html = (text: string) => renderToStaticMarkup(<>{richText(text)}</>);

describe("richText", () => {
  it("draws **bold** and `code` and drops their marks", () => {
    expect(html("The firewall is **done**; next is `list_overlay_peers`.")).toBe(
      "The firewall is <strong>done</strong>; next is <code>list_overlay_peers</code>.",
    );
  });

  it("leaves a lone asterisk, an unclosed mark and a mark across lines as typed", () => {
    expect(html("2 * 3 is six")).toBe("2 * 3 is six");
    expect(html("**not closed")).toBe("**not closed");
    expect(html("**one\ntwo**")).toBe("**one\ntwo**");
  });

  it("never turns her words into markup", () => {
    expect(html("**<img src=x onerror=alert(1)>**")).toBe("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>");
  });
});
