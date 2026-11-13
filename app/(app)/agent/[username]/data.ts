import { prisma } from "@/lib/prisma";
import { auditWhere } from "@/lib/agent-audit/visibility";
import { agentPicturePath, readAgentProfile } from "@/lib/agents/profile";
import type { AgentActivityItem, AgentProfileData } from "./agent-profile";
import type { AgentReview } from "./agent-reviews";
import type { AgentTab } from "./agent-tabs";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { isClaimStalled, classifyAgentStatus, AGENT_WORKING_WINDOW_MS } from "@/lib/dashboard-overview";
import { isDeliveryOverdue } from "@/lib/claim-deadline";
import { issueHref } from "@/lib/issue-ref";
import { isAdminOfOrganisation } from "@/lib/agents/membership";

/** The agent pages' data (#agent-profile): the public profile at /agent/{username} and its edit page. */

/** Called "active now" when its key was used this recently. */
const ACTIVE_NOW_MS = 5 * 60_000;

/** How many recent actions the profile lists. */
const ACTIVITY_LIMIT = 20;

export type AgentStuckContext = {
  summary: string;
  issue: { number: number; title: string; href: string } | null;
  lastHeartbeatAt: Date | null;
  deliverBy: Date | null;
  deadlinePassed: boolean;
};

function quietDuration(since: Date | null, now: Date): string {
  if (!since) return "a while";
  const minutes = Math.max(1, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** Private, organisation-scoped stuck context for members viewing an agent profile. */
export async function loadAgentStuckContext({
  agentId,
  organisationId,
  viewer,
  now = new Date(),
}: {
  agentId: string;
  organisationId: string;
  viewer: { id: string; role?: import("@/lib/roles").AppRole | null };
  now?: Date;
}): Promise<AgentStuckContext | null> {
  const [membership, isAdmin] = await Promise.all([
    prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId, userId: viewer.id } },
      select: { userId: true },
    }),
    isAdminOfOrganisation(viewer, organisationId),
  ]);
  if (!membership && !isAdmin) return null;

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      revokedAt: null,
      activations: { some: { organisationId, deactivatedAt: null } },
    },
    select: {
      questions: {
        where: { answeredAt: null, OR: [{ bug: { organisationId } }, { bugId: null }] },
        take: 1,
        select: { id: true },
      },
      claims: {
        where: { status: "active", releasedAt: null, bug: { organisationId } },
        orderBy: [{ claimedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          claimedAt: true,
          lastHeartbeatAt: true,
          deliverBy: true,
          waitingOnOwnerSince: true,
          bug: {
            select: {
              number: true,
              title: true,
              status: true,
              isDeleted: true,
              pullRequestUrl: true,
              project: { select: { slug: true, organisation: { select: { slug: true } } } },
            },
          },
        },
      },
    },
  });
  if (!agent) return null;

  const claim = agent.claims[0] ?? null;
  const bug = claim?.bug ?? null;
  const heartbeat = claim?.lastHeartbeatAt ?? claim?.claimedAt ?? null;
  const claimHeld = Boolean(claim && bug && !bug.isDeleted && bug.status === "in_progress");
  const quiet = heartbeat === null || heartbeat.getTime() < now.getTime() - AGENT_WORKING_WINDOW_MS;
  const deadlinePassed = isDeliveryOverdue(claim?.deliverBy, now);
  const stalled = claimHeld && isClaimStalled({
    quiet,
    deliverBy: claim?.deliverBy,
    waitingOnOwnerSince: claim?.waitingOnOwnerSince ?? null,
    pullRequestUrl: bug?.pullRequestUrl ?? null,
    now,
  });
  const status = classifyAgentStatus({
    hasUnansweredQuestion: agent.questions.length > 0,
    hasStalledClaim: stalled,
    hasActiveClaim: claimHeld && !quiet,
    lastSeenAt: heartbeat,
    now,
  });
  if (status !== "stuck") return null;

  return {
    summary: bug
      ? deadlinePassed
        ? `Past its deadline on #${bug.number} ${bug.title}`
        : `No word on #${bug.number} for ${quietDuration(heartbeat, now)}`
      : "This agent needs attention.",
    issue: bug ? { number: bug.number, title: bug.title, href: issueHref(bug) } : null,
    lastHeartbeatAt: heartbeat,
    deliverBy: claim?.deliverBy ?? null,
    deadlinePassed,
  };
}

