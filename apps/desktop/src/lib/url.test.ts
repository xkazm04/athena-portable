import { expect, test } from "vitest";

import { hostOf, normaliseUrl } from "./url";

test("a bare host gets a scheme and a typed scheme is left alone", () => {
  expect(normaliseUrl("example.test")).toBe("http://example.test");
  expect(normaliseUrl("  example.test/a/b  ")).toBe("http://example.test/a/b");
  expect(normaliseUrl("https://example.test")).toBe("https://example.test");
  expect(normaliseUrl("about:blank")).toBe("about:blank");
  expect(normaliseUrl("")).toBeNull();
  expect(normaliseUrl("   ")).toBeNull();
});

test("host:port is a port, not a scheme", () => {
  expect(normaliseUrl("localhost:3004")).toBe("http://localhost:3004");
  expect(normaliseUrl("127.0.0.1:8899/health")).toBe("http://127.0.0.1:8899/health");
});

test("hostOf falls back to what it was given", () => {
  expect(hostOf("https://example.test/a?b=c")).toBe("example.test");
  expect(hostOf("about:blank")).toBe("about:blank");
  expect(hostOf("not a url")).toBe("not a url");
});
