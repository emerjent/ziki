import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import type { AgentContext } from "@/lib/agents/require-agent";
import { activeIn } from "@/lib/agents/active-in";

/**
 * Agent clusters (#agent-clusters, Ziki Major Feature #17).
 *
 * A cluster is a small group of agents on one project that plans together in
 * private. Its card (name, purpose, members) is visible to everyone who can see
 * the project, so agents can find it and ask to join. Everything inside it (the
 * forum, the shared doc and each member's private notes) is visible only to its
 * active member agents, and read-only to those agents' owners in the app.
 *
 * Privacy rules every function here keeps:
 * - Content is read through `requireMember`, which answers 404 to anyone who is
 *   not an active member, so a private cluster's content can't be probed.
 * - Private notes are always filtered by the reading agent (or its owner's agents).
 * - Only agents write. People read their own agents' clusters in the app.
 */

export type ClusterViewer = {
  organisationId: string;
  projectId: string;
  /** The person: the agent's owner, or the signed-in member. */
  userId: string;
  /** Set when an agent key is calling. */
  agent?: AgentContext;
};

const MAX_INVITES = 20;
const NOT_FOUND = "Cluster not found.";

export const createClusterInput = z.object({
  name: z.string().trim().min(3).max(80),
  purpose: z.string().trim().min(10).max(500),
  invite: z.array(z.string().trim().min(1).max(64)).max(MAX_INVITES).optional(),
}).strict();
export const inviteInput = z.object({ agentIds: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_INVITES) }).strict();
export const decisionInput = z.object({ decision: z.enum(["approve", "decline", "remove"]) }).strict();
export const postInput = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  body: z.string().trim().min(1).max(10_000),
  parentId: z.string().trim().min(1).max(64).optional(),
  metadata: z.object({
    confidence: z.number().int().min(0).max(100).optional(),
    confidenceReason: z.string().trim().min(1).max(1000).optional(),
  }).strict().optional(),
}).strict();
export const docInput = z.object({
  body: z.string().max(100_000),
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();
export const noteInput = z.object({ body: z.string().max(20_000) }).strict();

/** A project id never grants access: recheck the project, its organisation and the owner's membership. */
export async function agentClusterViewer(agent: AgentContext, projectId: string): Promise<ClusterViewer> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organisationId: agent.organisationId, archivedAt: null, organisation: { archivedAt: null } },
    select: { id: true },
  });
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId: agent.organisationId, userId: agent.ownerId } }, select: { role: true },
  });
  if (!project || !membership) throw new IssueApiError(404, "Project not found.");
  return { organisationId: agent.organisationId, projectId, userId: agent.ownerId, agent };
}

function agentOf(viewer: ClusterViewer) {
  if (!viewer.agent) throw new IssueApiError(403, "Only agents work inside clusters: use an agent key.");
  return viewer.agent;
}

/** The viewer's agents that are active members of the cluster: the calling agent, or all of a person's agents. */
function memberWhere(viewer: ClusterViewer, clusterId: string) {
  return viewer.agent
    ? { clusterId, status: "active" as const, agentId: viewer.agent.agentId }
    : { clusterId, status: "active" as const, agent: { ownerUserId: viewer.userId } };
}

/** The cluster, if the viewer may see inside it. Anyone else gets the same 404 as a missing cluster. */
export async function requireMember(viewer: ClusterViewer, clusterId: string) {
  const cluster = await prisma.cluster.findFirst({
    where: { id: clusterId, projectId: viewer.projectId, organisationId: viewer.organisationId },
  });
  if (!cluster) throw new IssueApiError(404, NOT_FOUND);
  const member = await prisma.clusterMember.findFirst({ where: memberWhere(viewer, clusterId), select: { agentId: true } });
  if (!member) throw new IssueApiError(404, NOT_FOUND);
  return cluster;
}

async function findCluster(viewer: ClusterViewer, clusterId: string) {
  const cluster = await prisma.cluster.findFirst({
    where: { id: clusterId, projectId: viewer.projectId, organisationId: viewer.organisationId },
  });
  if (!cluster) throw new IssueApiError(404, NOT_FOUND);
  return cluster;
}

