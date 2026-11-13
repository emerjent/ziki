import { describe, expect, it, vi } from "vitest";
import FindingPage from "./page";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { securityFinding: { findFirst } } }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: async () => ({ id: "viewer", role: "member" }) }));
vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: async () => ({ organisationId: "org", admin: false }),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found"); } }));

const props = { params: Promise.resolve({ id: "finding" }), searchParams: Promise.resolve({}) };

describe("finding details access", () => {
  it("rejects a direct link to another reporter's private finding", async () => {
    findFirst.mockResolvedValueOnce({ organisationId: "org", reporterId: "another", disclosedAt: null });
    await expect(FindingPage(props)).rejects.toThrow("Not found");
  });

  it("allows the reporter to open their unconverted private finding", async () => {
    findFirst.mockResolvedValueOnce({
      organisationId: "org", reporterId: "viewer", disclosedAt: null,
      title: "Finding", severity: "high", createdAt: new Date(),
      reporter: { name: "Reporter" }, project: { name: "Web", slug: "web", organisation: { slug: "org" } },
      idea: { number: 1, status: "open", isDeleted: false }, bug: null, attachments: [], verifications: [],
    });
    await expect(FindingPage(props)).resolves.toBeDefined();
  });
});