/** The username as it arrived, decoded in case it arrived still encoded, lowercased. */
function usernameFrom(raw: string): string {
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    // A stray "%" that isn't an escape: use it as it came.
    return raw.toLowerCase();
  }
}

export type FoundAgent = {
  id: string;
  ownerUserId: string;
  username: string;
  /**
   * The organisation the page shows it in (#user-agents): the viewer's own when
   * it works there, else one of theirs it works in, else the first it works in.
   * Null when it works nowhere.
   */
  organisationId: string | null;
  /** The organisation the viewer is in, where its key and Connect are for. */
  viewerOrganisation: { id: string; name: string } | null;
  /** Whether it works in the viewer's organisation. */
  activeForViewer: boolean;
};

/** The agent this address names, by its username, which is unique across the platform (#agent-profile). */
export async function findAgentByUsername(raw: string, viewerId: string | null = null): Promise<FoundAgent | null> {
  const agent = await prisma.agent.findUnique({
    where: { username: usernameFrom(raw) },
    select: {
      id: true,
      ownerUserId: true,
      username: true,
      activations: { where: { deactivatedAt: null }, orderBy: { activatedAt: "asc" }, select: { organisationId: true } },
    },
  });
  if (!agent) return null;
  const active = agent.activations.map((row) => row.organisationId);
  const viewerOrganisationId = viewerId ? await currentOrganisationIdFor(viewerId) : null;
  const [viewerOrganisation, viewerMemberships] = await Promise.all([
    viewerOrganisationId ? prisma.organisation.findUnique({ where: { id: viewerOrganisationId }, select: { id: true, name: true } }) : null,
    viewerId && active.length
      ? prisma.membership.findMany({ where: { userId: viewerId, organisationId: { in: active } }, select: { organisationId: true } })
      : [],
  ]);
  const activeForViewer = Boolean(viewerOrganisationId && active.includes(viewerOrganisationId));
  const shared = active.find((id) => viewerMemberships.some((row) => row.organisationId === id));
  return {
    id: agent.id,
    ownerUserId: agent.ownerUserId,
    username: agent.username,
    organisationId: activeForViewer ? viewerOrganisationId : (shared ?? active[0] ?? null),
    viewerOrganisation,
    activeForViewer,
  };
}

/**
 * The agent's profile and latest activity. Call it only after the viewer has
 * passed listAgentThread's check (owner or team admin), the same people the
 * audit log shows this agent's actions to.
 */
export async function loadAgentProfile(
  agentId: string,
  viewerId: string | null,
  /** The organisation the page shows it in: its class there, and its activity there. */
  organisationId: string | null,
): Promise<{ agent: AgentProfileData; activity: AgentActivityItem[]; deliveredBugIds: string[] } | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      model: true,
      avatar: true,
      activations: { where: { deactivatedAt: null }, orderBy: { activatedAt: "asc" }, select: { organisationId: true, level: true, organisation: { select: { name: true } } } },
      revokedAt: true,
      createdAt: true,
      ownerUserId: true,
      reputation: true,
      owner: { select: { name: true, email: true } },
      apiKeys: { select: { lastUsedAt: true } },
    },
  });
  if (!agent) return null;

  const [filed, claims, comments, deliveries, events, profile] = await Promise.all([
    prisma.bug.count({ where: { createdByAgentId: agentId } }),
    prisma.issueClaim.count({ where: { agentId } }),
    prisma.comment.count({ where: { agentId } }),
    prisma.delivery.findMany({ where: { agentId }, select: { bugId: true } }),
    organisationId
      ? prisma.agentAuditEvent.findMany({
      where: auditWhere({ kind: "own-agents", organisationId, agentIds: [agentId] }, { agentId }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        action: true,
        target: true,
        undoneAt: true,
        bug: { select: { id: true, number: true, title: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } } },
      },
    })
      : Promise.resolve([]),
    readAgentProfile(agentId, "web"),
  ]);

  const lastUsed = agent.apiKeys
    .map((key) => key.lastUsedAt?.getTime() ?? 0)
    .reduce((latest, time) => Math.max(latest, time), 0);
  const here = agent.activations.find((row) => row.organisationId === organisationId);

  return {
    deliveredBugIds: deliveries.map((delivery) => delivery.bugId),
    agent: {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      avatar: agent.avatar,
      level: here?.level ?? "working",
      revokedAt: agent.revokedAt,
      createdAt: agent.createdAt,
      ownerName: agent.ownerUserId === viewerId ? null : (agent.owner.name ?? agent.owner.email),
      lastActiveAt: lastUsed ? new Date(lastUsed) : null,
      activeNow: !agent.revokedAt && lastUsed > 0 && Date.now() - lastUsed < ACTIVE_NOW_MS,
      organisations: agent.activations.map((row) => row.organisation.name),
      counts: { filed, claims, comments, delivered: deliveries.length },
      reputation: agent.reputation,
      username: profile?.username ?? null,
      tagline: profile?.tagline ?? null,
      about: profile?.about ?? null,
      services: profile?.services ?? null,
      rating: profile?.rating ?? null,
      pictureUrl: profile?.picture_url ?? null,
      skills: profile?.skills ?? [],
    },
    activity: events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      action: event.action,
      target: event.target,
      bug: event.bug,
      undone: event.undoneAt !== null,
    })),
  };
}

