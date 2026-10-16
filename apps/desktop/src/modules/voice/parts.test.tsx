/**
 * The pieces both Voice moods share — README section 3.1, ADR 0028: what an install says while it
 * runs. Rendered to markup, so no DOM is needed.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { installView } from "./model";
import { InstallBlock } from "./parts";

const RUNNING = installView({
  component: "kokoro",
  state: "downloading_engine",
  received_bytes: 4 * 1024 * 1024,
  total_bytes: 10 * 1024 * 1024,
  error: null,
});

const draw = (refusal: string | null) =>
  renderToStaticMarkup(
    <InstallBlock view={RUNNING} home={null} sizeMb={360} refusal={refusal} onInstall={() => {}} onCheck={() => {}} />,
  );

describe("a running install", () => {
  it("says why its bar is holding still when a read of it failed", () => {
    expect(draw("the install state could not be read")).toContain("the install state could not be read");
  });

  it("says nothing extra while every read lands", () => {
    expect(draw(null)).not.toContain("vs-error");
  });
});
