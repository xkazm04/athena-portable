/** A replay turn renders her words: a markdown table is a table, not raw pipes (spark refilm-prep). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TraceTurn } from "@/lib/playbooks";

import TurnView, { cells } from "./turn";

const turn = (said: string): TraceTurn => ({
  portal: "Insurer",
  user: "",
  continued: true,
  said,
  saidChars: said.length,
  reads: [],
  cards: [],
});

describe("her words in a replay turn", () => {
  it("renders a markdown table as a table and drops the separator row", () => {
    const html = renderToStaticMarkup(
      <TurnView
        turn={turn("Here is what I found.\n| Claim | Status |\n|---|---|\n| C-1001 | Final |\n| C-1002 | **Pending** |")}
        at={0}
        total={1}
      />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th>Claim</th>");
    expect(html).toContain("<td>C-1001</td>");
    expect(html).toContain("<strong>Pending</strong>");
    expect(html).not.toContain("|---|");
    expect(html).not.toContain("| Claim");
  });

  it("keeps a row cut short by the shown-of-total bound", () => {
    expect(cells("| C-1007")).toEqual(["C-1007"]);
    expect(cells("| a | b |")).toEqual(["a", "b"]);
  });

  it("drops a heading's hashes", () => {
    const html = renderToStaticMarkup(<TurnView turn={turn("## Summary\nAll ten EOBs read.")} at={0} total={1} />);
    expect(html).toContain("<p>Summary</p>");
    expect(html).not.toContain("##");
  });
});
