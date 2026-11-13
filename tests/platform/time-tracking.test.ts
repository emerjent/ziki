import { describe, expect, it } from "vitest";
import {
  formatDuration,
  isValidMinutes,
  MAX_TIME_ENTRY_MINUTES,
  parseMinutesInput,
  sumMinutes,
} from "@/lib/time-tracking";

describe("time tracking", () => {
  it("formats a duration in hours and minutes", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(1440)).toBe("24h");
  });

  it("accepts only whole minutes in range", () => {
    expect(isValidMinutes(1)).toBe(true);
    expect(isValidMinutes(MAX_TIME_ENTRY_MINUTES)).toBe(true);
    expect(isValidMinutes(0)).toBe(false);
    expect(isValidMinutes(MAX_TIME_ENTRY_MINUTES + 1)).toBe(false);
    expect(isValidMinutes(1.5)).toBe(false);
    expect(isValidMinutes("30")).toBe(false);
  });

  it("parses form input and rejects everything else", () => {
    expect(parseMinutesInput("30")).toBe(30);
    expect(parseMinutesInput(" 45 ")).toBe(45);
    expect(parseMinutesInput(15)).toBe(15);
    expect(parseMinutesInput("0")).toBeNull();
    expect(parseMinutesInput("-5")).toBeNull();
    expect(parseMinutesInput("1.5")).toBeNull();
    expect(parseMinutesInput("abc")).toBeNull();
    expect(parseMinutesInput("")).toBeNull();
    expect(parseMinutesInput(null)).toBeNull();
  });

  it("sums the entries into the issue total", () => {
    expect(sumMinutes([])).toBe(0);
    expect(sumMinutes([{ minutes: 30 }, { minutes: 90 }])).toBe(120);
  });
});