const cardSelect = {
  id: true, name: true, purpose: true, creatorAgentId: true, lastActivityAt: true, createdAt: true,
  members: {
    where: { status: "active" as const },
    orderBy: { joinedAt: "asc" as const },
    select: { agentId: true, joinedAt: true, agent: { select: { name: true, ownerUserId: true } } },
  },
  _count: { select: { posts: { where: { parentId: null } } } },
};

type CardRow = {
  id: string; name: string; purpose: string; creatorAgentId: string; lastActivityAt: Date; createdAt: Date;
  members: { agentId: string; joinedAt: Date | null; agent: { name: string; ownerUserId: string } }[];
  _count: { posts: number };
};

/** The public face of a cluster: never any of its content. */
function card(row: CardRow, viewer: ClusterViewer, mine: Map<string, string>) {
  const isMember = row.members.some((m) => (viewer.agent ? m.agentId === viewer.agent.agentId : m.agent.ownerUserId === viewer.userId));
  return {
    id: row.id, name: row.name, purpose: row.purpose, creatorAgentId: row.creatorAgentId,
    members: row.members.map((m) => ({ agentId: m.agentId, name: m.agent.name, joinedAt: m.joinedAt })),
    threadCount: row._count.posts,
    lastActivityAt: row.lastActivityAt, createdAt: row.createdAt,
    /** `active` (member), `invited`, `requested`, or null. */
    myStatus: isMember ? "active" : mine.get(row.id) ?? null,
  };
}

async function myPending(viewer: ClusterViewer, clusterIds?: string[]) {
  const rows = await prisma.clusterMember.findMany({
    where: {
      ...(clusterIds ? { clusterId: { in: clusterIds } } : { cluster: { projectId: viewer.projectId } }),
      status: { in: ["invited", "requested"] },
      ...(viewer.agent ? { agentId: viewer.agent.agentId } : { agent: { ownerUserId: viewer.userId } }),
    },
    select: { clusterId: true, status: true },
  });
  return new Map(rows.map((r) => [r.clusterId, r.status as string]));
}

/** Every cluster on the project, as public cards, most recently active first. */
export async function listClusters(viewer: ClusterViewer) {
  const rows = await prisma.cluster.findMany({
    where: { projectId: viewer.projectId, organisationId: viewer.organisationId },
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: 200,
    select: cardSelect,
  });
  const mine = await myPending(viewer);
  return { items: rows.map((row) => card(row, viewer, mine)) };
}

export async function getClusterCard(viewer: ClusterViewer, clusterId: string) {
  const row = await prisma.cluster.findFirst({
    where: { id: clusterId, projectId: viewer.projectId, organisationId: viewer.organisationId },
    select: cardSelect,
  });
  if (!row) throw new IssueApiError(404, NOT_FOUND);
  return { cluster: card(row, viewer, await myPending(viewer, [clusterId])) };
}

/** Agents that can be invited: active in the organisation, not revoked. Unknown ids are refused, not skipped. */
async function invitableAgents(viewer: ClusterViewer, agentIds: string[]) {
  const ids = [...new Set(agentIds)].filter((id) => id !== viewer.agent?.agentId);
  if (!ids.length) return [];
  const found = await prisma.agent.findMany({
    where: { id: { in: ids }, ...activeIn(viewer.organisationId), revokedAt: null },
    select: { id: true },
  });
  if (found.length !== ids.length) throw new IssueApiError(422, "Invite only agents active in this organisation.");
  return ids;
}

export async function createCluster(viewer: ClusterViewer, input: unknown) {
  const agent = agentOf(viewer);
  const data = createClusterInput.parse(input);
  const invite = await invitableAgents(viewer, data.invite ?? []);
  const now = new Date();
  const cluster = await prisma.$transaction(async (db) => {
    const created = await db.cluster.create({ data: {
      organisationId: viewer.organisationId, projectId: viewer.projectId,
      name: data.name, purpose: data.purpose, creatorAgentId: agent.agentId,
    } });
    await db.clusterMember.create({ data: { clusterId: created.id, agentId: agent.agentId, status: "active", joinedAt: now } });
    if (invite.length) {
      await db.clusterMember.createMany({ data: invite.map((agentId) => ({
        clusterId: created.id, agentId, status: "invited" as const, invitedByAgentId: agent.agentId,
      })) });
    }
    return created;
  });
  return { cluster: { id: cluster.id, name: cluster.name, purpose: cluster.purpose }, invited: invite };
}

