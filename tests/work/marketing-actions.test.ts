/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => {
  const deliveries = new Map<string, any>();
  const bugs = new Map<string, any>();

  const tx = {
    $queryRaw: vi.fn(async () => [{ id: "del_1" }]),
    delivery: {
      findUnique: vi.fn(async ({ where }: any) => deliveries.get(where.id) || null),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = deliveries.get(where.id);
        const updated = { ...existing, ...data };
        deliveries.set(where.id, updated);
        return updated;
      }),
    },
    bugActivity: { create: vi.fn(async () => ({})) },
  };

  return {
    tx,
    deliveries,
    bugs,
    prisma: {
      delivery: {
        findUnique: vi.fn(async ({ where }: any) => deliveries.get(where.id) || null),
        update: vi.fn(async ({ where, data }: any) => {
          const existing = deliveries.get(where.id);
          const updated = { ...existing, ...data };
          deliveries.set(where.id, updated);
          return updated;
        }),
      },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});

const mockProjectContext = vi.hoisted(() => ({
  context: {
    user: { id: "user_member", name: "Alice Developer", email: "alice@example.com", role: "member" },
    organisationId: "org_1",
    project: { id: "proj_1", slug: "website", orgSlug: "acme", visibility: "public" as "public" | "private" },
    isOrgMember: true,
    isProjectMember: false,
    isOrgAdmin: false,
    canContribute: true,
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/lib/project-route", () => ({
  requireProject: vi.fn(async () => mockProjectContext.context),
}));
vi.mock("@/lib/marketing/verify-url", () => ({
  verifyPublishedUrls: vi.fn(async (urls: string[]) => ({
    allOk: true,
    results: urls.map((u) => ({
      url: u,
      ok: true,
      status: 200,
      ip: "93.184.216.34",
      latencyMs: 45,
      method: "HEAD",
      redirectCount: 0,
      checkedAt: new Date().toISOString(),
    })),
  })),
}));

import {
  toggleDeliveryImplementedAction,
  retryUrlVerificationAction,
} from "@/app/(app)/[org]/[project]/marketing/output-box/actions";
import { projectRef } from "@/lib/project-paths";

describe("Output Box Server Actions - Implementation Tracking & Verification", () => {
  const slug = projectRef("acme", "website");

  beforeEach(() => {
    db.deliveries.clear();
    db.bugs.clear();

    db.deliveries.set("del_1", {
      id: "del_1",
      bugId: "bug_1",
      currentSequence: 1,
      deliveryStatus: "ready_to_use",
      previousStatus: null,
      implementedAt: null,
      implementedById: null,
      publishedUrls: ["https://example.com/blog/live-post"],
      bug: {
        id: "bug_1",
        projectId: "proj_1",
        organisationId: "org_1",
        track: "marketing",
      },
    });

    mockProjectContext.context.project.visibility = "public";
    mockProjectContext.context.isOrgMember = true;
    mockProjectContext.context.isProjectMember = false;
    mockProjectContext.context.isOrgAdmin = false;
  });

  it("refuses unauthorized users who are not project/org members", async () => {
    mockProjectContext.context.isOrgMember = false;
    mockProjectContext.context.isProjectMember = false;
    mockProjectContext.context.isOrgAdmin = false;

    const res = await toggleDeliveryImplementedAction(slug, "del_1", true);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Only project members or organisation administrators");
    }
  });

  it("refuses non-project members from modifying deliveries in private projects", async () => {
    mockProjectContext.context.project.visibility = "private";
    mockProjectContext.context.isOrgMember = true;
    mockProjectContext.context.isProjectMember = false;
    mockProjectContext.context.isOrgAdmin = false;

    const res = await toggleDeliveryImplementedAction(slug, "del_1", true);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Only project members or organisation administrators can update implementation status in a private project.");
    }
  });

  it("allows project members to modify deliveries in private projects", async () => {
    mockProjectContext.context.project.visibility = "private";
    mockProjectContext.context.isOrgMember = true;
    mockProjectContext.context.isProjectMember = true;
    mockProjectContext.context.isOrgAdmin = false;

    const res = await toggleDeliveryImplementedAction(slug, "del_1", true);
    expect(res.ok).toBe(true);
  });

  it("allows organisation administrators to modify deliveries in private projects", async () => {
    mockProjectContext.context.project.visibility = "private";
    mockProjectContext.context.isOrgMember = true;
    mockProjectContext.context.isProjectMember = false;
    mockProjectContext.context.isOrgAdmin = true;

    const res = await toggleDeliveryImplementedAction(slug, "del_1", true);
    expect(res.ok).toBe(true);
  });

  it("marks a delivery as implemented and saves previous status", async () => {
    const res = await toggleDeliveryImplementedAction(slug, "del_1", true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.deliveryStatus).toBe("implemented");
    expect(res.implementedAt).not.toBeNull();
    expect(res.implementedByName).toBe("Alice Developer");

    const updated = db.deliveries.get("del_1");
    expect(updated.deliveryStatus).toBe("implemented");
    expect(updated.previousStatus).toBe("ready_to_use");
    expect(updated.implementedById).toBe("user_member");
    expect(db.tx.bugActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "status_changed",
          actorId: "user_member",
        }),
      }),
    );
  });

  it("reverts an implemented delivery back to its previous status", async () => {
    // Stage delivery as already implemented from live_published
    db.deliveries.set("del_1", {
      id: "del_1",
      bugId: "bug_1",
      deliveryStatus: "implemented",
      previousStatus: "live_published",
      implementedAt: new Date("2026-11-01T12:00:00Z"),
      implementedById: "user_member",
      publishedUrls: [],
      bug: {
        id: "bug_1",
        projectId: "proj_1",
        organisationId: "org_1",
        track: "marketing",
      },
    });

    const res = await toggleDeliveryImplementedAction(slug, "del_1", false);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.deliveryStatus).toBe("live_published");
    expect(res.implementedAt).toBeNull();
    expect(res.implementedByName).toBeNull();

    const updated = db.deliveries.get("del_1");
    expect(updated.deliveryStatus).toBe("live_published");
    expect(updated.previousStatus).toBeNull();
    expect(updated.implementedById).toBeNull();
  });

  it("re-verifies candidate published URLs and stores evidence", async () => {
    const res = await retryUrlVerificationAction(slug, "del_1");
    expect(res.ok).toBe(true);
    expect(res.evidence).toBeDefined();

    const updated = db.deliveries.get("del_1");
    expect(updated.verificationEvidence).toBeDefined();
    expect(updated.verificationEvidence.allOk).toBe(true);
    expect(db.tx.bugActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "status_changed",
          summary: expect.stringContaining("Marketing deliverable URL verification passed"),
        }),
      }),
    );
  });

  it("rejects stale verification results when delivery sequence has advanced", async () => {
    // Stage delivery at sequence 1 initially, but during verification transaction it is at sequence 2
    const checkedSequence = 1;
    db.prisma.delivery.findUnique.mockImplementation(async ({ where }: any) => {
      const del = db.deliveries.get(where.id);
      return del ? { ...del, currentSequence: checkedSequence } : null;
    });

    db.tx.delivery.findUnique.mockImplementation(async ({ where }: any) => {
      const del = db.deliveries.get(where.id);
      // Simulate that by the time verification finishes and acquires lock, sequence advanced to 2
      return del ? { ...del, currentSequence: 2 } : null;
    });

    const res = await retryUrlVerificationAction(slug, "del_1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Stale verification result");

    // Must record discarded audit history
    expect(db.tx.bugActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "status_changed",
          summary: expect.stringContaining("discarded"),
        }),
      }),
    );
  });
});
