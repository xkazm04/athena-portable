/**
 * Store stamps are UTC (README section 3.5, UAT finding uat-1): the same instant reads the same in every zone.
 */
import { afterEach, expect, test } from "vitest";

import { clockOf, parseStamp, whenAgo } from "./time";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

test("a zone-less stamp is UTC, whatever zone the viewer is in", () => {
  for (const tz of ["Europe/Prague", "America/New_York", "UTC", "Asia/Tokyo"]) {
    process.env.TZ = tz;
    expect(parseStamp("2026-10-01 10:08:07")?.toISOString()).toBe("2026-10-01T10:08:07.000Z");
    expect(parseStamp("2026-10-01T10:08:07")?.toISOString()).toBe("2026-10-01T10:08:07.000Z");
  }
});

test("a stamp that carries its own zone is read as written", () => {
  expect(parseStamp("2026-10-01T10:08:07Z")?.toISOString()).toBe("2026-10-01T10:08:07.000Z");
  expect(parseStamp("2026-10-01T12:08:07+02:00")?.toISOString()).toBe("2026-10-01T10:08:07.000Z");
  expect(parseStamp("2026-10-01T12:08:07+0200")?.toISOString()).toBe("2026-10-01T10:08:07.000Z");
});

test("a date alone is midnight UTC and nonsense is null, not a made-up time", () => {
  expect(parseStamp("2026-06-20")?.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  expect(parseStamp("not a date")).toBeNull();
  expect(parseStamp("")).toBeNull();
  expect(parseStamp(null)).toBeNull();
});

test("something written seconds ago reads 'just now' in a UTC+2 zone and a UTC-5 zone", () => {
  const now = Date.parse("2026-10-01T10:08:30Z");
  for (const tz of ["Europe/Prague", "America/New_York"]) {
    process.env.TZ = tz;
    expect(whenAgo("2026-10-01 10:08:07", now)).toBe("just now");
    expect(whenAgo("2026-10-01 10:05:07", now)).toBe("3 min ago");
    expect(whenAgo("2026-10-01 08:08:07", now)).toBe("2 h ago");
  }
});

test("an unreadable stamp is shown as it is, and an empty one as never", () => {
  expect(whenAgo("soon")).toBe("soon");
  expect(whenAgo("")).toBe("never");
  expect(clockOf("soon")).toBe("soon");
});

test("the clock shows the viewer's local time for a UTC stamp", () => {
  process.env.TZ = "Europe/Prague";
  expect(clockOf("2026-10-01 10:08:07")).toBe("12:08");
  process.env.TZ = "America/New_York";
  expect(clockOf("2026-10-01 10:08:07")).toBe("06:08");
});
