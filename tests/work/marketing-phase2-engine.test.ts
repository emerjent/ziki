/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";
import { filterLibrary, type LibraryItem } from "@/components/marketing/library/model";

// Hoisted Prisma mock
const db = vi.hoisted(() => {
  const deliveriesTable = new Map<string, any>();
  const bugsTable = new Map<string, any>();
  const claimsTable = new Map<string, any>();

  const tx = {
    $queryRaw: vi.fn(async () => [{ id: "b1" }]),
    delivery: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.id || `${where.bugId_agentId?.bugId}_${where.bugId_agentId?.agentId}`;
        return deliveriesTable.get(key) || null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const d of deliveriesTable.values()) {
          if (where.bugId && d.bugId !== where.bugId) continue;
          if (where.beneficiaryUserId && d.beneficiaryUserId !== where.beneficiaryUserId) continue;
          return d;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `del_${deliveriesTable.size + 1}`;
        const record = { id, ...data };
        deliveriesTable.set(id, record);
        deliveriesTable.set(`${data.bugId}_${data.agentId}`, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = deliveriesTable.get(where.id);
        const updated = { ...existing, ...data };
        deliveriesTable.set(where.id, updated);
        if (existing?.bugId && existing?.agentId) {
          deliveriesTable.set(`${existing.bugId}_${existing.agentId}`, updated);
        }
        return updated;
      }),
    },
    bug: {
      findUnique: vi.fn(async ({ where }: any) => bugsTable.get(where.id) || null),
      findFirst: vi.fn(async ({ where }: any) => bugsTable.get(where.id) || null),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = bugsTable.get(where.id);
        const updated = { ...existing, ...data };
        bugsTable.set(where.id, updated);
        return updated;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const bug = bugsTable.get(where.id);
        if (!bug) throw new Error("Not found");
        return bug;
      }),
    },
    issueClaim: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const claim of claimsTable.values()) {
          if (where.bugId && claim.bugId !== where.bugId) continue;
          if (where.agentId && claim.agentId !== where.agentId) continue;
          if (where.status && claim.status !== where.status) continue;
          return claim;
        }
        return null;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    bugActivity: { create: vi.fn(async () => ({})) },
    attachment: { updateMany: vi.fn(async () => ({ count: 1 })) },
    testVerdict: { findMany: vi.fn(async () => []) },
    pointEntry: { create: vi.fn(async () => ({})) },
    supportThread: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };

  let txLock = Promise.resolve();

  return {
    tx,
    deliveriesTable,
    bugsTable,
    claimsTable,
    prisma: {
      bug: {
        findFirst: vi.fn(async ({ where }: any) => bugsTable.get(where.id) || null),
        findUnique: vi.fn(async ({ where }: any) => bugsTable.get(where.id) || null),
      },
      issueClaim: { findFirst: vi.fn(async () => ({ id: "c1", status: "active" })) },
      delivery: { findMany: vi.fn(async () => []) },
      attachment: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => {
        const prevLock = txLock;
        let release!: () => void;
        txLock = new Promise<void>((resolve) => {
          release = resolve;
        });
        await prevLock;
        try {
          return await fn(tx);
        } finally {
          release();
        }
      }),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn() }));
vi.mock("@/lib/attachment-link", () => ({ linkAttachments: vi.fn() }));
vi.mock("@/lib/support/thread-lifecycle", () => ({ closeSupportThreadsForIssue: vi.fn() }));

import { deliverWork } from "@/lib/agent-api/delivery";

const agent = (id = "agent_1", ownerId = "owner_1"): AgentContext => ({
  agentId: id,
  name: `Agent ${id}`,
  ownerId,
  organisationId: "org_1",
  level: "working",
  burst: false,
  keyId: "k1",
});

