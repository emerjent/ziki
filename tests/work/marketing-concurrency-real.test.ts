/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deliverWork } from "@/lib/agent-api/delivery";
import { acceptFix } from "@/lib/agent-api/merge";
import { readLibrary } from "@/app/(app)/[org]/[project]/marketing/output-box/data";

const prisma = new PrismaClient();
const isDummyDb = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("dummy");
const isDedicatedRun =
  process.env.REQUIRE_DB === "true" ||
  process.env.INTEGRATION_TEST === "true" ||
  process.env.npm_lifecycle_event === "test:integration" ||
  process.argv.some((arg) => arg.includes("marketing-concurrency-real") || arg.includes("test:integration"));

describe("Marketing Output Engine - Real Database Concurrency & Integrity", () => {
  const testRunId = `real_${Date.now()}`;
  let dbAvailable = false;

  let user: any;
  let managerUser: any;
  let reviewerUser: any;
  let org: any;
  let project: any;
  let agentA: any;
  let agentB: any;
  let agentManager: any;
  let agentReviewer: any;
  let task: any;

  beforeAll(async () => {
    if (isDedicatedRun && isDummyDb) {
      throw new Error(
        "PostgreSQL database is required for integration tests but is unavailable (DATABASE_URL is not configured or dummy).",
      );
    }
    if (isDummyDb) {
      dbAvailable = false;
      return;
    }
    try {
      const connectPromise = (async () => {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
      })();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 3000),
      );
      await Promise.race([connectPromise, timeoutPromise]);
      dbAvailable = true;
    } catch (err) {
      dbAvailable = false;
      if (isDedicatedRun) {
        throw new Error(
          `PostgreSQL database is required for integration tests but is unavailable. Ensure PostgreSQL is running and DATABASE_URL is configured. Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    // Seed real DB test records
    user = await prisma.user.create({
      data: {
        id: `usr_${testRunId}`,
        email: `${testRunId}@example.com`,
        name: "Test Worker User",
      },
    });

    managerUser = await prisma.user.create({
      data: {
        id: `mgr_${testRunId}`,
        email: `mgr_${testRunId}@example.com`,
        name: "Test Manager User",
      },
    });

    reviewerUser = await prisma.user.create({
      data: {
        id: `rev_${testRunId}`,
        email: `rev_${testRunId}@example.com`,
        name: "Test Reviewer User",
      },
    });

    org = await prisma.organisation.create({
      data: {
        id: `org_${testRunId}`,
        slug: `org-${testRunId}`,
        name: "Test Integration Org",
      },
    });

    await prisma.membership.createMany({
      data: [
        { organisationId: org.id, userId: user.id, role: "member" },
        { organisationId: org.id, userId: managerUser.id, role: "admin" },
        { organisationId: org.id, userId: reviewerUser.id, role: "member" },
      ],
    });

    project = await prisma.project.create({
      data: {
        id: `proj_${testRunId}`,
        organisationId: org.id,
        slug: `proj-${testRunId}`,
        name: "Test Project",
        visibility: "private",
      },
    });

    await prisma.projectWorkflow.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, verdictsNeeded: 1 },
      update: { verdictsNeeded: 1 },
    });

    agentA = await prisma.agent.create({
      data: {
        id: `agt_a_${testRunId}`,
        ownerUserId: user.id,
        name: "Agent A",
      },
    });

    agentB = await prisma.agent.create({
      data: {
        id: `agt_b_${testRunId}`,
        ownerUserId: user.id,
        name: "Agent B",
      },
    });

    agentManager = await prisma.agent.create({
      data: {
        id: `agt_mgr_${testRunId}`,
        ownerUserId: managerUser.id,
        name: "Manager Agent",
      },
    });

    agentReviewer = await prisma.agent.create({
      data: {
        id: `agt_rev_${testRunId}`,
        ownerUserId: reviewerUser.id,
        name: "Reviewer Agent",
      },
    });

    await prisma.agentActivation.createMany({
      data: [
        { agentId: agentA.id, organisationId: org.id, level: "working" },
        { agentId: agentB.id, organisationId: org.id, level: "working" },
        { agentId: agentManager.id, organisationId: org.id, level: "manager" },
        { agentId: agentReviewer.id, organisationId: org.id, level: "working" },
      ],
    });

    task = await prisma.bug.create({
      data: {
        id: `bug_${testRunId}`,
        organisationId: org.id,
        projectId: project.id,
        number: 1,
        title: "Launch Integration Marketing Campaign",
        description: "Task description for real integration test",
        reporterId: user.id,
        beneficiaryUserId: user.id,
        track: "marketing",
        status: "in_progress",
        substatus: "in_progress",
      },
    });

    // Initial claim for Agent A
    await prisma.issueClaim.create({
      data: {
        id: `claim_a_${testRunId}`,
        bugId: task.id,
        agentId: agentA.id,
        beneficiaryUserId: user.id,
        status: "active",
        claimedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) {
      await prisma.$disconnect().catch(() => {});
      return;
    }
    // Cleanup seeded data
    try {
      await prisma.testVerdict.deleteMany({ where: { bugId: task?.id } });
      await prisma.attachment.deleteMany({ where: { bugId: task?.id } });
      await prisma.delivery.deleteMany({ where: { bugId: task?.id } });
      await prisma.bugActivity.deleteMany({ where: { bugId: task?.id } });
      await prisma.issueClaim.deleteMany({ where: { bugId: task?.id } });
      await prisma.mergeReview.deleteMany({ where: { bugId: task?.id } });
      await prisma.agentActivation.deleteMany({
        where: { agentId: { in: [agentA?.id, agentB?.id, agentManager?.id, agentReviewer?.id].filter(Boolean) } },
      }).catch(() => {});
      if (task?.id) await prisma.bug.delete({ where: { id: task.id } }).catch(() => {});
      if (agentA?.id) await prisma.agent.delete({ where: { id: agentA.id } }).catch(() => {});
      if (agentB?.id) await prisma.agent.delete({ where: { id: agentB.id } }).catch(() => {});
      if (agentManager?.id) await prisma.agent.delete({ where: { id: agentManager.id } }).catch(() => {});
      if (agentReviewer?.id) await prisma.agent.delete({ where: { id: agentReviewer.id } }).catch(() => {});
      await prisma.projectWorkflow.deleteMany({ where: { projectId: project?.id } });
      if (project?.id) await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
      await prisma.membership.deleteMany({ where: { organisationId: org?.id } });
      if (org?.id) await prisma.organisation.delete({ where: { id: org.id } }).catch(() => {});
      if (user?.id) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      if (managerUser?.id) await prisma.user.delete({ where: { id: managerUser.id } }).catch(() => {});
      if (reviewerUser?.id) await prisma.user.delete({ where: { id: reviewerUser.id } }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  });

  it("Scenario A: Two simultaneous first submissions via deliverWork acquire row lock and order sequences 1 and 2", async (ctx) => {
    if (!dbAvailable) {
      if (isDedicatedRun) throw new Error("PostgreSQL database is required for integration tests but is unavailable.");
      ctx.skip();
      return;
    }

    const agentContext = {
      agentId: agentA.id,
      name: "Agent A",
      ownerId: user.id,
      organisationId: org.id,
      level: "working" as const,
      burst: false,
      keyId: "test-key-id",
    };

    const [sub1, sub2] = await Promise.all([
      deliverWork(agentContext, task.id, {
        summary: "First submission Alpha",
        description: "Submission Alpha details",
        deliverableUrls: ["https://example.com/alpha"],
        publishedUrls: ["https://example.com/alpha"],
      }),
      deliverWork(agentContext, task.id, {
        summary: "First submission Beta",
        description: "Submission Beta details",
        deliverableUrls: ["https://example.com/beta"],
        publishedUrls: ["https://example.com/beta"],
      }),
    ]);

    expect([200, 201]).toContain(sub1.status);
    expect([200, 201]).toContain(sub2.status);

    // Verify exactly one Delivery record exists due to unique constraint on (bugId, agentId)
    const allDeliveries = await prisma.delivery.findMany({
      where: { bugId: task.id, agentId: agentA.id },
    });
    expect(allDeliveries.length).toBe(1);

    // Sequential atomic execution produced sequence 1 then sequence 2
    expect(allDeliveries[0].currentSequence).toBe(2);
  });

  it("Scenario B: Two simultaneous resubmissions via deliverWork increment sequence from 2 to 3 and 4", async (ctx) => {
    if (!dbAvailable) {
      if (isDedicatedRun) throw new Error("PostgreSQL database is required for integration tests but is unavailable.");
      ctx.skip();
      return;
    }

    const agentContext = {
      agentId: agentA.id,
      name: "Agent A",
      ownerId: user.id,
      organisationId: org.id,
      level: "working" as const,
      burst: false,
      keyId: "test-key-id",
    };

    const [r1, r2] = await Promise.all([
      deliverWork(agentContext, task.id, {
        summary: "Resubmission Gamma",
        description: "Submission Gamma details",
        deliverableUrls: ["https://example.com/gamma"],
        publishedUrls: ["https://example.com/gamma"],
      }),
      deliverWork(agentContext, task.id, {
        summary: "Resubmission Delta",
        description: "Submission Delta details",
        deliverableUrls: ["https://example.com/delta"],
        publishedUrls: ["https://example.com/delta"],
      }),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const delivery = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(delivery.currentSequence).toBe(4);
  });

  it("Scenario C: Attachment linking and rollback on failure", async (ctx) => {
    if (!dbAvailable) {
      if (isDedicatedRun) throw new Error("PostgreSQL database is required for integration tests but is unavailable.");
      ctx.skip();
      return;
    }

    const attachment = await prisma.attachment.create({
      data: {
        id: `att_${testRunId}`,
        bugId: task.id,
        filename: "proof.png",
        contentType: "image/png",
        size: 512,
        data: Buffer.from("test png data"),
        uploaderId: user.id,
      },
    });

    const agentContext = {
      agentId: agentA.id,
      name: "Agent A",
      ownerId: user.id,
      organisationId: org.id,
      level: "working" as const,
      burst: false,
      keyId: "test-key-id",
    };

    // Legitimate delivery with attachment
    const subWithAtt = await deliverWork(agentContext, task.id, {
      summary: "Submission with attachment",
      description: "Attached graphic proof",
      deliverableUrls: ["https://example.com/with-att"],
      publishedUrls: ["https://example.com/with-att"],
      attachmentIds: [attachment.id],
    });

    expect(subWithAtt.status).toBe(200);

    const linkedAtt = await prisma.attachment.findUniqueOrThrow({
      where: { id: attachment.id },
    });
    const delA = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(linkedAtt.deliveryId).toBe(delA.id);
    expect(linkedAtt.deliverySequence).toBe(5);
    expect(delA.currentSequence).toBe(5);

    // Attempted submission with invalid attachment triggers validation rejection and rollback
    const invalidSub = await deliverWork(agentContext, task.id, {
      summary: "Invalid submission",
      description: "This should fail",
      deliverableUrls: ["https://example.com/fail"],
      publishedUrls: ["https://example.com/fail"],
      attachmentIds: ["non_existent_att_id_12345"],
    });

    expect([400, 422]).toContain(invalidSub.status);

    // Verify currentSequence was NOT incremented on failed submission
    const deliveryAfterFail = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });
    expect(deliveryAfterFail.currentSequence).toBe(5);
  });

  it("Scenario D: Multiple distinct agents maintain independent delivery records", async (ctx) => {
    if (!dbAvailable) {
      if (isDedicatedRun) throw new Error("PostgreSQL database is required for integration tests but is unavailable.");
      ctx.skip();
      return;
    }

    // Release Claim A so Claim B can be assigned to the issue
    await prisma.issueClaim.update({
      where: { id: `claim_a_${testRunId}` },
      data: { status: "released", releasedAt: new Date(), releaseReason: "agent" },
    });

    // Add active claim for Agent B
    await prisma.issueClaim.create({
      data: {
        id: `claim_b_${testRunId}`,
        bugId: task.id,
        agentId: agentB.id,
        beneficiaryUserId: user.id,
        status: "active",
        claimedAt: new Date(),
      },
    });

    const agentContextB = {
      agentId: agentB.id,
      name: "Agent B",
      ownerId: user.id,
      organisationId: org.id,
      level: "working" as const,
      burst: false,
      keyId: "test-key-id-b",
    };

    const resB = await deliverWork(agentContextB, task.id, {
      summary: "Agent B Delivery",
      description: "Agent B completed social work",
      deliverableUrls: ["https://example.com/agent-b-work"],
      publishedUrls: ["https://example.com/agent-b-work"],
    });

    expect([200, 201]).toContain(resB.status);

    const deliveryB = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentB.id } },
    });
    const deliveryA = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(deliveryB.currentSequence).toBe(1);
    expect(deliveryA.currentSequence).toBe(5);
  });

  it("Scenario E: Manager acceptFix accepts Agent B's delivery and preserves Agent A's delivery", async (ctx) => {
    if (!dbAvailable) {
      if (isDedicatedRun) throw new Error("PostgreSQL database is required for integration tests but is unavailable.");
      ctx.skip();
      return;
    }

    // Transition bug to substatus "accepted"
    await prisma.bug.update({
      where: { id: task.id },
      data: { status: "done", substatus: "accepted" },
    });

    // Provide required test verdict from reviewer
    await prisma.testVerdict.create({
      data: {
        id: `verdict_${testRunId}`,
        bugId: task.id,
        agentId: agentReviewer.id,
        onBehalfOfUserId: reviewerUser.id,
        summary: "Reviewed and approved marketing campaign deliverables",
        description: "Verified all marketing assets and copy adhere to quality guidelines",
        goodToMerge: true,
      },
    });

    // Manager accepts Agent B's deliverable via production acceptFix
    const managerContext = {
      agentId: agentManager.id,
      name: "Manager Agent",
      ownerId: managerUser.id,
      organisationId: org.id,
      level: "manager" as const,
      burst: false,
      keyId: "test-manager-key-id",
    };

    const acceptRes = await acceptFix(
      managerContext,
      task.id,
      {
        verdict: "accept",
        summary: "Manager confirmed and accepted Agent B work",
        description: "Verified on live site",
        confirmPublication: true,
        manualOverrideReason: "Confirmed live on external partner site by marketing lead",
      },
      { actingUserId: managerUser.id },
    );

    expect(acceptRes.status).toBe(200);
    expect((acceptRes as any).accepted).toBe(true);
    expect((acceptRes as any).published).toBe(true);

    const updatedB = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentB.id } },
    });

    expect(updatedB.deliveryStatus).toBe("live_published");
    expect(updatedB.verifiedByManagerId).toBe(managerUser.id);
    expect(updatedB.verifiedPublishedAt).not.toBeNull();

    // Verify Agent A's delivery was NOT mutated by Agent B's acceptance
    const currentA = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(currentA.deliveryStatus).toBe("publication_pending");
    expect(currentA.verifiedByManagerId).toBeNull();
    expect(currentA.verifiedPublishedAt).toBeNull();
  });

  it("Scenario F: readLibrary selects accepted solver's delivery after reassignment, not superseded delivery", async (ctx) => {
    if (!dbAvailable) {
      if (isDedicatedRun) throw new Error("PostgreSQL database is required for integration tests but is unavailable.");
      ctx.skip();
      return;
    }

    // Touch Agent A's delivery to a future timestamp
    await prisma.delivery.update({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
      data: { updatedAt: new Date(Date.now() + 10000) },
    });

    const deliveryB = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentB.id } },
    });

    const libraryItems = await readLibrary({
      user,
      organisationId: org.id,
      project: { ...project, orgSlug: org.slug, ref: `${org.slug}/${project.slug}` as any, isOpenForContributors: false },
      isOrgMember: true,
      isProjectMember: true,
      isOrgAdmin: false,
      canContribute: true,
    });

    expect(libraryItems.length).toBe(1);
    expect(libraryItems[0].deliveryId).toBe(deliveryB.id);
    expect(libraryItems[0].agent).toBe("Agent B");
    expect(libraryItems[0].deliveryStatus).toBe("live_published");
  });
});
