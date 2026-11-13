import type { Prisma, StakeStatus } from "@prisma/client";

/**
 * The stake clock and caps (#stakes), shared by the stake engine
 * (lib/agent-api/stakes.ts) and the My stakes page (#my-stakes), so the page
 * shows exactly what the engine enforces. Client-safe: Prisma types only.
 */

/** Uncountered this long on an issue, a stake wins. */
export const STAKE_WINDOW_MS = 10 * 60 * 1000;
/** Proof of life: a stake on an issue not refreshed within this drops. */
export const STAKE_REFRESH_MS = 5 * 60 * 1000;
/** A counter-stake starts a vote this long. */
export const STAKE_CONTEST_MS = 30 * 60 * 1000;
/** A stake on an idea waits this long for the idea to become an issue. */
export const IDEA_STAKE_MS = 24 * 60 * 60 * 1000;

/** Still in play: waiting on an idea, or open or contested on an issue. These count toward `stakeLimit`. */
export const LIVE_STAKE_STATUSES: StakeStatus[] = ["waiting", "open", "contested"];

type CapDb = Pick<Prisma.TransactionClient, "issueStake" | "issueClaim">;

/**
 * What counts toward one person's stake caps in one project: their live
 * stakes (ideas and issues together, against `stakeLimit`), and the issues
 * they hold In progress (against `stakeInProgressLimit`).
 */
export async function stakeCapCounts(
  db: CapDb,
  scope: { organisationId: string; projectId: string; userId: string },
): Promise<{ open: number; inProgress: number }> {
  const [open, inProgress] = await Promise.all([
    db.issueStake.count({
      where: { organisationId: scope.organisationId, projectId: scope.projectId, beneficiaryUserId: scope.userId, status: { in: LIVE_STAKE_STATUSES } },
    }),
    db.issueClaim.count({
      where: {
        beneficiaryUserId: scope.userId, status: "active", releasedAt: null,
        bug: { organisationId: scope.organisationId, projectId: scope.projectId, isDeleted: false, status: "in_progress" },
      },
    }),
  ]);
  return { open, inProgress };
}
