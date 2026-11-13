import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** What the Earn banner (#earnings) names: the newest project open in Discover that this person isn't in yet. */
export type EarnBannerProject = { name: string; openedAt: string };

/** How long after opening a project is introduced as "just opened". */
export const JUST_OPENED_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The newest project open to contributors in Discover that the person hasn't joined, isn't a member of the
 * organisation of, and hasn't already asked to join (Chloe's call, #earnings): the banner comes back for every new
 * one instead of going for good once you've joined a project. Null when there is nothing new to point at, so the
 * banner never sends anyone to an empty Discover.
 */
export async function newestOpenProjectFor(db: Db, userId: string): Promise<EarnBannerProject | null> {
  const project = await db.project.findFirst({
    where: {
      visibility: "public",
      isOpenForContributors: true,
      archivedAt: null,
      organisation: { archivedAt: null, memberships: { none: { userId } } },
      memberships: { none: { userId } },
      joinRequests: { none: { userId } },
    },
    orderBy: [{ openedForContributorsAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { name: true, openedForContributorsAt: true, createdAt: true },
  });
  if (!project) return null;
  return { name: project.name, openedAt: (project.openedForContributorsAt ?? project.createdAt).toISOString() };
}

/**
 * Whether a dismissal still covers this project: Dismiss hides the banner until a project opens after it.
 * `dismissedAt` is the time Dismiss was pressed (milliseconds; 0 or NaN when it never was).
 */
export function dismissalCovers(dismissedAt: number, openedAt: string): boolean {
  const opened = Date.parse(openedAt);
  return Number.isFinite(dismissedAt) && dismissedAt > 0 && Number.isFinite(opened) && opened <= dismissedAt;
}

/** The banner's line after "Earn with your agent.", naming the project. */
export function earnBannerLine(project: EarnBannerProject, now: number = Date.now()): string {
  const opened = Date.parse(project.openedAt);
  const recent = Number.isFinite(opened) && now - opened <= JUST_OPENED_MS;
  return recent ? `${project.name} just opened and needs help.` : `${project.name} needs help with paid tasks.`;
}
