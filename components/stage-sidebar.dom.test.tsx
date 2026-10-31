// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StageSidebar, type SidebarStep } from "./stage-sidebar";

afterEach(() => {
  cleanup();
});

// Screen readers read the name and count together, e.g. "Rejected ideas, 5".
const linkName = (label: string, count: number) => new RegExp(`^${label}\\s*,\\s*${count}$`);

const steps: SidebarStep[] = [
  { label: "New ideas", count: 3, href: "/issues?status=idea", selected: true },
  { label: "Rejected ideas", count: 5, href: "/issues?status=rejected", selected: false },
  { label: "Open", count: 12, href: "/issues?status=open", selected: false },
];

describe("StageSidebar (#739)", () => {
  it("puts the count box inside the same link as the stage name", () => {
    render(<StageSidebar steps={steps} />);

    for (const step of steps) {
      const link = screen.getByRole("link", { name: linkName(step.label, step.count) });
      const box = within(link).getByTestId("stage-count");
      expect(box.textContent).toBe(String(step.count));
      // A click on the box lands on the link, so it opens the same list.
      expect(box.closest("a")).toBe(link);
      expect(link.getAttribute("href")).toBe(step.href);
    }
  });

  it("renders exactly one link per stage, so Tab stops once each", () => {
    render(<StageSidebar steps={steps} />);

    expect(screen.getAllByRole("link")).toHaveLength(steps.length);
    for (const item of screen.getAllByRole("listitem")) {
      expect(within(item).getAllByRole("link")).toHaveLength(1);
    }
  });

  it("keeps aria-current on the selected stage only", () => {
    render(<StageSidebar steps={steps} />);

    expect(screen.getByRole("link", { name: linkName("New ideas", 3) }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: linkName("Rejected ideas", 5) }).getAttribute("aria-current")).toBeNull();
  });
});