/** How many reviews the page loads; the list pages through them. */
const REVIEW_LIMIT = 200;

/**
 * Other agents' reviews of the work this agent delivered: testers' judgements
 * and managers' merge reviews on the issues it delivered, newest first. The
 * agent's own entries on those issues aren't reviews of it.
 */
export async function loadReviews(agentId: string, bugIds: string[]): Promise<AgentReview[]> {
  if (bugIds.length === 0) return [];
  const where = { bugId: { in: bugIds }, NOT: { agentId } };
  const reviewer = { select: { id: true, name: true, avatar: true, username: true, picture: { select: { updatedAt: true } } } };
  const owner = { select: { name: true, email: true } };
  const bug = { select: { id: true, number: true, title: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } } };
  const [verdicts, merges] = await Promise.all([
    prisma.testVerdict.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: REVIEW_LIMIT,
      select: { id: true, goodToMerge: true, summary: true, description: true, updatedAt: true, agent: reviewer, onBehalfOf: owner, bug },
    }),
    prisma.mergeReview.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: REVIEW_LIMIT,
      select: { id: true, verdict: true, summary: true, description: true, updatedAt: true, agent: reviewer, onBehalfOf: owner, bug },
    }),
  ]);
  const reviews: AgentReview[] = [
    ...verdicts.map((v) => ({
      id: `judgement-${v.id}`,
      kind: "judgement" as const,
      positive: v.goodToMerge,
      summary: v.summary,
      description: v.description,
      at: v.updatedAt.toISOString(),
      reviewer: reviewerView(v.agent, v.onBehalfOf),
      bug: v.bug,
    })),
    ...merges.map((m) => ({
      id: `merge-${m.id}`,
      kind: "merge" as const,
      positive: m.verdict === "accept",
      summary: m.summary,
      description: m.description,
      at: m.updatedAt.toISOString(),
      reviewer: reviewerView(m.agent, m.onBehalfOf),
      bug: m.bug,
    })),
  ];
  return reviews.sort((a, b) => b.at.localeCompare(a.at)).slice(0, REVIEW_LIMIT);
}

function reviewerView(
  agent: { id: string; name: string; avatar: string | null; username: string | null; picture: { updatedAt: Date } | null },
  owner: { name: string | null; email: string },
): AgentReview["reviewer"] {
  return {
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    pictureUrl: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null,
    ownerName: owner.name ?? owner.email,
  };
}

/** The viewer's own agents, wherever they work (#user-agents), for the tabs: live ones, plus this one if it is theirs. */
export async function loadOwnAgents(viewerId: string, currentId: string): Promise<AgentTab[]> {
  const agents = await prisma.agent.findMany({
    where: { ownerUserId: viewerId, OR: [{ revokedAt: null }, { id: currentId }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, avatar: true, revokedAt: true, username: true, picture: { select: { updatedAt: true } } },
  });
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    username: agent.username,
    avatar: agent.avatar,
    pictureUrl: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null,
    revoked: agent.revokedAt !== null,
  }));
}
