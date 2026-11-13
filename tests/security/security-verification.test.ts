import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordSecurityVerification } from "@/app/actions/security-verification";

const { access, tx } = vi.hoisted(() => ({
  access: vi.fn(),
  tx: {
    securityFinding: { findFirst: vi.fn() },
    securityVerification: { create: vi.fn() },
    bug: { update: vi.fn() },
    bugActivity: { create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: async () => ({ id: "reviewer", role: "user" }) }));
vi.mock("@/lib/organisation-access", () => ({ currentOrganisationAccess: access }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (run: (db: typeof tx) => unknown) => run(tx) } }));
vi.mock("@/lib/agent-api/web-events", () => ({ issueChangePayload: vi.fn(), publishWebEvent: vi.fn() }));

const live = { id: "issue", status: "resolved", substatus: "on_prod", assigneeId: "fixer", deliveries: [], claims: [] };

function verify(outcome = "pass") {
  const form = new FormData();
  form.set("outcome", outcome);
  form.set("notes", "Replayed the reproduction steps");
  return recordSecurityVerification("finding", {}, form);
}

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ organisationId: "workspace", admin: true });
  tx.securityFinding.findFirst.mockResolvedValue({ bug: live, disclosedAt: null });
});

describe("independent security verification", () => {
  it("refuses a workspace member who is not an admin", async () => {
    access.mockResolvedValue({ organisationId: "workspace", admin: false });
    expect(await verify()).toHaveProperty("error");
    expect(tx.securityVerification.create).not.toHaveBeenCalled();
  });

  it("refuses the owner of an agent that delivered the fix", async () => {
    tx.securityFinding.findFirst.mockResolvedValue({ bug: { ...live, deliveries: [{ id: "delivery" }] } });
    expect(await verify()).toHaveProperty("error");
    expect(tx.securityVerification.create).not.toHaveBeenCalled();
  });

  it("records a passing verification without moving the issue", async () => {
    expect(await verify()).toEqual({ ok: true });
    expect(tx.securityVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ findingId: "finding", reviewerId: "reviewer", passed: true, reopened: false }),
    });
    expect(tx.bug.update).not.toHaveBeenCalled();
  });

  it("records a failed verification and reopens the live issue", async () => {
    expect(await verify("reopen")).toEqual({ ok: true });
    expect(tx.bug.update).toHaveBeenCalledWith({ where: { id: "issue" }, data: { status: "open", substatus: "open" } });
    expect(tx.securityVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ passed: false, reopened: true }),
    });
  });
});
