import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agent clusters (#agent-clusters): a cluster's card is public in its project, but
 * its forum, shared doc and private notes are for active member agents only (and
 * their owners, read-only). Anyone else gets the same 404 as a missing cluster.
 */
const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn() }, membership: { findUnique: vi.fn() }, agent: { findMany: vi.fn() },
  cluster: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  clusterMember: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  clusterPost: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  clusterDocRevision: { findMany: vi.fn(), create: vi.fn() },
  clusterNote: { findMany: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import {
  agentClusterViewer, addPost, createCluster, decideMember, inviteToCluster, joinCluster,
  listClusters, listPosts, readDoc, readNotes, saveDoc, type ClusterViewer,
} from "@/lib/clusters";
import type { AgentContext } from "@/lib/agents/require-agent";

const agent = (agentId: string): AgentContext => ({ agentId, ownerId: `owner-${agentId}`, organisationId: "org", name: `Agent ${agentId}`, level: "working", keyId: "key", burst: false });
const viewerFor = (agentId: string): ClusterViewer => ({ organisationId: "org", projectId: "project", userId: `owner-${agentId}`, agent: agent(agentId) });
const cluster = { id: "c1", organisationId: "org", projectId: "project", name: "Payments", purpose: "Harden payments", creatorAgentId: "creator", doc: "Plan", docVersion: 3 };

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (run) => run(db));
  db.cluster.findFirst.mockResolvedValue(cluster);
  // Only "creator" and "member" are active members of c1.
  db.clusterMember.findFirst.mockImplementation(async ({ where }) =>
    where.agentId === "creator" || where.agentId === "member" ? { agentId: where.agentId } : null);
});

describe("cluster access", () => {
  it("does not let a key reach another organisation's project", async () => {
    db.project.findFirst.mockResolvedValue(null);
    db.membership.findUnique.mockResolvedValue({ role: "member" });
    await expect(agentClusterViewer(agent("a"), "foreign")).rejects.toMatchObject({ status: 404 });
    expect(db.project.findFirst.mock.calls[0][0].where).toMatchObject({ id: "foreign", organisationId: "org" });
  });

  it("answers 404, not 403, to a non-member reading the forum, the doc or notes", async () => {
    const outsider = viewerFor("outsider");
    await expect(listPosts(outsider, "c1")).rejects.toMatchObject({ status: 404, message: "Cluster not found." });
    await expect(readDoc(outsider, "c1")).rejects.toMatchObject({ status: 404, message: "Cluster not found." });
    await expect(readNotes(outsider, "c1")).rejects.toMatchObject({ status: 404, message: "Cluster not found." });
    expect(db.clusterPost.findMany).not.toHaveBeenCalled();
    expect(db.clusterNote.findMany).not.toHaveBeenCalled();
  });

  it("treats an invited or requesting agent as outside until it is active", async () => {
    await listPosts(viewerFor("member"), "c1");
    expect(db.clusterMember.findFirst.mock.calls[0][0].where).toMatchObject({ clusterId: "c1", status: "active", agentId: "member" });
  });

  it("scopes a cluster to the caller's project and organisation", async () => {
    db.cluster.findFirst.mockResolvedValue(null);
    await expect(listPosts(viewerFor("member"), "other-project-cluster")).rejects.toMatchObject({ status: 404 });
    expect(db.cluster.findFirst.mock.calls[0][0].where).toMatchObject({ id: "other-project-cluster", projectId: "project", organisationId: "org" });
  });

  it("never lets one member read another member's private notes", async () => {
    db.clusterNote.findMany.mockResolvedValue([]);
    await readNotes(viewerFor("member"), "c1");
    expect(db.clusterNote.findMany.mock.calls[0][0].where).toEqual({ clusterId: "c1", agentId: "member" });
  });

  it("shows a person only their own agents' notes", async () => {
    db.clusterNote.findMany.mockResolvedValue([]);
    db.clusterMember.findFirst.mockResolvedValue({ agentId: "member" });
    await readNotes({ organisationId: "org", projectId: "project", userId: "owner-member" }, "c1");
    expect(db.clusterNote.findMany.mock.calls[0][0].where).toEqual({ clusterId: "c1", agent: { ownerUserId: "owner-member" } });
  });

  it("lists cards without any cluster content", async () => {
    db.cluster.findMany.mockResolvedValue([{ id: "c1", name: "Payments", purpose: "Harden payments", creatorAgentId: "creator",
      lastActivityAt: new Date(0), createdAt: new Date(0), _count: { posts: 2 },
      members: [{ agentId: "creator", joinedAt: new Date(0), agent: { name: "Creator", ownerUserId: "owner-creator" } }] }]);
    db.clusterMember.findMany.mockResolvedValue([]);
    const { items } = await listClusters(viewerFor("outsider"));
    expect(items[0]).toMatchObject({ id: "c1", threadCount: 2, myStatus: null });
    expect(items[0]).not.toHaveProperty("doc");
    expect(db.cluster.findMany.mock.calls[0][0].select).not.toHaveProperty("doc");
    expect(db.cluster.findMany.mock.calls[0][0].select).not.toHaveProperty("posts");
  });
});

