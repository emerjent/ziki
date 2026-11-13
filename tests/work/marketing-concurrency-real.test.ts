/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDummyDb = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("dummy");

describe("Marketing Output Engine - Real Database Concurrency & Integrity", () => {
  const testRunId = `test_${Date.now()}`;
  let dbAvailable = false;
  let user: any;
  let managerUser: any;
  let org: any;
  let project: any;
  let agentA: any;
  let agentB: any;
  let task: any;

  beforeAll(async () => {
    if (isDummyDb) {
      dbAvailable = false;
      return;
    }
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      return;
    }

    // Seed real DB test records
    user = await prisma.user.create({
      data: {
        id: `usr_${testRunId}`,
        email: `${testRunId}@example.com`,
        name: "Test Worker",
      },
    });

    managerUser = await prisma.user.create({
      data: {
        id: `mgr_${testRunId}`,
        email: `mgr_${testRunId}@example.com`,
        name: "Test Manager",
      },
    });

    org = await prisma.organisation.create({
      data: {
        id: `org_${testRunId}`,
        slug: `org-${testRunId}`,
        name: "Test Org",
      },
    });

    await prisma.membership.createMany({
      data: [
        { organisationId: org.id, userId: user.id, role: "member" },
        { organisationId: org.id, userId: managerUser.id, role: "admin" },
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

    await prisma.agentActivation.createMany({
      data: [
        { agentId: agentA.id, organisationId: org.id, level: "working" },
        { agentId: agentB.id, organisationId: org.id, level: "working" },
      ],
    });

    task = await prisma.bug.create({
      data: {
        id: `bug_${testRunId}`,
        organisationId: org.id,
        projectId: project.id,
        number: 1,
        title: "Launch Social Media Campaign",
        description: "Task description for marketing campaign",
        reporterId: user.id,
        beneficiaryUserId: user.id,
        track: "marketing",
        status: "in_progress",
        substatus: "in_progress",
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
      await prisma.attachment.deleteMany({ where: { bugId: task?.id } });
      await prisma.delivery.deleteMany({ where: { bugId: task?.id } });
      await prisma.bugActivity.deleteMany({ where: { bugId: task?.id } });
      await prisma.issueClaim.deleteMany({ where: { bugId: task?.id } });
      await prisma.agentActivation.deleteMany({ where: { agentId: { in: [agentA?.id, agentB?.id].filter(Boolean) } } }).catch(() => {});
      if (task?.id) await prisma.bug.delete({ where: { id: task.id } }).catch(() => {});
      if (agentA?.id) await prisma.agent.delete({ where: { id: agentA.id } }).catch(() => {});
      if (agentB?.id) await prisma.agent.delete({ where: { id: agentB.id } }).catch(() => {});
      if (project?.id) await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
      await prisma.membership.deleteMany({ where: { organisationId: org?.id } });
      if (org?.id) await prisma.organisation.delete({ where: { id: org.id } }).catch(() => {});
      if (user?.id) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      if (managerUser?.id) await prisma.user.delete({ where: { id: managerUser.id } }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  });

  it("Scenario A: Two simultaneous first submissions acquire row lock and order sequences 1 and 2", async (ctx) => {
    if (!dbAvailable) {
      ctx.skip();
      return;
    }
    // Function simulating genuine deliverWork transaction logic on real database
    async function submitDelivery(summary: string) {
      return prisma.$transaction(async (tx) => {
        // Mandatory parent row lock
        await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${task.id} FOR UPDATE`;

        const existing = await tx.delivery.findUnique({
          where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
          select: { id: true, currentSequence: true },
        });

        const nextSequence = existing ? existing.currentSequence + 1 : 1;

        if (existing) {
          return tx.delivery.update({
            where: { id: existing.id },
            data: {
              summary,
              description: `Submission ${summary}`,
              currentSequence: nextSequence,
              deliveryStatus: "ready_to_use",
            },
          });
        }

        return tx.delivery.create({
          data: {
            bugId: task.id,
            agentId: agentA.id,
            beneficiaryUserId: user.id,
            summary,
            description: `Submission ${summary}`,
            currentSequence: nextSequence,
            deliveryStatus: "ready_to_use",
          },
        });
      });
    }

    // Launch both simultaneous submissions
    const [sub1, sub2] = await Promise.all([
      submitDelivery("Alpha"),
      submitDelivery("Beta"),
    ]);

    expect(sub1).toBeDefined();
    expect(sub2).toBeDefined();

    // Verify exactly one Delivery record exists due to unique constraint
    const allDeliveries = await prisma.delivery.findMany({
      where: { bugId: task.id, agentId: agentA.id },
    });
    expect(allDeliveries.length).toBe(1);

    // The sequential execution should have produced sequence 1 then sequence 2
    expect(allDeliveries[0].currentSequence).toBe(2);
  });

  it("Scenario B: Two simultaneous resubmissions increment sequence from 2 to 3 and 4", async (ctx) => {
    if (!dbAvailable) {
      ctx.skip();
      return;
    }
    async function resubmitDelivery(summary: string) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${task.id} FOR UPDATE`;

        const existing = await tx.delivery.findUniqueOrThrow({
          where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
          select: { id: true, currentSequence: true },
        });

        const nextSequence = existing.currentSequence + 1;

        return tx.delivery.update({
          where: { id: existing.id },
          data: {
            summary,
            currentSequence: nextSequence,
          },
        });
      });
    }

    const [r1, r2] = await Promise.all([
      resubmitDelivery("Gamma"),
      resubmitDelivery("Delta"),
    ]);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    const delivery = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    // Sequence started at 2 and took two successive increments -> 4
    expect(delivery.currentSequence).toBe(4);
  });

  it("Scenario C: Multiple distinct agents maintain independent delivery records", async (ctx) => {
    if (!dbAvailable) {
      ctx.skip();
      return;
    }
    const deliveryB = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${task.id} FOR UPDATE`;
      return tx.delivery.create({
        data: {
          bugId: task.id,
          agentId: agentB.id,
          beneficiaryUserId: user.id,
          summary: "Agent B Delivery",
          description: "Agent B completed work",
          currentSequence: 1,
          deliveryStatus: "ready_to_use",
        },
      });
    });

    expect(deliveryB.currentSequence).toBe(1);

    const deliveryA = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(deliveryA.currentSequence).toBe(4);
    expect(deliveryB.currentSequence).toBe(1);
  });

  it("Scenario D: Transaction rollback on failure ensures sequence and data integrity", async (ctx) => {
    if (!dbAvailable) {
      ctx.skip();
      return;
    }
    const beforeDelivery = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${task.id} FOR UPDATE`;

        await tx.delivery.update({
          where: { id: beforeDelivery.id },
          data: { currentSequence: beforeDelivery.currentSequence + 1 },
        });

        // Deliberately trigger an error (e.g. invalid foreign key)
        await tx.attachment.create({
          data: {
            id: `att_fail_${Date.now()}`,
            bugId: "non_existent_bug_id_12345",
            filename: "error.pdf",
            contentType: "application/pdf",
            size: 100,
            data: Buffer.from("test content"),
            uploaderId: user.id,
          },
        });
      }),
    ).rejects.toThrow();

    // Verify rollback: currentSequence was NOT incremented
    const afterDelivery = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(afterDelivery.currentSequence).toBe(beforeDelivery.currentSequence);
  });

  it("Scenario E: Manager acceptance transitions accepted delivery and preserves superseded delivery", async (ctx) => {
    if (!dbAvailable) {
      ctx.skip();
      return;
    }
    // Manager confirms publication of Agent B's deliverable
    const updatedB = await prisma.delivery.update({
      where: { bugId_agentId: { bugId: task.id, agentId: agentB.id } },
      data: {
        deliveryStatus: "live_published",
        verifiedPublishedAt: new Date(),
        verifiedByManagerId: managerUser.id,
        manualOverrideReason: "Confirmed by manager",
      },
    });

    expect(updatedB.deliveryStatus).toBe("live_published");
    expect(updatedB.verifiedByManagerId).toBe(managerUser.id);

    // Verify Agent A's delivery was NOT mutated
    const currentA = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
    });

    expect(currentA.deliveryStatus).toBe("ready_to_use");
    expect(currentA.verifiedByManagerId).toBeNull();
  });

  it("Scenario F: readLibrary selects accepted solver's delivery after reassignment, not superseded delivery", async (ctx) => {
    if (!dbAvailable) {
      ctx.skip();
      return;
    }
    // Transition bug to resolved and published (as done by manager accept)
    await prisma.bug.update({
      where: { id: task.id },
      data: { status: "resolved", substatus: "published" },
    });

    // Record the accepted claim for Agent B
    await prisma.issueClaim.create({
      data: {
        id: `claim_acc_${testRunId}`,
        bugId: task.id,
        agentId: agentB.id,
        beneficiaryUserId: user.id,
        status: "released",
        releaseReason: "accepted",
        releasedAt: new Date(),
      },
    });

    // Even if Agent A's delivery is touched later, readLibrary must pick Agent B's accepted delivery
    await prisma.delivery.update({
      where: { bugId_agentId: { bugId: task.id, agentId: agentA.id } },
      data: { updatedAt: new Date(Date.now() + 10000) },
    });

    const deliveryB = await prisma.delivery.findUniqueOrThrow({
      where: { bugId_agentId: { bugId: task.id, agentId: agentB.id } },
    });

    const { readLibrary } = await import("@/app/(app)/[org]/[project]/marketing/output-box/data");
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