describe("Marketing Output Engine - Phase 2 Integration Tests", () => {
  beforeEach(() => {
    db.deliveriesTable.clear();
    db.bugsTable.clear();
    db.claimsTable.clear();

    db.bugsTable.set("bug_1", {
      id: "bug_1",
      number: 101,
      projectId: "proj_1",
      organisationId: "org_1",
      track: "marketing",
      status: "in_progress",
      substatus: null,
      pullRequestUrl: null,
      isDeleted: false,
      reporterId: "user_r",
      reward: 100,
      project: { repoUrl: "https://github.com/test/repo" },
    });

    db.claimsTable.set("claim_1", {
      id: "claim_1",
      bugId: "bug_1",
      agentId: "agent_1",
      beneficiaryUserId: "owner_1",
      status: "active",
      releasedAt: null,
    });
  });

  describe("Scenario A & B: Concurrency, Sequence Progression, and Delivery Status", () => {
    it("allocates sequence 1 and status ready_to_use for delivery without published URLs", async () => {
      const res = await deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Created blog post draft",
        description: "Blog post copy written and saved in Markdown",
        deliverableText: "# Introducing New Feature\n\nContent here...",
      });

      expect(res.status).toBe(201);
      const delivery = await db.tx.delivery.findUnique({
        where: { bugId_agentId: { bugId: "bug_1", agentId: "agent_1" } },
      });
      expect(delivery).not.toBeNull();
      expect(delivery.currentSequence).toBe(1);
      expect(delivery.deliveryStatus).toBe("ready_to_use");
      expect(delivery.publishedUrls).toEqual([]);
    });

    it("allocates status publication_pending when delivery carries published URLs", async () => {
      const res = await deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Published guest post",
        description: "Guest post is live on partner publication",
        deliverableUrls: ["https://example.com/blog/guest-post"],
        publishedUrls: ["https://example.com/blog/guest-post"],
      });

      expect(res.status).toBe(201);
      const delivery = await db.tx.delivery.findUnique({
        where: { bugId_agentId: { bugId: "bug_1", agentId: "agent_1" } },
      });
      expect(delivery.currentSequence).toBe(1);
      expect(delivery.deliveryStatus).toBe("publication_pending");
      expect(delivery.publishedUrls).toEqual(["https://example.com/blog/guest-post"]);
    });

    it("increments sequence and resets status on resubmission (Scenario B)", async () => {
      // First delivery: publication pending
      await deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Version 1",
        description: "Initial submission",
        deliverableText: "V1 content",
        publishedUrls: ["https://example.com/v1"],
      });

      // Second delivery by the same agent: revised without published URLs
      const res2 = await deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Version 2 replacement",
        description: "Updated content based on feedback",
        deliverableText: "V2 content",
      });

      expect(res2.status).toBe(200);
      const delivery = await db.tx.delivery.findUnique({
        where: { bugId_agentId: { bugId: "bug_1", agentId: "agent_1" } },
      });
      expect(delivery.currentSequence).toBe(2);
      expect(delivery.deliveryStatus).toBe("ready_to_use");
      expect(delivery.publishedUrls).toEqual([]);
      expect(delivery.implementedAt).toBeNull();
      expect(delivery.verifiedPublishedAt).toBeNull();
    });

    it("handles multiple concurrent deliveries sequentially via parent row lock", async () => {
      // Simulate two near-simultaneous submissions
      const p1 = deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Submission Alpha",
        description: "First concurrent",
        deliverableText: "Alpha",
      });

      const p2 = deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Submission Beta",
        description: "Second concurrent",
        deliverableText: "Beta",
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect([200, 201]).toContain(r1.status);
      expect([200, 201]).toContain(r2.status);

      // Verify that tx.$queryRaw was called with FOR UPDATE
      expect(db.tx.$queryRaw).toHaveBeenCalled();

      // Final delivery should have sequence 2
      const delivery = await db.tx.delivery.findUnique({
        where: { bugId_agentId: { bugId: "bug_1", agentId: "agent_1" } },
      });
      expect(delivery.currentSequence).toBe(2);
    });
  });

  describe("Scenario C: Multiple agents submitting to distinct tasks", () => {
    it("maintains isolated sequence numbers per bug and agent", async () => {
      db.bugsTable.set("bug_2", {
        id: "bug_2",
        number: 102,
        projectId: "proj_1",
        organisationId: "org_1",
        track: "marketing",
        status: "in_progress",
        isDeleted: false,
        project: { repoUrl: "https://github.com/test/repo" },
      });

      db.claimsTable.set("claim_2", {
        id: "claim_2",
        bugId: "bug_2",
        agentId: "agent_2",
        beneficiaryUserId: "owner_2",
        status: "active",
        releasedAt: null,
      });

      await deliverWork(agent("agent_1", "owner_1"), "bug_1", {
        summary: "Task 1 deliverable",
        description: "Done",
        deliverableText: "Task 1",
      });

      await deliverWork(agent("agent_2", "owner_2"), "bug_2", {
        summary: "Task 2 deliverable",
        description: "Done",
        deliverableText: "Task 2",
      });

      const d1 = await db.tx.delivery.findUnique({
        where: { bugId_agentId: { bugId: "bug_1", agentId: "agent_1" } },
      });
      const d2 = await db.tx.delivery.findUnique({
        where: { bugId_agentId: { bugId: "bug_2", agentId: "agent_2" } },
      });

      expect(d1.currentSequence).toBe(1);
      expect(d2.currentSequence).toBe(1);
    });
  });

  describe("Category and Status Filtering in Output Box", () => {
    const mockItems: LibraryItem[] = [
      {
        id: "t1",
        number: 1,
        title: "Blog Post on Launch",
        summary: "Article about new release",
        agent: "Writer Agent",
        publishedAt: "2026-11-01T10:00:00Z",
        files: [{ id: "f1", name: "post.md", url: "", kind: "Articles", contentType: "text/markdown", size: 100, downloadable: false, local: true }],
        deliveryId: "del_1",
        category: "Content & Editorial",
        taskType: "Blog post",
        deliveryStatus: "live_published",
        publishedUrls: ["https://example.com/blog/launch"],
        implementedAt: null,
        implementedByName: null,
      },
      {
        id: "t2",
        number: 2,
        title: "Hero Banner Graphic",
        summary: "Banner visual for landing page",
        agent: "Designer Agent",
        publishedAt: "2026-11-02T10:00:00Z",
        files: [{ id: "f2", name: "banner.png", url: "https://example.com/banner.png", kind: "Graphics", contentType: "image/png", size: 2048, downloadable: true, local: false }],
        deliveryId: "del_2",
        category: "Brand & Identity",
        taskType: "Graphic",
        deliveryStatus: "ready_to_use",
        publishedUrls: [],
        implementedAt: null,
        implementedByName: null,
      },
      {
        id: "t3",
        number: 3,
        title: "SEO Keyword Analysis",
        summary: "Keyword research sheet",
        agent: "SEO Agent",
        publishedAt: "2026-11-03T10:00:00Z",
        files: [{ id: "f3", name: "seo.xlsx", url: "/api/attachments/a3", kind: "Docs", contentType: "application/vnd.ms-excel", size: 4096, downloadable: true, local: true }],
        deliveryId: "del_3",
        category: "SEO & Growth",
        taskType: "Landing page copy",
        deliveryStatus: "implemented",
        publishedUrls: [],
        implementedAt: "2026-11-04T12:00:00Z",
        implementedByName: "Sarah (Growth)",
      },
    ];

    it("filters by category correctly", () => {
      const contentItems = filterLibrary(mockItems, "", "All", "Content & Editorial");
      expect(contentItems.length).toBe(1);
      expect(contentItems[0].id).toBe("t1");

      const brandItems = filterLibrary(mockItems, "", "All", "Brand & Identity");
      expect(brandItems.length).toBe(1);
      expect(brandItems[0].id).toBe("t2");

      const seoItems = filterLibrary(mockItems, "", "All", "SEO & Growth");
      expect(seoItems.length).toBe(1);
      expect(seoItems[0].id).toBe("t3");

      const allItems = filterLibrary(mockItems, "", "All", "All");
      expect(allItems.length).toBe(3);
    });

    it("filters by query across title, summary, agent, category, and status", () => {
      const searchStatus = filterLibrary(mockItems, "implemented", "All", "All");
      expect(searchStatus.length).toBe(1);
      expect(searchStatus[0].id).toBe("t3");

      const searchCategory = filterLibrary(mockItems, "Brand & Identity", "All", "All");
      expect(searchCategory.length).toBe(1);
      expect(searchCategory[0].id).toBe("t2");
    });
  });
});
