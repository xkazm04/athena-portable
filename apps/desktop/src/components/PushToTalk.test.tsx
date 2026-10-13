/** The push-to-talk pill's accessible name — README section 3.1, ADR 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import PushToTalk from "./PushToTalk";

const noop = () => undefined;

it("is named by the words it shows, with the longer sentence left to the tooltip", () => {
  const h = renderToStaticMarkup(
    <PushToTalk phase="listening" available reason="" partial="" onPress={noop} onRelease={noop} />,
  );
  expect(h).not.toContain("aria-label");
  expect(h).toContain(">Listening<");
  expect(h).toContain('title="Release to send"');
});

it("says why it is off, on the title, while its name stays the visible word", () => {
  const h = renderToStaticMarkup(
    <PushToTalk phase="off" available={false} reason="No microphone" partial="" onPress={noop} onRelease={noop} />,
  );
  expect(h).not.toContain("aria-label");
  expect(h).toContain(">Voice off<");
  expect(h).toContain('title="No microphone"');
});
