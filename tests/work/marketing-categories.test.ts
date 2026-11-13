import { describe, expect, it } from "vitest";
import { categoryForTaskType, isValidMarketingCategory } from "@/lib/marketing/categories";
import { DEFAULT_MARKETING_TASK_TYPES } from "@/lib/marketing/default-task-types";

describe("lib/marketing/categories", () => {
  it("correctly maps all 8 default seeded task types", () => {
    const expectedMap: Record<string, string> = {
      "Blog post": "Content & Editorial",
      "Social post": "Social Media & Community",
      "Email or newsletter": "Content & Editorial",
      "Landing page copy": "SEO & Growth",
      "Graphic": "Brand & Identity",
      "Video": "Brand & Identity",
      "Case study": "Content & Editorial",
      "Outreach": "Public Relations & Communications",
    };

    for (const taskType of DEFAULT_MARKETING_TASK_TYPES) {
      expect(categoryForTaskType(taskType.name)).toBe(expectedMap[taskType.name]);
    }
  });

  it("handles case-insensitivity and whitespace", () => {
    expect(categoryForTaskType("  BLOG POST  ")).toBe("Content & Editorial");
    expect(categoryForTaskType("graphic ")).toBe("Brand & Identity");
    expect(categoryForTaskType("  Social Post")).toBe("Social Media & Community");
  });

  it("handles heuristic keywords", () => {
    expect(categoryForTaskType("Competitor teardown")).toBe("Research & Strategy");
    expect(categoryForTaskType("Paid Google Ads Campaign")).toBe("Acquisition & Advertising");
    expect(categoryForTaskType("Feature launch memo")).toBe("Product Marketing");
    expect(categoryForTaskType("Press release distribution")).toBe("Public Relations & Communications");
  });

  it("falls back to Other / Uncategorised for unknown types or empty input", () => {
    expect(categoryForTaskType(null)).toBe("Other / Uncategorised");
    expect(categoryForTaskType(undefined)).toBe("Other / Uncategorised");
    expect(categoryForTaskType("")).toBe("Other / Uncategorised");
    expect(categoryForTaskType("Random Custom Weird Task Type")).toBe("Other / Uncategorised");
  });

  it("validates categories correctly", () => {
    expect(isValidMarketingCategory("All")).toBe(true);
    expect(isValidMarketingCategory("Brand & Identity")).toBe(true);
    expect(isValidMarketingCategory("Unknown Category")).toBe(false);
  });
});
