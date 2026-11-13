import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { IssueApiError } from "@/lib/agent-api/errors";
import { audit } from "@/lib/agents/audit";
import { prisma } from "@/lib/prisma";
import { checkPostForSecrets } from "@/lib/security/secret-guard";
import { createCredentialSchema, grantCredentialSchema } from "@/lib/validations/marketing-vault";
import { openCredential, sealCredential, VaultKeyError } from "@/lib/marketing/vault-crypto";

/**
 * The marketing credential vault (docs/marketing-notes-and-vault.md).
 *
 * Rules, each enforced here rather than in routes:
 *  1. Nothing returned to a person or listed anywhere contains the secret.
 *  2. An agent gets a secret only through `leaseCredential`: marketing task,
 *     its own active claim, an unexpired owner grant, an unrevoked credential.
 *  3. Every create, grant, revoke and lease is audited. A lease records which
 *     agent, which task and which credential, never the value.
 *  Callers check that the person may manage the project (owners and admins).
 */

/** What a person sees. There is no field for the secret on purpose. */
export type CredentialView = {
  id: string;
  kind: string;
  label: string;
  serviceUrl: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

const VIEW_SELECT = {
  id: true,
  kind: true,
  label: true,
  serviceUrl: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} satisfies Prisma.MarketingCredentialSelect;

/** How long an owner's grant can last at most. Short on purpose. */
export const MAX_GRANT_HOURS = 24 * 14;

async function projectInOrganisation(organisationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organisationId }, select: { id: true } });
  if (!project) throw new IssueApiError(404, "Project not found.");
  return project;
}

/** Stores a credential. The value is checked, sealed and then forgotten. */
export async function createCredential(
  organisationId: string,
  projectId: string,
  actorUserId: string,
  rawInput: unknown,
): Promise<CredentialView> {
  const parsed = createCredentialSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new IssueApiError(400, parsed.error.issues[0]?.message ?? "Invalid credential.", { details: parsed.error.issues });
  }
  await projectInOrganisation(organisationId, projectId);
  const { kind, label, serviceUrl, secret } = parsed.data;

  // The label and URL are shown in lists and to agents, so they must not hold a secret.
  const check = await checkPostForSecrets({
    organisationId,
    projectId,
    actor: { kind: "user", userId: actorUserId },
    source: "marketing.credential",
    fields: { label, serviceUrl },
    noun: "this credential's label",
  });
  if (!check.ok) throw new IssueApiError(400, check.message);

  const id = randomUUID();
  let sealed: string;
  try {
    sealed = sealCredential(secret, id);
  } catch (error) {
    if (error instanceof VaultKeyError) throw new IssueApiError(503, "Credential storage is not configured on this server.");
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.marketingCredential.create({
      data: { id, organisationId, projectId, kind, label, serviceUrl: serviceUrl ?? null, sealed, createdByUserId: actorUserId },
      select: VIEW_SELECT,
    });
    await tx.projectAuditEvent.create({
      data: {
        organisationId,
        projectId,
        actorUserId,
        action: "marketing.credential.created",
        changes: { credentialId: id, kind, label } as Prisma.InputJsonValue,
      },
    });
    return row;
  });
}

/** The project's credentials, without secrets. */
export async function listCredentials(organisationId: string, projectId: string): Promise<CredentialView[]> {
  await projectInOrganisation(organisationId, projectId);
  return prisma.marketingCredential.findMany({
    where: { organisationId, projectId },
    orderBy: { createdAt: "desc" },
    select: VIEW_SELECT,
  });
}

/** Revokes a credential and every grant on it. The sealed value is wiped, not just flagged. */
export async function revokeCredential(
  organisationId: string,
  projectId: string,
  credentialId: string,
  actorUserId: string,
): Promise<void> {
  const credential = await prisma.marketingCredential.findFirst({
    where: { id: credentialId, organisationId, projectId },
    select: { id: true, revokedAt: true },
  });
  if (!credential) throw new IssueApiError(404, "Credential not found.");
  if (credential.revokedAt) return;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Overwritten, so a database leak after revoking exposes nothing.
    await tx.marketingCredential.update({
      where: { id: credentialId },
      data: { revokedAt: now, revokedByUserId: actorUserId, sealed: "revoked" },
    });
    await tx.marketingCredentialGrant.updateMany({ where: { credentialId, revokedAt: null }, data: { revokedAt: now } });
    await tx.projectAuditEvent.create({
      data: { organisationId, projectId, actorUserId, action: "marketing.credential.revoked", changes: { credentialId } },
    });
  });
}

