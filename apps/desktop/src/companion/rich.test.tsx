/** Her words' markdown is drawn, never printed as marks, and never becomes HTML. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RichMessage, blocksOf, plainOf, richText } from "./rich";

const html = (text: string) => renderToStaticMarkup(<>{richText(text)}</>);
const message = (text: string) => renderToStaticMarkup(<RichMessage text={text} />);

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

describe("RichMessage", () => {
  it("draws a heading as one bold line, lists as lists, and parts paragraphs on blank lines", () => {
    const text = "## What I found\nTailscale is **ready**.\n\n- firewall: done\n- peers: `dollarstore`\n\n1. open pairing\n2. type the code\n\n---\nThat is all.";
    expect(message(text)).toBe(
      '<p class="md-h">What I found</p><p>Tailscale is <strong>ready</strong>.</p>' +
        "<ul><li>firewall: done</li><li>peers: <code>dollarstore</code></li></ul>" +
        "<ol><li>open pairing</li><li>type the code</li></ol><p>That is all.</p>",
    );
  });

  it("keeps a paragraph's own line breaks, and plain words plain", () => {
    expect(blocksOf("one\ntwo")).toEqual([{ kind: "p", text: "one\ntwo" }]);
    expect(message("Just a sentence.")).toBe("<p>Just a sentence.</p>");
  });

  it("does not read a minus or a number inside a line as a list", () => {
    expect(message("It went from 3 - 2 = 1 to 2.5 now.")).toBe("<p>It went from 3 - 2 = 1 to 2.5 now.</p>");
  });

  it("never turns a heading or an item into markup", () => {
    expect(message("# <b>x</b>\n- <i>y</i>")).toBe('<p class="md-h">&lt;b&gt;x&lt;/b&gt;</p><ul><li>&lt;i&gt;y&lt;/i&gt;</li></ul>');
  });
});

describe("plainOf", () => {
  it("is her words for a one-line caption: no marks, blocks run together", () => {
    expect(plainOf("## Found it\nTailscale is **ready** on `kaziho`.\n\n- firewall done\n- peers 1")).toBe(
      "Found it Tailscale is ready on kaziho. firewall done peers 1",
    );
    expect(plainOf("")).toBe("");
  });
});
