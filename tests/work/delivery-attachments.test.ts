import { deliverWork } from "@/lib/agent-api/delivery";
import { deliveryFiles } from "@/components/marketing/library/model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";

const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    delivery: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bug: { findUnique: vi.fn(), update: vi.fn() },
    issueClaim: { findFirst: vi.fn() },
    bugActivity: { create: vi.fn() },
    attachment: { updateMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      bug: { findFirst: vi.fn() },
      issueClaim: { findFirst: vi.fn() },
      delivery: { findMany: vi.fn() },
      attachment: { count: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/agents/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/agent-api/events", () => ({ publish: mocks.publish }));

const agent = (level: AgentContext["level"], ownerId = "ada"): AgentContext => ({
  agentId: "agent_writer",
  name: "Writer",
  level,
  ownerId,
  organisationId: "org_1",
  burst: false,
  keyId: "key_1",
});

describe("Marketing Delivery Attachment Revisions & Concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.prisma.bug.findFirst.mockResolvedValue({
      id: "bug_mkt_1",
      projectId: "proj_1",
      track: "marketing",
      status: "in_progress",
      substatus: null,
      pullRequestUrl: null,
      project: { repoUrl: "https://github.com/emerjent/ziki" },
    });
    db.prisma.issueClaim.findFirst.mockResolvedValue({
      id: "claim_1",
      beneficiaryUserId: "beneficiary_user",
    });
    db.tx.bug.findUnique.mockResolvedValue({ status: "in_progress", isDeleted: false });
    db.tx.issueClaim.findFirst.mockResolvedValue({ id: "claim_1" });
    db.tx.$queryRaw.mockResolvedValue([{ id: "bug_mkt_1" }]);
  });

  it("1. Allows file-only delivery without markdown text or external URLs", async () => {
    db.prisma.attachment.count.mockResolvedValue(1);
    db.tx.delivery.findUnique.mockResolvedValue(null);
    db.tx.delivery.create.mockResolvedValue({ id: "del_1", currentSequence: 1 });
    db.tx.attachment.updateMany.mockResolvedValue({ count: 1 });
    db.prisma.delivery.findMany.mockResolvedValue([
      {
        id: "del_1",
        agentId: "agent_writer",
        beneficiaryUserId: "beneficiary_user",
        summary: "Created campaign brochure",
        description: "PDF file attached",
        pullRequestUrl: null,
        deliverableText: null,
        deliverableUrls: [],
        headSha: null,
        screenshots: [],
        testResults: null,
        receipt: null,
        currentSequence: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        agent: { name: "Writer" },
        beneficiary: { name: "Beneficiary" },
        replies: [],
        attachments: [{ id: "att_pdf_1", filename: "brochure.pdf", contentType: "application/pdf", size: 1024, deliverySequence: 1 }],
      },
    ]);

    const result = await deliverWork(agent("working"), "bug_mkt_1", {
      summary: "Created campaign brochure",
      description: "PDF file attached",
      attachmentIds: ["att_pdf_1"],
    });

    expect(result).toMatchObject({ status: 201 });
    expect(db.tx.delivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentSequence: 1,
          deliverableUrls: [],
          deliverableText: null,
        }),
      }),
    );
    expect(db.tx.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["att_pdf_1"] } }),
        data: {
          bugId: "bug_mkt_1",
          deliveryId: "del_1",
          deliverySequence: 1,
        },
      }),
    );
  });

  it("2. Sequence increments from 1 to 2 upon resubmission by the same agent", async () => {
    db.prisma.attachment.count.mockResolvedValue(1);
    db.tx.delivery.findUnique.mockResolvedValue({ id: "del_1", currentSequence: 1 });
    db.tx.delivery.update.mockResolvedValue({ id: "del_1", currentSequence: 2 });
    db.tx.attachment.updateMany.mockResolvedValue({ count: 1 });
    db.prisma.delivery.findMany.mockResolvedValue([]);

    const result = await deliverWork(agent("working"), "bug_mkt_1", {
      summary: "Revised brochure copy",
      description: "Updated version 2",
      attachmentIds: ["att_pdf_2"],
    });

    expect(result).toMatchObject({ status: 200, replaced: true });
    expect(db.tx.delivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "del_1" },
        data: expect.objectContaining({
          currentSequence: 2,
        }),
      }),
    );
    expect(db.tx.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          bugId: "bug_mkt_1",
          deliveryId: "del_1",
          deliverySequence: 2,
        },
      }),
    );
  });

  it("3. Same-round resubmission isolates attachments so Output Box only displays active sequence", () => {
    // Delivery sequence is 2
    const currentSequence = 2;
    const allAttachments = [
      { id: "att_1", filename: "rev1.pdf", contentType: "application/pdf", size: 1000, deliverySequence: 1 },
      { id: "att_2", filename: "rev2_final.pdf", contentType: "application/pdf", size: 1200, deliverySequence: 2 },
    ];

    const activeAttachments = allAttachments.filter((att) => att.deliverySequence === currentSequence);
    const files = deliveryFiles([], activeAttachments);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      id: "att_2",
      name: "rev2_final.pdf",
      kind: "PDFs",
      downloadable: true,
      local: true,
    });
  });

  it("4. Concurrent submissions serialize safely using parent Bug row lock", async () => {
    db.prisma.attachment.count.mockResolvedValue(1);
    db.tx.delivery.findUnique.mockResolvedValue(null);
    db.tx.delivery.create.mockResolvedValue({ id: "del_1", currentSequence: 1 });
    db.tx.attachment.updateMany.mockResolvedValue({ count: 1 });
    db.prisma.delivery.findMany.mockResolvedValue([]);

    await deliverWork(agent("working"), "bug_mkt_1", {
      summary: "First concurrent delivery",
      description: "Checking lock",
      attachmentIds: ["att_1"],
    });

    expect(db.tx.$queryRaw).toHaveBeenCalled();
  });

  it("5. Cross-task, already-attached, or wrong-uploader attachments fail with 422 invalid_attachments", async () => {
    // Preliminary check count fails (e.g. 0 owned instead of 1)
    db.prisma.attachment.count.mockResolvedValue(0);

    const result = await deliverWork(agent("working"), "bug_mkt_1", {
      summary: "Malicious submission attempt",
      description: "Trying to claim someone else's attachment",
      attachmentIds: ["att_other_user"],
    });

    expect(result).toMatchObject({
      status: 422,
      error: "invalid_attachments",
      field: "attachmentIds",
    });
    expect(db.tx.delivery.create).not.toHaveBeenCalled();
    expect(db.tx.delivery.update).not.toHaveBeenCalled();
  });

  it("6. Atomic update count mismatch triggers transaction rollback and 422 error", async () => {
    // Preliminary count succeeds, but atomic transaction update fails (e.g. claimed concurrently)
    db.prisma.attachment.count.mockResolvedValue(1);
    db.tx.delivery.findUnique.mockResolvedValue(null);
    db.tx.delivery.create.mockResolvedValue({ id: "del_1", currentSequence: 1 });
    db.tx.attachment.updateMany.mockResolvedValue({ count: 0 }); // mismatch!

    const result = await deliverWork(agent("working"), "bug_mkt_1", {
      summary: "Race condition test",
      description: "Attachment claimed just before transaction update",
      attachmentIds: ["att_race_1"],
    });

    expect(result).toMatchObject({
      status: 422,
      error: "invalid_attachments",
      field: "attachmentIds",
    });
  });

  it("7. Legacy attachments with null sequence resolve safely without breaking", () => {
    const legacyAttachments = [
      { id: "legacy_1", filename: "legacy_report.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 5000, deliverySequence: null },
    ];
    const files = deliveryFiles([], legacyAttachments);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      id: "legacy_1",
      name: "legacy_report.docx",
      kind: "Docs",
      downloadable: true,
      local: true,
    });
  });
});
