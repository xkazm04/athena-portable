/**
 * The install block's states, rendered: a running install shows its bar, and a running install
 * whose poll was refused shows the refusal and Check again instead of a bar that no longer moves.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { installView } from "./model";
import { InstallBlock } from "./parts";

const RUNNING = installView({
  component: "kokoro",
  state: "downloading_engine",
  received_bytes: 1,
  total_bytes: 10,
  error: null,
});

const draw = (refusal: string | null) =>
  renderToStaticMarkup(
    <InstallBlock view={RUNNING} home={null} sizeMb={300} refusal={refusal} onInstall={() => {}} onCheck={() => {}} />,
  );

describe("a running install", () => {
  it("shows its progress while the poll answers", () => {
    const out = draw(null);
    expect(out).toContain("vs-progress");
    expect(out).not.toContain("Check again");
  });

  it("shows a refused poll and Check again, not a frozen bar", () => {
    const out = draw("the daemon is restarting");
    expect(out).not.toContain("vs-progress");
    expect(out).toContain("Lost track of the install: the daemon is restarting");
    expect(out).toContain("Check again");
    expect(out).toContain('role="alert"');
  });
});
