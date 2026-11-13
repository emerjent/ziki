import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/theme-toggle", () => ({ useTheme: () => ["light", vi.fn()], applyThemeClient: vi.fn() }));

import { navHref } from "@/components/homepage/site-nav";

describe("Security in the public menu (#security-checks)", () => {
  it("always opens the public Ziki Security page", () => {
    expect(navHref("/security", false)).toBe("/security");
    expect(navHref("/security", true)).toBe("/security-check");
  });

  it("leaves the other links alone", () => {
    expect(navHref("/how-it-works", true)).toBe("/how-it-works");
  });
});
