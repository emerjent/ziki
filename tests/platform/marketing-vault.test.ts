import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = vi.hoisted(() => ({
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  projectBrief: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { findUnique: vi.fn() },
  bug: { findFirst: vi.fn() },
  marketingCredential: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  marketingCredentialGrant: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  projectAuditEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}));

const mockAudit = vi.hoisted(() => vi.fn());
const mockCheckPostForSecrets = vi.hoisted(() => vi.fn());
const mockRequireAgent = vi.hoisted(() => vi.fn());
const mockResolveSessionUserId = vi.hoisted(() => vi.fn());
const mockCurrentOrganisationIdFor = vi.hoisted(() => vi.fn());
const mockIsAdminOfOrganisation = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/agents/audit", () => ({ audit: mockAudit }));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: mockResolveSessionUserId }));
vi.mock("@/lib/organisation-context", () => ({
  currentOrganisationIdFor: mockCurrentOrganisationIdFor,
  NO_ORGANISATION_MESSAGE: "You're not a member of an organisation yet.",
}));
vi.mock("@/lib/agents/membership", () => ({ isAdminOfOrganisation: mockIsAdminOfOrganisation }));
vi.mock("@/lib/security/secret-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/secret-guard")>()),
  checkPostForSecrets: mockCheckPostForSecrets,
}));
vi.mock("@/lib/agents/rate-budget", () => ({
  consumeAgentBudget: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/agents/require-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/require-agent")>()),
  requireAgent: mockRequireAgent,
}));

import { IssueApiError } from "@/lib/agent-api/errors";
import {
  createCredential,
  grantCredential,
  leaseCredential,
  revokeCredential,
} from "@/lib/marketing/credentials";
import { needsReseal, openCredential, sealCredential, VaultKeyError } from "@/lib/marketing/vault-crypto";
import { createCredentialSchema, grantCredentialSchema, leaseCredentialSchema } from "@/lib/validations/marketing-vault";
import { POST as leaseRoutePost } from "@/app/api/v1/marketing/credentials/[id]/lease/route";
import {
  GET as ownerListRouteGet,
  POST as ownerCreateRoutePost,
} from "@/app/api/v1/projects/[id]/marketing/credentials/route";
import { DELETE as ownerRevokeRouteDelete } from "@/app/api/v1/projects/[id]/marketing/credentials/[credentialId]/route";
import { POST as ownerGrantRoutePost } from "@/app/api/v1/projects/[id]/marketing/credentials/[credentialId]/grant/route";
import { GET as briefRouteGet, PUT as briefRoutePut } from "@/app/api/v1/projects/[id]/marketing/brief/route";

const KEY = "k".repeat(40);
const OTHER_KEY = "z".repeat(40);

describe("marketing vault crypto", () => {
  const saved = { current: process.env.MARKETING_VAULT_KEY, previous: process.env.MARKETING_VAULT_KEY_PREVIOUS };
  beforeEach(() => {
    process.env.MARKETING_VAULT_KEY = KEY;
    delete process.env.MARKETING_VAULT_KEY_PREVIOUS;
  });
  afterEach(() => {
    if (saved.current === undefined) delete process.env.MARKETING_VAULT_KEY;
    else process.env.MARKETING_VAULT_KEY = saved.current;
    if (saved.previous === undefined) delete process.env.MARKETING_VAULT_KEY_PREVIOUS;
    else process.env.MARKETING_VAULT_KEY_PREVIOUS = saved.previous;
  });

  it("round-trips and never contains the secret in the sealed text", () => {
    const sealed = sealCredential("abcd efgh ijkl mnop", "cred-1");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("abcd");
    expect(openCredential(sealed, "cred-1")).toBe("abcd efgh ijkl mnop");
  });

  it("gives a different ciphertext each time", () => {
    expect(sealCredential("same-secret-value", "c")).not.toBe(sealCredential("same-secret-value", "c"));
  });

  it("will not open on another credential's id (value copied between rows)", () => {
    const sealed = sealCredential("secret-value-1", "cred-1");
    expect(() => openCredential(sealed, "cred-2")).toThrow(VaultKeyError);
  });

  it("detects tampering", () => {
    const parts = sealCredential("secret-value-1", "cred-1").split(".");
    parts[4] = (parts[4][0] === "a" ? "b" : "a") + parts[4].slice(1);
    expect(() => openCredential(parts.join("."), "cred-1")).toThrow(VaultKeyError);
  });

  it("fails closed with no key and with a short key, and does not fall back to the auth secret", () => {
    delete process.env.MARKETING_VAULT_KEY;
    process.env.NEXTAUTH_SECRET = "n".repeat(64);
    expect(() => sealCredential("secret-value-1", "c")).toThrow(/MARKETING_VAULT_KEY/);
    process.env.MARKETING_VAULT_KEY = "too-short";
    expect(() => sealCredential("secret-value-1", "c")).toThrow(VaultKeyError);
  });

  it("supports rotation through the previous key", () => {
    const sealed = sealCredential("secret-value-1", "c");
    process.env.MARKETING_VAULT_KEY = OTHER_KEY;
    expect(() => openCredential(sealed, "c")).toThrow(/no longer configured/);
    process.env.MARKETING_VAULT_KEY_PREVIOUS = KEY;
    expect(openCredential(sealed, "c")).toBe("secret-value-1");
    expect(needsReseal(sealed)).toBe(true);
    expect(needsReseal(sealCredential("secret-value-1", "c"))).toBe(false);
  });
});