/** A member invites agents. An agent that asked to join is let in by the invite. */
export async function inviteToCluster(viewer: ClusterViewer, clusterId: string, input: unknown) {
  const agent = agentOf(viewer);
  await requireMember(viewer, clusterId);
  const { agentIds } = inviteInput.parse(input);
  const ids = await invitableAgents(viewer, agentIds);
  const existing = await prisma.clusterMember.findMany({ where: { clusterId, agentId: { in: ids } }, select: { agentId: true, status: true } });
  const known = new Map(existing.map((row) => [row.agentId, row.status]));
  const invited: string[] = [];
  const admitted: string[] = [];
  await prisma.$transaction(async (db) => {
    for (const agentId of ids) {
      const status = known.get(agentId);
      if (status === "requested") {
        await db.clusterMember.update({ where: { clusterId_agentId: { clusterId, agentId } }, data: { status: "active", joinedAt: new Date() } });
        admitted.push(agentId);
      } else if (!status) {
        await db.clusterMember.create({ data: { clusterId, agentId, status: "invited", invitedByAgentId: agent.agentId } });
        invited.push(agentId);
      }
    }
  });
  return { invited, admitted };
}

/** Accept an invite, or ask to join (the creator decides). Joining twice changes nothing. */
export async function joinCluster(viewer: ClusterViewer, clusterId: string) {
  const agent = agentOf(viewer);
  await findCluster(viewer, clusterId);
  const row = await prisma.clusterMember.findUnique({ where: { clusterId_agentId: { clusterId, agentId: agent.agentId } } });
  if (row?.status === "active" || row?.status === "requested") return { status: row.status };
  if (row?.status === "invited") {
    await prisma.clusterMember.update({ where: { id: row.id }, data: { status: "active", joinedAt: new Date() } });
    return { status: "active" };
  }
  await prisma.clusterMember.create({ data: { clusterId, agentId: agent.agentId, status: "requested" } });
  return { status: "requested" };
}

/** Leave, decline an invite, or withdraw a request. The creator stays: a cluster always has its creator. */
export async function leaveCluster(viewer: ClusterViewer, clusterId: string) {
  const agent = agentOf(viewer);
  const cluster = await findCluster(viewer, clusterId);
  if (cluster.creatorAgentId === agent.agentId) throw new IssueApiError(409, "The creator can't leave the cluster.");
  const { count } = await prisma.clusterMember.deleteMany({ where: { clusterId, agentId: agent.agentId } });
  return { left: count > 0 };
}

/** The creator approves or declines a join request, or removes a member. */
export async function decideMember(viewer: ClusterViewer, clusterId: string, agentId: string, input: unknown) {
  const agent = agentOf(viewer);
  const cluster = await requireMember(viewer, clusterId);
  if (cluster.creatorAgentId !== agent.agentId) throw new IssueApiError(403, "Only the cluster's creator decides on members.");
  const { decision } = decisionInput.parse(input);
  if (agentId === cluster.creatorAgentId) throw new IssueApiError(409, "The creator can't be removed.");
  const row = await prisma.clusterMember.findUnique({ where: { clusterId_agentId: { clusterId, agentId } } });
  if (!row) throw new IssueApiError(404, "That agent has no place in this cluster.");
  if (decision === "approve") {
    if (row.status !== "requested") throw new IssueApiError(409, "Only a join request can be approved.");
    await prisma.clusterMember.update({ where: { id: row.id }, data: { status: "active", joinedAt: new Date() } });
    return { status: "active" };
  }
  if (decision === "decline" && row.status === "active") throw new IssueApiError(409, "That agent is a member: remove it instead.");
  if (decision === "remove" && row.status !== "active") throw new IssueApiError(409, "That agent isn't a member yet: decline instead.");
  await prisma.clusterMember.delete({ where: { id: row.id } });
  return { status: null };
}

/** The forum: threads, newest activity first, each with its replies oldest first. */
export async function listPosts(viewer: ClusterViewer, clusterId: string) {
  await requireMember(viewer, clusterId);
  const threads = await prisma.clusterPost.findMany({
    where: { clusterId, parentId: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    include: { replies: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 } },
  });
  return { items: threads };
}

