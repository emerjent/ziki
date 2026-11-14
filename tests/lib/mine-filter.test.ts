import { describe, expect, it } from "vitest";
import { mineFilterLabels, mineFilterWhere, parseMineFilter } from "@/lib/mine-filter";

describe("starred view on the issues list", () => {
  it("is picked up from the address", () => {
    expect(parseMineFilter("starred")).toBe("starred");
  });

  it("lists the person's starred issues and nothing else", () => {
    expect(mineFilterWhere("starred", "u1")).toEqual({
      AND: [{ favorites: { some: { userId: "u1" } } }],
    });
  });

  it("filters nothing for a signed-out viewer", () => {
    expect(mineFilterWhere("starred", undefined)).toEqual({});
  });

  it("has a name the filter menu can show", () => {
    expect(mineFilterLabels.starred).toBe("Starred");
  });
});
