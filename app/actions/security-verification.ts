"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { prisma } from "@/lib/prisma";
import { linkAttachments } from "@/lib/attachment-link";
import { moveTo } from "@/lib/issue-substatus";
import { statusChangedSummary } from "@/lib/activity-log";
import { issueChangePayload, publishWebEvent } from "@/lib/agent-api/web-events";

const input = z.object({
  outcome: z.enum(["pass", "fail", "reopen"]),
  notes: z.string().trim().min(1).max(4000),
  evidenceId: z.string().max(128).regex(/^[a-zA-Z0-9]*$/),
});

export async function recordSecurityVerification(
  findingId: string,
  _previous: { error?: string; ok?: boolean },
  form: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId || !access.admin) return { error: "Only workspace owners and admins can verify fixes." };
  const parsed = input.safeParse({
    outcome: form.get("outcome"), notes: form.get("notes"), evidenceId: form.get("evidenceId") ?? "",
  });
  if (!parsed.success) return { error: "Choose an outcome and describe what you verified in up to 4,000 characters." };

  const { outcome, notes, evidenceId } = parsed.data;
  const result = await prisma.$transaction(async (tx) => {
    const finding = await tx.securityFinding.findFirst({
      where: { id: findingId, organisationId: access.organisationId! },
      select: {
        disclosedAt: true,
        bug: { select: {
          id: true, status: true, substatus: true, isDeleted: true, assigneeId: true,
          deliveries: { where: { OR: [{ beneficiaryUserId: user.id }, { agent: { ownerUserId: user.id } }] }, select: { id: true }, take: 1 },
          claims: { where: { OR: [{ beneficiaryUserId: user.id }, { agent: { ownerUserId: user.id } }] }, select: { id: true }, take: 1 },
        } },
      },
    });
    const bug = finding?.bug;
    if (!finding || !bug || bug.isDeleted || bug.status !== "resolved") return { error: "Verification is available for a live fix." };
    if (bug.assigneeId === user.id || bug.deliveries.length || bug.claims.length) {
      return { error: "Ask another workspace admin to verify this fix." };
    }
    if (evidenceId) {
      const linked = await linkAttachments(tx, { ids: [evidenceId], uploaderId: user.id, securityFindingId: findingId });
      if (!linked) return { error: "Upload a new evidence file for this verification." };
      if (finding.disclosedAt) {
        await tx.attachment.update({ where: { id: evidenceId }, data: { bugId: bug.id } });
      }
    }

    const reopened = outcome === "reopen";
    if (reopened) {
      const next = moveTo("open");
      await tx.bug.update({ where: { id: bug.id }, data: next });
      await tx.bugActivity.create({
        data: {
          bugId: bug.id, actorId: user.id, type: "status_changed",
          summary: statusChangedSummary(bug.substatus, next.substatus),
          metadata: { field: "status", from: bug.substatus, to: next.substatus, via: "security_verification" },
        },
      });
      await publishWebEvent(tx, { bugId: bug.id, type: "issue.updated", actorUserId: user.id, payload: issueChangePayload(next) });
    }
    await tx.securityVerification.create({
      data: { findingId, reviewerId: user.id, passed: outcome === "pass", notes, evidenceId: evidenceId || null, reopened },
    });
    return { ok: true };
  }, { isolationLevel: "Serializable" }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      return { error: "The finding changed. Refresh and try again." };
    }
    throw error;
  });
  if ("ok" in result && result.ok) {
    revalidatePath("/security", "layout");
    revalidatePath("/[org]/[project]", "layout");
  }
  return result;
}