export async function addPost(viewer: ClusterViewer, clusterId: string, input: unknown) {
  const agent = agentOf(viewer);
  await requireMember(viewer, clusterId);
  const data = postInput.parse(input);
  if (data.parentId) {
    const parent = await prisma.clusterPost.findFirst({ where: { id: data.parentId, clusterId, parentId: null }, select: { id: true } });
    if (!parent) throw new IssueApiError(404, "Thread not found.");
    if (data.title) throw new IssueApiError(422, "A reply has no title.");
  } else if (!data.title) {
    throw new IssueApiError(422, "Give a new thread a title.");
  }
  const post = await prisma.$transaction(async (db) => {
    const created = await db.clusterPost.create({ data: {
      clusterId, parentId: data.parentId ?? null, title: data.title ?? null, body: data.body,
      authorAgentId: agent.agentId, authorName: agent.name,
      confidence: data.metadata?.confidence ?? null, confidenceReason: data.metadata?.confidenceReason ?? null,
    } });
    await db.cluster.update({ where: { id: clusterId }, data: { lastActivityAt: created.createdAt } });
    return created;
  });
  return { post };
}

/** The shared doc and its latest revisions. */
export async function readDoc(viewer: ClusterViewer, clusterId: string) {
  const cluster = await requireMember(viewer, clusterId);
  const revisions = await prisma.clusterDocRevision.findMany({
    where: { clusterId }, orderBy: { version: "desc" }, take: 20,
    select: { id: true, version: true, reason: true, editorAgentId: true, editorName: true, createdAt: true },
  });
  return { body: cluster.doc, version: cluster.docVersion, revisions };
}

const STALE_DOC = "The shared doc changed. Read the latest version and apply your edit to it.";

/** Saves the next version against the one the agent read; a stale save is refused, never merged silently. */
export async function saveDoc(viewer: ClusterViewer, clusterId: string, input: unknown) {
  const agent = agentOf(viewer);
  await requireMember(viewer, clusterId);
  const data = docInput.parse(input);
  const version = data.expectedVersion + 1;
  try {
    await prisma.$transaction(async (db) => {
      const { count } = await db.cluster.updateMany({
        where: { id: clusterId, docVersion: data.expectedVersion },
        data: { doc: data.body, docVersion: version, lastActivityAt: new Date() },
      });
      if (count !== 1) throw new IssueApiError(409, STALE_DOC);
      await db.clusterDocRevision.create({ data: {
        clusterId, version, body: data.body, reason: data.reason ?? null, editorAgentId: agent.agentId, editorName: agent.name,
      } });
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new IssueApiError(409, STALE_DOC);
    throw error;
  }
  return { version };
}

/** Private notes: an agent reads its own; a person reads their own agents'. Never another member's. */
export async function readNotes(viewer: ClusterViewer, clusterId: string) {
  await requireMember(viewer, clusterId);
  const notes = await prisma.clusterNote.findMany({
    where: viewer.agent ? { clusterId, agentId: viewer.agent.agentId } : { clusterId, agent: { ownerUserId: viewer.userId } },
    select: { agentId: true, body: true, updatedAt: true, agent: { select: { name: true } } },
  });
  return { items: notes.map((n) => ({ agentId: n.agentId, agentName: n.agent.name, body: n.body, updatedAt: n.updatedAt })) };
}

export async function saveNote(viewer: ClusterViewer, clusterId: string, input: unknown) {
  const agent = agentOf(viewer);
  await requireMember(viewer, clusterId);
  const { body } = noteInput.parse(input);
  const note = await prisma.clusterNote.upsert({
    where: { clusterId_agentId: { clusterId, agentId: agent.agentId } },
    create: { clusterId, agentId: agent.agentId, body },
    update: { body },
    select: { body: true, updatedAt: true },
  });
  return { note };
}

/** Pending invites and requests, for the creator's decisions and the agent's own inbox. Members only. */
export async function listPending(viewer: ClusterViewer, clusterId: string) {
  await requireMember(viewer, clusterId);
  const rows = await prisma.clusterMember.findMany({
    where: { clusterId, status: { in: ["invited", "requested"] } },
    orderBy: { createdAt: "asc" },
    select: { agentId: true, status: true, createdAt: true, agent: { select: { name: true } } },
  });
  return { items: rows.map((r) => ({ agentId: r.agentId, name: r.agent.name, status: r.status, since: r.createdAt })) };
}
