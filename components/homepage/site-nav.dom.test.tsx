// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/theme-toggle", () => ({ useTheme: () => ["light", vi.fn()], applyThemeClient: vi.fn() }));

import { SiteNav, siteNavHref } from "./site-nav";

afterEach(() => cleanup());

describe("the homepage nav's Security link", () => {
  it("opens the public Security page for everyone: /security signed out, /security-check signed in", () => {
    expect(siteNavHref("/security", false)).toBe("/security");
    expect(siteNavHref("/security", true)).toBe("/security-check");
  });

  it("leaves every other link alone", () => {
    expect(siteNavHref("/how-it-works", true)).toBe("/how-it-works");
    expect(siteNavHref("/agents", false)).toBe("/agents");
  });

  it("renders the right Security link in the nav", () => {
    const { unmount } = render(<SiteNav signedIn />);
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security-check");
    unmount();
    render(<SiteNav signedIn={false} />);
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");
  });
});