describe("credential validation", () => {
  const ok = { kind: "wordpress_app_password", label: "Blog", serviceUrl: "https://blog.example.com", secret: "abcd efgh ijkl mnop" };

  it("accepts a normal app password", () => {
    expect(createCredentialSchema.safeParse(ok).success).toBe(true);
  });

  it("refuses private keys and wallet recovery phrases", () => {
    const pem = createCredentialSchema.safeParse({ ...ok, secret: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----" });
    expect(pem.success).toBe(false);
    const phrase = "witch collapse practice feed shame open despair creek road again ice least";
    expect(createCredentialSchema.safeParse({ ...ok, secret: phrase }).success).toBe(false);
  });

  it("refuses http links, unknown kinds and unknown fields", () => {
    expect(createCredentialSchema.safeParse({ ...ok, serviceUrl: "http://blog.example.com" }).success).toBe(false);
    expect(createCredentialSchema.safeParse({ ...ok, kind: "root_password" }).success).toBe(false);
    expect(createCredentialSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("caps how long a grant can last and validates lease body", () => {
    expect(grantCredentialSchema.parse({ bugId: "b1" }).hours).toBe(24);
    expect(grantCredentialSchema.safeParse({ bugId: "b1", hours: 24 * 15 }).success).toBe(false);
    expect(leaseCredentialSchema.safeParse({ bugId: "b1" }).success).toBe(true);
    expect(leaseCredentialSchema.safeParse({ bugId: "" }).success).toBe(false);
    expect(leaseCredentialSchema.safeParse({ bugId: "b1", extra: true }).success).toBe(false);
  });
});

describe("credential lifecycle and lease", () => {
  const savedKey = process.env.MARKETING_VAULT_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETING_VAULT_KEY = KEY;
    mockCheckPostForSecrets.mockResolvedValue({ ok: true });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.MARKETING_VAULT_KEY;
    else process.env.MARKETING_VAULT_KEY = savedKey;
  });

  it("creates a credential, seals the secret, omits it from the returned view, and audits", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.marketingCredential.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      kind: data.kind,
      label: data.label,
      serviceUrl: data.serviceUrl,
      createdAt: new Date("2026-11-13T00:00:00Z"),
      lastUsedAt: null,
      revokedAt: null,
    }));

    const view = await createCredential("org-1", "proj-1", "user-1", {
      kind: "wordpress_app_password",
      label: "Company Blog",
      serviceUrl: "https://blog.example.com",
      secret: "wp-app-pass-1234",
    });

    expect(view).not.toHaveProperty("sealed");
    expect(view).not.toHaveProperty("secret");
    expect(view.label).toBe("Company Blog");

    const createCall = mockPrisma.marketingCredential.create.mock.calls[0][0];
    expect(createCall.data.sealed).toMatch(/^v1\./);
    expect(createCall.data.sealed).not.toContain("wp-app-pass-1234");
    expect(openCredential(createCall.data.sealed, createCall.data.id)).toBe("wp-app-pass-1234");
    expect(mockPrisma.projectAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "marketing.credential.created" }),
      }),
    );
  });

  it("blocks credentials whose label contains a secret", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockCheckPostForSecrets.mockResolvedValue({ ok: false, message: "Secret detected in label." });

    await expect(
      createCredential("org-1", "proj-1", "user-1", {
        kind: "api_token",
        label: "sk_live_1234567890",
        secret: "valid-secret-token",
      }),
    ).rejects.toThrow(/Secret detected/);
    expect(mockPrisma.marketingCredential.create).not.toHaveBeenCalled();
  });

  it("revokes a credential by wiping sealed data and revoking grants", async () => {
    mockPrisma.marketingCredential.findFirst.mockResolvedValue({ id: "cred-1", revokedAt: null });

    await revokeCredential("org-1", "proj-1", "cred-1", "user-1");

    expect(mockPrisma.marketingCredential.update).toHaveBeenCalledWith({
      where: { id: "cred-1" },
      data: expect.objectContaining({ revokedByUserId: "user-1", sealed: "revoked" }),
    });
    expect(mockPrisma.marketingCredentialGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { credentialId: "cred-1", revokedAt: null } }),
    );
    expect(mockPrisma.projectAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "marketing.credential.revoked" }),
      }),
    );
  });

  it("grants a credential to a marketing task and audits it", async () => {
    mockPrisma.marketingCredential.findFirst.mockResolvedValue({ id: "cred-1", revokedAt: null });
    mockPrisma.bug.findFirst.mockResolvedValue({ id: "bug-1" });

    const res = await grantCredential("org-1", "proj-1", "cred-1", "user-1", { bugId: "bug-1", hours: 12 });

    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mockPrisma.marketingCredentialGrant.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.projectAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "marketing.credential.granted" }),
      }),
    );
  });

  it("leases a decrypted secret when claim, grant, and project match, and audits the lease", async () => {
    const sealed = sealCredential("wp-secret-xyz", "cred-1");
    const expiresAt = new Date(Date.now() + 3600_000);
    mockPrisma.marketingCredentialGrant.findFirst.mockResolvedValue({
      expiresAt,
      credential: {
        id: "cred-1",
        projectId: "proj-1",
        kind: "wordpress_app_password",
        label: "Blog WP",
        serviceUrl: "https://blog.example.com",
        sealed,
      },
      bug: { projectId: "proj-1" },
    });

    const lease = await leaseCredential({
      agent: { agentId: "agent-1", organisationId: "org-1" },
      bugId: "bug-1",
      credentialId: "cred-1",
    });

    expect(lease).toEqual({
      kind: "wordpress_app_password",
      label: "Blog WP",
      serviceUrl: "https://blog.example.com",
      secret: "wp-secret-xyz",
      expiresAt,
    });
    expect(mockPrisma.marketingCredential.update).toHaveBeenCalledWith({
      where: { id: "cred-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      { agentId: "agent-1", organisationId: "org-1" },
      "marketing.credential.leased",
      "credential:cred-1",
      { label: "Blog WP" },
      { bugId: "bug-1" },
    );
  });

  it("denies lease with 404 and audits when grant is missing or project mismatches", async () => {
    mockPrisma.marketingCredentialGrant.findFirst.mockResolvedValue(null);

    await expect(
      leaseCredential({
        agent: { agentId: "agent-1", organisationId: "org-1" },
        bugId: "bug-1",
        credentialId: "cred-missing",
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockAudit).toHaveBeenCalledWith(
      { agentId: "agent-1", organisationId: "org-1" },
      "marketing.credential.lease_denied",
      "credential:cred-missing",
      null,
      { bugId: "bug-1" },
    );
  });

  it("returns 503 and audits lease_failed when sealed secret cannot be opened", async () => {
    mockPrisma.marketingCredentialGrant.findFirst.mockResolvedValue({
      expiresAt: new Date(Date.now() + 3600_000),
      credential: {
        id: "cred-1",
        projectId: "proj-1",
        kind: "api_token",
        label: "Broken",
        serviceUrl: null,
        sealed: "v1.badkey.00.00.00",
      },
      bug: { projectId: "proj-1" },
    });

    await expect(
      leaseCredential({
        agent: { agentId: "agent-1", organisationId: "org-1" },
        bugId: "bug-1",
        credentialId: "cred-1",
      }),
    ).rejects.toBeInstanceOf(IssueApiError);

    expect(mockAudit).toHaveBeenCalledWith(
      { agentId: "agent-1", organisationId: "org-1" },
      "marketing.credential.lease_failed",
      "credential:cred-1",
      null,
      { bugId: "bug-1" },
    );
  });

  it("POST /api/v1/marketing/credentials/[id]/lease returns secret with no-store cache header", async () => {
    mockRequireAgent.mockResolvedValue({
      agentId: "agent-1",
      organisationId: "org-1",
      ownerId: "user-1",
      ownerRole: "owner",
      level: "working",
      pausedAt: null,
      burst: false,
      burstUntil: null,
    });
    const sealed = sealCredential("route-secret-999", "cred-1");
    mockPrisma.marketingCredentialGrant.findFirst.mockResolvedValue({
      expiresAt: new Date(Date.now() + 3600_000),
      credential: {
        id: "cred-1",
        projectId: "proj-1",
        kind: "api_token",
        label: "Newsletter API",
        serviceUrl: "https://mail.example.com",
        sealed,
      },
      bug: { projectId: "proj-1" },
    });

    const req = new NextRequest("http://localhost:3000/api/v1/marketing/credentials/cred-1/lease", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ bugId: "bug-1" }),
    });

    const res = await leaseRoutePost(req, { params: Promise.resolve({ id: "cred-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const json = await res.json();
    expect(json.secret).toBe("route-secret-999");
    expect(json.label).toBe("Newsletter API");
  });
});

describe("owner credential management routes", () => {
  const savedKey = process.env.MARKETING_VAULT_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETING_VAULT_KEY = KEY;
    mockCheckPostForSecrets.mockResolvedValue({ ok: true });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
    mockResolveSessionUserId.mockResolvedValue({ userId: "user-1" });
    mockCurrentOrganisationIdFor.mockResolvedValue("org-1");
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "owner" });
    mockIsAdminOfOrganisation.mockResolvedValue(true);
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.MARKETING_VAULT_KEY;
    else process.env.MARKETING_VAULT_KEY = savedKey;
  });

  it("rejects bearer tokens on owner credential management routes", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/credentials", {
      method: "GET",
      headers: { authorization: "Bearer agent-key" },
    });
    const res = await ownerListRouteGet(req, { params: Promise.resolve({ id: "proj-1" }) });
    expect(res.status).toBe(403);
  });

  it("lists, creates, grants, and revokes credentials via owner routes", async () => {
    mockPrisma.marketingCredential.findMany.mockResolvedValue([
      {
        id: "cred-1",
        kind: "wordpress_app_password",
        label: "Blog WP",
        serviceUrl: "https://blog.example.com",
        createdAt: new Date("2026-11-13T00:00:00Z"),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);

    const listRes = await ownerListRouteGet(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/credentials"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.credentials).toHaveLength(1);
    expect(listJson.credentials[0]).not.toHaveProperty("sealed");

    mockPrisma.marketingCredential.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      kind: data.kind,
      label: data.label,
      serviceUrl: data.serviceUrl,
      createdAt: new Date("2026-11-13T00:00:00Z"),
      lastUsedAt: null,
      revokedAt: null,
    }));

    const createRes = await ownerCreateRoutePost(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "api_token",
          label: "CMS Token",
          serviceUrl: "https://cms.example.com",
          secret: "token-secret-1234",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    expect(createRes.status).toBe(201);

    mockPrisma.marketingCredential.findFirst.mockResolvedValue({ id: "cred-1", revokedAt: null });
    mockPrisma.bug.findFirst.mockResolvedValue({ id: "bug-1" });

    const grantRes = await ownerGrantRoutePost(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/credentials/cred-1/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bugId: "bug-1", hours: 8 }),
      }),
      { params: Promise.resolve({ id: "proj-1", credentialId: "cred-1" }) },
    );
    expect(grantRes.status).toBe(200);

    const revokeRes = await ownerRevokeRouteDelete(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/credentials/cred-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "proj-1", credentialId: "cred-1" }) },
    );
    expect(revokeRes.status).toBe(200);
  });

  it("reads and updates the marketing brief directly without going through settings, and blocks secrets", async () => {
    mockPrisma.projectBrief.findUnique.mockResolvedValue({
      product: "SkillTask",
      audience: "EU tech agencies",
      currentFocus: "Poland outreach",
      outOfScope: null,
    });
    mockPrisma.project.findUnique.mockResolvedValue({ siteUrl: "https://skilltask.ai" });

    const getRes = await briefRouteGet(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/brief"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.brief.product).toBe("SkillTask");
    expect(getJson.brief.website).toBe("https://skilltask.ai");

    mockCheckPostForSecrets.mockResolvedValueOnce({ ok: false, message: "Secret detected in brief." });
    const blockedRes = await briefRoutePut(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/brief", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product: "sk_live_secret123", audience: "", currentFocus: "", outOfScope: "" }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    expect(blockedRes.status).toBe(400);
    expect(mockPrisma.projectBrief.upsert).not.toHaveBeenCalled();

    const putRes = await briefRoutePut(
      new NextRequest("http://localhost:3000/api/v1/projects/proj-1/marketing/brief", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product: "SkillTask v2", audience: "EU agencies", currentFocus: "Q4 launch", outOfScope: "" }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    expect(putRes.status).toBe(200);
    expect(mockPrisma.projectBrief.upsert).toHaveBeenCalledTimes(1);
  });
});
