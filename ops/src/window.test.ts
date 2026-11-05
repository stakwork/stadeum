import { describe, expect, it } from "vitest";

import { currentWindow, localParts, parseHHMM } from "./window.js";

const at = (iso: string) => new Date(iso);

describe("the daily window", () => {
  const w = { start: "03:00", end: "05:00", timeZone: "UTC" };

  it("is open from its start until just before its end", () => {
    expect(currentWindow(at("2026-11-05T02:59:00Z"), w)).toBeNull();
    expect(currentWindow(at("2026-11-05T03:00:00Z"), w)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-05T04:59:00Z"), w)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-05T05:00:00Z"), w)).toBeNull();
  });

  it("is read in the admin's time zone", () => {
    const tokyo = { ...w, timeZone: "Asia/Tokyo" };
    // 03:30 in Tokyo is 18:30 UTC the day before.
    expect(currentWindow(at("2026-11-04T18:30:00Z"), tokyo)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-05T03:30:00Z"), tokyo)).toBeNull();
    // New York's daylight saving ended 2026-11-01: 03:00 EST is 08:00 UTC.
    const ny = { ...w, timeZone: "America/New_York" };
    expect(currentWindow(at("2026-11-05T08:15:00Z"), ny)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-05T07:15:00Z"), ny)).toBeNull();
  });

  it("crosses midnight, named by the date it opened on", () => {
    const late = { start: "23:00", end: "01:00", timeZone: "UTC" };
    expect(currentWindow(at("2026-11-05T23:30:00Z"), late)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-06T00:30:00Z"), late)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-06T01:00:00Z"), late)).toBeNull();
    expect(currentWindow(at("2026-03-01T00:10:00Z"), late)).toBe("2026-02-28");
  });

  it("is the whole day when it starts where it ends", () => {
    const allDay = { start: "06:00", end: "06:00", timeZone: "UTC" };
    expect(currentWindow(at("2026-11-05T06:00:00Z"), allDay)).toBe("2026-11-05");
    expect(currentWindow(at("2026-11-05T05:59:00Z"), allDay)).toBe("2026-11-04");
  });

  it("refuses a time that is not HH:MM", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
    for (const bad of ["3:00", "24:00", "03:60", "0300", ""]) expect(() => parseHHMM(bad)).toThrow();
  });

  it("reads the local date and minute", () => {
    expect(localParts(at("2026-11-05T00:05:00Z"), "UTC")).toEqual({ date: "2026-11-05", minutes: 5 });
    // Pacific Standard Time again since 2026-11-01: UTC-8.
    expect(localParts(at("2026-11-05T00:05:00Z"), "America/Los_Angeles")).toEqual({ date: "2026-11-04", minutes: 16 * 60 + 5 });
  });
});
