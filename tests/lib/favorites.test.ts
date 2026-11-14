import { describe, expect, it, vi } from "vitest";
import {
  favoriteIssueIds,
  favoritedBugIds,
  favoritedWhere,
  isFavorited,
  setFavorite,
} from "@/lib/favorites";

type Db = Parameters<typeof setFavorite>[0];

function dbWith(issueFavorite: Record<string, unknown>): Db {
  return { issueFavorite } as unknown as Db;
}

describe("setFavorite", () => {
  it("stars an issue by adding a row keyed by person and issue", async () => {
    const createMany = vi.fn();
    const db = dbWith({ createMany });

    await expect(setFavorite(db, "u1", "b1", true)).resolves.toBe(true);

    expect(createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", bugId: "b1" }],
      skipDuplicates: true,
    });
  });

  it("stars again without failing or duplicating the row", async () => {
    const createMany = vi.fn();
    const db = dbWith({ createMany });

    await setFavorite(db, "u1", "b1", true);
    await setFavorite(db, "u1", "b1", true);

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[1][0].skipDuplicates).toBe(true);
  });

  it("unstars by deleting the row, and unstarring again stays quiet", async () => {
    const deleteMany = vi.fn();
    const db = dbWith({ deleteMany });

    await expect(setFavorite(db, "u1", "b1", false)).resolves.toBe(false);
    await setFavorite(db, "u1", "b1", false);

    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", bugId: "b1" } });
  });
});

describe("isFavorited", () => {
  it("is true only while the row exists", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ userId: "u1" }).mockResolvedValueOnce(null);
    const db = dbWith({ findUnique });

    await expect(isFavorited(db, "u1", "b1")).resolves.toBe(true);
    await expect(isFavorited(db, "u1", "b2")).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_bugId: { userId: "u1", bugId: "b1" } },
      select: { userId: true },
    });
  });
});

describe("favoritedBugIds", () => {
  it("returns the starred subset of the issues on screen", async () => {
    const findMany = vi.fn().mockResolvedValue([{ bugId: "b1" }]);
    const db = dbWith({ findMany });

    await expect(favoritedBugIds(db, "u1", ["b1", "b2", "b1"])).resolves.toEqual(new Set(["b1"]));
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1", bugId: { in: ["b1", "b2"] } },
      select: { bugId: true },
    });
  });

  it("skips the query when there is nothing to check", async () => {
    const findMany = vi.fn();
    const db = dbWith({ findMany });

    await expect(favoritedBugIds(db, "u1", [])).resolves.toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("favoriteIssueIds", () => {
  it("lists the person's stars newest first, as the database returns them", async () => {
    const findMany = vi.fn().mockResolvedValue([{ bugId: "b2" }, { bugId: "b1" }]);
    const db = dbWith({ findMany });

    await expect(favoriteIssueIds(db, "u1")).resolves.toEqual(["b2", "b1"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      select: { bugId: true },
    });
  });

  it("narrows to one project and a page size when asked", async () => {
    const findMany = vi.fn().mockResolvedValue([{ bugId: "b1" }]);
    const db = dbWith({ findMany });

    await favoriteIssueIds(db, "u1", { projectId: "p1", limit: 10 });

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1", bug: { projectId: "p1" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { bugId: true },
    });
  });
});

describe("favoritedWhere", () => {
  it("filters lists to starred issues without taking over the search box's OR", () => {
    expect(favoritedWhere("u1")).toEqual({
      AND: [{ favorites: { some: { userId: "u1" } } }],
    });
  });
});