describe("cluster membership", () => {
  it("makes the creator the first active member and invites only agents active in the organisation", async () => {
    db.agent.findMany.mockResolvedValue([{ id: "b" }]);
    db.cluster.create.mockResolvedValue({ id: "new", name: "Search", purpose: "Make search fast" });
    await createCluster(viewerFor("a"), { name: "Search", purpose: "Make search fast", invite: ["b", "a"] });
    expect(db.clusterMember.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clusterId: "new", agentId: "a", status: "active" }) });
    expect(db.clusterMember.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ agentId: "b", status: "invited", invitedByAgentId: "a" })] });
  });

  it("refuses to invite an agent from outside the organisation", async () => {
    db.agent.findMany.mockResolvedValue([]);
    await expect(createCluster(viewerFor("a"), { name: "Search", purpose: "Make search fast", invite: ["stranger"] })).rejects.toMatchObject({ status: 422 });
    expect(db.cluster.create).not.toHaveBeenCalled();
  });

  it("lets only members invite", async () => {
    await expect(inviteToCluster(viewerFor("outsider"), "c1", { agentIds: ["b"] })).rejects.toMatchObject({ status: 404 });
    expect(db.clusterMember.create).not.toHaveBeenCalled();
  });

  it("turns a join without an invite into a request, and an invite into membership", async () => {
    db.clusterMember.findUnique.mockResolvedValueOnce(null);
    await expect(joinCluster(viewerFor("outsider"), "c1")).resolves.toEqual({ status: "requested" });
    db.clusterMember.findUnique.mockResolvedValueOnce({ id: "row", status: "invited" });
    await expect(joinCluster(viewerFor("outsider"), "c1")).resolves.toEqual({ status: "active" });
    expect(db.clusterMember.update).toHaveBeenCalledWith({ where: { id: "row" }, data: expect.objectContaining({ status: "active" }) });
  });

  it("lets only the creator approve a request", async () => {
    await expect(decideMember(viewerFor("member"), "c1", "outsider", { decision: "approve" })).rejects.toMatchObject({ status: 403 });
    db.clusterMember.findUnique.mockResolvedValue({ id: "row", status: "requested" });
    await expect(decideMember(viewerFor("creator"), "c1", "outsider", { decision: "approve" })).resolves.toEqual({ status: "active" });
  });

  it("never removes the creator", async () => {
    await expect(decideMember(viewerFor("creator"), "c1", "creator", { decision: "remove" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("cluster forum and shared doc", () => {
  it("needs a title for a thread and refuses a reply to a thread in another cluster", async () => {
    await expect(addPost(viewerFor("member"), "c1", { body: "No title" })).rejects.toMatchObject({ status: 422 });
    db.clusterPost.findFirst.mockResolvedValue(null);
    await expect(addPost(viewerFor("member"), "c1", { parentId: "elsewhere", body: "Reply" })).rejects.toMatchObject({ status: 404 });
    expect(db.clusterPost.findFirst.mock.calls[0][0].where).toEqual({ id: "elsewhere", clusterId: "c1", parentId: null });
    expect(db.clusterPost.create).not.toHaveBeenCalled();
  });

  it("saves the doc as the next version with a revision", async () => {
    db.cluster.updateMany.mockResolvedValue({ count: 1 });
    await expect(saveDoc(viewerFor("member"), "c1", { body: "New plan", expectedVersion: 3 })).resolves.toEqual({ version: 4 });
    expect(db.cluster.updateMany.mock.calls[0][0].where).toEqual({ id: "c1", docVersion: 3 });
    expect(db.clusterDocRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clusterId: "c1", version: 4, editorAgentId: "member" }) });
  });

  it("refuses a save against an old version instead of overwriting", async () => {
    db.cluster.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveDoc(viewerFor("member"), "c1", { body: "Stale", expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
    expect(db.clusterDocRevision.create).not.toHaveBeenCalled();
  });

  it("lets no one but an agent write", async () => {
    db.clusterMember.findFirst.mockResolvedValue({ agentId: "member" });
    await expect(addPost({ organisationId: "org", projectId: "project", userId: "owner-member" }, "c1", { title: "Hi", body: "Hello" })).rejects.toMatchObject({ status: 403 });
  });
});
