import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Starred issues (#902).
 *
 * A favorite is a private bookmark: unlike watching it has no default and
 * changes nothing about notifications, so a person's favorites are exactly
 * the rows they created by starring. The row exists only while the star is
 * on, which keeps `favoritedWhere` a plain existence check.
 */

type Db = Pick<PrismaClient, "issueFavorite"> | Pick<Prisma.TransactionClient, "issueFavorite">;

/**
 * Bug-list filter for "Starred". Returned as a single `AND` entry for the
 * same reason as `watchingWhere`: the list's search box assigns `where.OR`
 * for itself and would overwrite a second one.
 */
export function favoritedWhere(userId: string): Prisma.BugWhereInput {
  return { AND: [{ favorites: { some: { userId } } }] };
}

/** Whether this person starred this issue. */
export async function isFavorited(db: Db, userId: string, bugId: string): Promise<boolean> {
  const row = await db.issueFavorite.findUnique({
    where: { userId_bugId: { userId, bugId } },
    select: { userId: true },
  });
  return row !== null;
}

/** Which of these issues this person starred, for lighting up stars in a list. */
export async function favoritedBugIds(
  db: Db,
  userId: string,
  bugIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(bugIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.issueFavorite.findMany({
    where: { userId, bugId: { in: ids } },
    select: { bugId: true },
  });
  return new Set(rows.map((row) => row.bugId));
}

/**
 * Turn the star on or off. Starring twice is the same as starring once, and
 * unstarring an issue that isn't starred is a no-op.
 */
export async function setFavorite(
  db: Db,
  userId: string,
  bugId: string,
  favorited: boolean,
): Promise<boolean> {
  if (!favorited) {
    await db.issueFavorite.deleteMany({ where: { userId, bugId } });
    return false;
  }
  await db.issueFavorite.createMany({ data: [{ userId, bugId }], skipDuplicates: true });
  return true;
}

/**
 * This person's starred issues, newest star first. `projectId` narrows the
 * list to one project; callers still apply their own visibility filters.
 */
export async function favoriteIssueIds(
  db: Db,
  userId: string,
  options: { projectId?: string; limit?: number } = {},
): Promise<string[]> {
  const rows = await db.issueFavorite.findMany({
    where: {
      userId,
      ...(options.projectId ? { bug: { projectId: options.projectId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    ...(options.limit ? { take: options.limit } : {}),
    select: { bugId: true },
  });
  return rows.map((row) => row.bugId);
}
