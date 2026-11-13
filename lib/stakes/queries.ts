import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { workflowFor } from "@/lib/workflow";
import { issueHref } from "@/lib/issue-ref";
import { ideaPath, refOf } from "@/lib/project-paths";
import { LIVE_STAKE_STATUSES, stakeCapCounts } from "@/lib/stake-rules";
import type { MyStake, MyStakesData, StakeLimits, StakeTarget } from "@/lib/stakes/board";

/**
 * Everything the My stakes page shows (#my-stakes), for one signed-in person:
 * the stakes placed for them or by an agent they own, in the organisations
 * they belong to now, and nobody else's, admins included (as on Activity).
 * In a contest, the other stake on the issue shows too: its plan and votes are
 * what the person's stake is up against, and any agent in the organisation can
 * read them (GET /api/v1/issues/{id}/stake). Read only: settling stays with the
 * engine (lib/agent-api/stakes.ts), so opening the page never moves an issue.
 */

/** How many live, and how many ended, stakes the page loads. */
export const MY_STAKES_LOAD_LIMIT = 100;

const stakeSelect = {
  id: true,
  organisationId: true,
  projectId: true,
  status: true,
  resolution: true,
  summary: true,
  description: true,
  createdAt: true,
  lastRefreshAt: true,
  windowEndsAt: true,
  contestEndsAt: true,
  expiresAt: true,
  resolvedAt: true,
  bugId: true,
  agent: { select: { id: true, name: true, username: true } },
  bug: { select: { number: true, title: true, isDeleted: true } },
  idea: { select: { number: true, title: true, isDeleted: true } },
} as const satisfies Prisma.IssueStakeSelect;

type StakeRowDb = Prisma.IssueStakeGetPayload<{ select: typeof stakeSelect }>;
type ProjectRow = { id: string; name: string; slug: string; organisationId: string; organisation: { slug: string } };

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The stakes that are this person's: for them, or placed by an agent they own, in organisations they belong to. */
export function myStakesWhere(userId: string, organisationIds: string[]): Prisma.IssueStakeWhereInput {
  return {
    organisationId: { in: organisationIds },
    OR: [{ beneficiaryUserId: userId }, { agent: { ownerUserId: userId } }],
  };
}

function targetOf(stake: StakeRowDb, project: ProjectRow | undefined): { target: StakeTarget | null; fromIdea: StakeTarget | null } {
  const idea = stake.idea
    ? {
        kind: "idea" as const,
        number: stake.idea.number,
        title: stake.idea.title,
        href: project && !stake.idea.isDeleted ? ideaPath(refOf(project), stake.idea.number) : null,
      }
    : null;
  if (!stake.bug) return { target: idea, fromIdea: null };
  return {
    target: {
      kind: "issue",
      number: stake.bug.number,
      title: stake.bug.title,
      href: project && !stake.bug.isDeleted ? issueHref({ number: stake.bug.number, project }) : null,
    },
    fromIdea: idea,
  };
}

