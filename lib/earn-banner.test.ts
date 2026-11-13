import { describe, expect, it, vi } from "vitest";
import { JUST_OPENED_MS, dismissalCovers, earnBannerLine, newestOpenProjectFor } from "@/lib/earn-banner";

describe("dismissalCovers", () => {
  const opened = "2026-11-01T10:00:00.000Z";
  const openedMs = Date.parse(opened);

  it("hides the banner for a project that opened before Dismiss was pressed", () => {
    expect(dismissalCovers(openedMs + 1000, opened)).toBe(true);
  });

  it("brings it back for a project that opened after Dismiss", () => {
    expect(dismissalCovers(openedMs - 1000, opened)).toBe(false);
  });

  it("shows it when Dismiss was never pressed or the stored value is junk", () => {
    expect(dismissalCovers(0, opened)).toBe(false);
    expect(dismissalCovers(Number("nope"), opened)).toBe(false);
  });
});

describe("earnBannerLine", () => {
  const now = Date.parse("2026-11-08T12:00:00.000Z");

  it("says a recently opened project just opened", () => {
    const openedAt = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(earnBannerLine({ name: "Ziki Marketing", openedAt }, now)).toBe("Ziki Marketing just opened and needs help.");
  });

  it("doesn't call an older project new", () => {
    const openedAt = new Date(now - JUST_OPENED_MS - 1000).toISOString();
    expect(earnBannerLine({ name: "Start NG", openedAt }, now)).toBe("Start NG needs help with paid tasks.");
  });
});

describe("newestOpenProjectFor", () => {
  it("asks for the newest open public project the person isn't in, hasn't joined and hasn't asked to join", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      name: "Ziki Marketing",
      openedForContributorsAt: new Date("2026-11-07T09:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const db = { project: { findFirst } } as unknown as Parameters<typeof newestOpenProjectFor>[0];

    await expect(newestOpenProjectFor(db, "user-1")).resolves.toEqual({ name: "Ziki Marketing", openedAt: "2026-11-07T09:00:00.000Z" });
    const args = findFirst.mock.calls[0][0];
    expect(args.where).toMatchObject({
      visibility: "public",
      isOpenForContributors: true,
      archivedAt: null,
      organisation: { archivedAt: null, memberships: { none: { userId: "user-1" } } },
      memberships: { none: { userId: "user-1" } },
      joinRequests: { none: { userId: "user-1" } },
    });
    expect(args.orderBy[0]).toEqual({ openedForContributorsAt: { sort: "desc", nulls: "last" } });
  });

  it("falls back to when the project was made if it has no opened time", async () => {
    const findFirst = vi.fn().mockResolvedValue({ name: "Start NG", openedForContributorsAt: null, createdAt: new Date("2026-03-01T00:00:00.000Z") });
    const db = { project: { findFirst } } as unknown as Parameters<typeof newestOpenProjectFor>[0];
    await expect(newestOpenProjectFor(db, "user-1")).resolves.toEqual({ name: "Start NG", openedAt: "2026-03-01T00:00:00.000Z" });
  });

  it("returns nothing when there is no project left to join", async () => {
    const db = { project: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as Parameters<typeof newestOpenProjectFor>[0];
    await expect(newestOpenProjectFor(db, "user-1")).resolves.toBeNull();
  });
});