/** Lets the agent working `bugId` use one credential for a limited time. */
export async function grantCredential(
  organisationId: string,
  projectId: string,
  credentialId: string,
  actorUserId: string,
  rawInput: unknown,
): Promise<{ expiresAt: Date }> {
  const parsed = grantCredentialSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new IssueApiError(400, parsed.error.issues[0]?.message ?? "Invalid grant.", { details: parsed.error.issues });
  }
  const [credential, bug] = await Promise.all([
    prisma.marketingCredential.findFirst({ where: { id: credentialId, organisationId, projectId }, select: { id: true, revokedAt: true } }),
    prisma.bug.findFirst({ where: { id: parsed.data.bugId, projectId, track: "marketing" }, select: { id: true } }),
  ]);
  if (!credential || credential.revokedAt) throw new IssueApiError(404, "Credential not found.");
  if (!bug) throw new IssueApiError(404, "Marketing task not found in this project.");

  const expiresAt = new Date(Date.now() + parsed.data.hours * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.marketingCredentialGrant.upsert({
      where: { credentialId_bugId: { credentialId, bugId: bug.id } },
      update: { expiresAt, revokedAt: null, grantedByUserId: actorUserId },
      create: { credentialId, bugId: bug.id, grantedByUserId: actorUserId, expiresAt },
    });
    await tx.projectAuditEvent.create({
      data: {
        organisationId,
        projectId,
        actorUserId,
        action: "marketing.credential.granted",
        changes: { credentialId, bugId: bug.id, expiresAt: expiresAt.toISOString() },
      },
    });
  });
  return { expiresAt };
}

export type CredentialLease = { kind: string; label: string; serviceUrl: string | null; secret: string; expiresAt: Date };

/**
 * The only way a secret leaves the vault. Every check failing gives the same
 * 404, so an agent cannot tell a credential it may not use from one that does
 * not exist.
 */
export async function leaseCredential(input: {
  agent: { agentId: string; organisationId: string };
  bugId: string;
  credentialId: string;
}): Promise<CredentialLease> {
  const { agent, bugId, credentialId } = input;
  const notFound = () => new IssueApiError(404, "Credential not available for this task.");
  const now = new Date();

  const grant = await prisma.marketingCredentialGrant.findFirst({
    where: {
      credentialId,
      bugId,
      revokedAt: null,
      expiresAt: { gt: now },
      credential: { organisationId: agent.organisationId, revokedAt: null },
      // The task is a marketing task in the same project as the credential, and this agent holds it right now.
      bug: {
        track: "marketing",
        claims: { some: { agentId: agent.agentId, status: "active" } },
      },
    },
    select: {
      expiresAt: true,
      credential: { select: { id: true, projectId: true, kind: true, label: true, serviceUrl: true, sealed: true } },
      bug: { select: { projectId: true } },
    },
  });
  if (!grant || grant.credential.projectId !== grant.bug.projectId) {
    await audit(agent, "marketing.credential.lease_denied", `credential:${credentialId}`, null, { bugId });
    throw notFound();
  }

  let secret: string;
  try {
    secret = openCredential(grant.credential.sealed, grant.credential.id);
  } catch {
    await audit(agent, "marketing.credential.lease_failed", `credential:${credentialId}`, null, { bugId });
    throw new IssueApiError(503, "This credential cannot be opened right now. Ask the project owner to add it again.");
  }

  await prisma.marketingCredential.update({ where: { id: credentialId }, data: { lastUsedAt: now } });
  await audit(agent, "marketing.credential.leased", `credential:${credentialId}`, { label: grant.credential.label }, { bugId });

  return {
    kind: grant.credential.kind,
    label: grant.credential.label,
    serviceUrl: grant.credential.serviceUrl,
    secret,
    expiresAt: grant.expiresAt,
  };
}