export async function loadMyStakes(userId: string): Promise<MyStakesData> {
  const loadedAt = Date.now();
  const memberships = await prisma.membership.findMany({
    where: { userId, organisation: { archivedAt: null } },
    select: { organisationId: true },
  });
  const organisationIds = memberships.map((row) => row.organisationId);
  if (!organisationIds.length) return { stakes: [], limits: [], loadedAt };

  const where = myStakesWhere(userId, organisationIds);
  const [live, ended, held] = await Promise.all([
    prisma.issueStake.findMany({
      where: { AND: [where, { status: { in: LIVE_STAKE_STATUSES } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MY_STAKES_LOAD_LIMIT,
      select: stakeSelect,
    }),
    prisma.issueStake.findMany({
      where: { AND: [where, { status: { notIn: LIVE_STAKE_STATUSES } }] },
      orderBy: [{ resolvedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: MY_STAKES_LOAD_LIMIT,
      select: stakeSelect,
    }),
    // Projects where the person holds issues In progress: the in-progress cap applies there too.
    prisma.issueClaim.findMany({
      where: { beneficiaryUserId: userId, status: "active", releasedAt: null, bug: { organisationId: { in: organisationIds }, isDeleted: false, status: "in_progress" } },
      distinct: ["bugId"],
      take: MY_STAKES_LOAD_LIMIT,
      select: { bug: { select: { projectId: true } } },
    }),
  ]);
  const rows = [...live, ...ended];

  // In a contest, the other stake on the same issue, and both sides' votes.
  const contested = rows.filter((stake) => stake.status === "contested" && stake.bugId);
  const rivals = contested.length
    ? await prisma.issueStake.findMany({
        where: { bugId: { in: contested.map((stake) => stake.bugId!) }, status: "contested", id: { notIn: contested.map((stake) => stake.id) } },
        select: { id: true, bugId: true, summary: true, description: true, createdAt: true, beneficiaryUserId: true, agent: { select: { name: true } } },
      })
    : [];
  const [tally, owners] = await Promise.all([
    contested.length
      ? prisma.stakeVote.groupBy({
          by: ["stakeId"],
          where: { stakeId: { in: [...contested.map((stake) => stake.id), ...rivals.map((rival) => rival.id)] } },
          _sum: { weight: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    rivals.length
      ? prisma.user.findMany({ where: { id: { in: [...new Set(rivals.map((rival) => rival.beneficiaryUserId))] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const votesOf = new Map(tally.map((row) => [row.stakeId, { votes: row._sum.weight ?? 0, voters: row._count._all }]));
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name]));
  const rivalOf = new Map(rivals.map((rival) => [rival.bugId, rival]));

  // Projects: names and links for every stake, and the caps where the person has live stakes or work In progress.
  const liveProjectIds = new Set([...live.map((stake) => stake.projectId), ...held.map((claim) => claim.bug.projectId)]);
  const projectIds = [...new Set([...rows.map((stake) => stake.projectId), ...liveProjectIds])];
  const projects = new Map(
    (await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, slug: true, organisationId: true, organisation: { select: { slug: true } } },
    })).map((project) => [project.id, project]),
  );

  const limits: StakeLimits[] = (
    await Promise.all(
      [...liveProjectIds].map(async (projectId) => {
        const project = projects.get(projectId);
        if (!project) return null;
        const [workflow, used] = await Promise.all([
          workflowFor(projectId),
          stakeCapCounts(prisma, { organisationId: project.organisationId, projectId, userId }),
        ]);
        return {
          projectId,
          project: project.name,
          openUsed: used.open,
          openLimit: workflow.stakeLimit,
          inProgressUsed: used.inProgress,
          inProgressLimit: workflow.stakeInProgressLimit,
        };
      }),
    )
  )
    .filter((row): row is StakeLimits => row !== null)
    // Projects with live stakes first, then those where only the in-progress cap applies.
    .sort((a, b) => Number(b.openUsed > 0) - Number(a.openUsed > 0) || a.project.localeCompare(b.project));

  const stakes: MyStake[] = rows.map((stake) => {
    const project = projects.get(stake.projectId);
    const rival = stake.status === "contested" && stake.bugId ? rivalOf.get(stake.bugId) : undefined;
    const mine = votesOf.get(stake.id) ?? { votes: 0, voters: 0 };
    return {
      id: stake.id,
      status: stake.status,
      resolution: stake.resolution,
      summary: stake.summary,
      description: stake.description,
      agent: { id: stake.agent.id, name: stake.agent.name ?? "Agent", username: stake.agent.username },
      project: { id: stake.projectId, name: project?.name ?? "Project" },
      ...targetOf(stake, project),
      createdAt: stake.createdAt.toISOString(),
      lastRefreshAt: stake.lastRefreshAt.toISOString(),
      windowEndsAt: iso(stake.windowEndsAt),
      contestEndsAt: iso(stake.contestEndsAt),
      expiresAt: iso(stake.expiresAt),
      resolvedAt: iso(stake.resolvedAt),
      votes: mine.votes,
      voters: mine.voters,
      rival: rival
        ? {
            id: rival.id,
            agentName: rival.agent.name ?? "Agent",
            ownerName: ownerName.get(rival.beneficiaryUserId) ?? null,
            summary: rival.summary,
            description: rival.description,
            createdAt: rival.createdAt.toISOString(),
            ...(votesOf.get(rival.id) ?? { votes: 0, voters: 0 }),
          }
        : null,
    };
  });

  return { stakes, limits, loadedAt };
}
