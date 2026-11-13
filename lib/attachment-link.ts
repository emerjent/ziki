import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "attachment"> | Pick<Prisma.TransactionClient, "attachment">;

/** Most files one description or comment links by reference. */
export const MAX_REFERENCED_ATTACHMENTS = 20;

/**
 * Attachment ids referenced from Markdown as `/api/attachments/<id>`, for
 * images pasted or dropped into the editor (#305). Linking them on save is
 * what lets other readers see them; until then only the uploader can.
 */
export function attachmentIdsInMarkdown(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = [...text.matchAll(/\/api\/attachments\/([a-z0-9]{8,40})\b/gi)].map((m) => m[1]);
  return [...new Set(ids)].slice(0, MAX_REFERENCED_ATTACHMENTS);
}

/**
 * What a file is attached to: an issue (and maybe one of its comments,
 * confirmation entries, or delivery submissions), an idea (#idea-table),
 * or a private security finding (#security-findings), whose files only the
 * people who may see it can read.
 */
export type AttachmentTarget =
  | {
      bugId: string;
      commentId?: string | null;
      confirmationId?: string | null;
      deliveryId?: string | null;
      deliverySequence?: number | null;
      organisationId?: string;
    }
  | { ideaId: string }
  | { securityFindingId: string };

/**
 * Links freshly uploaded files to the issue, comment, delivery, or idea being saved (#215).
 * Only the uploader's own, not-yet-linked files can be claimed, so nobody can
 * attach - or steal - someone else's upload by guessing its id.
 */
export async function linkAttachments(
  db: Db,
  { ids, uploaderId, ...target }: { ids: string[]; uploaderId: string } & AttachmentTarget,
): Promise<number> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return 0;

  const baseWhere: Prisma.AttachmentWhereInput = {
    id: { in: uniqueIds },
    uploaderId,
    commentId: null,
    confirmationId: null,
    redesignProposalId: null,
    securityFindingId: null,
  };

  if ("deliveryId" in target && target.deliveryId) {
    // Delivery submission: verify tenant membership, unattached or same-task, and deliveryId null
    const where: Prisma.AttachmentWhereInput = {
      ...baseWhere,
      ideaId: null,
      deliveryId: null,
      OR: [{ bugId: null }, { bugId: target.bugId }],
      ...(target.organisationId
        ? {
            uploader: {
              memberships: {
                some: { organisationId: target.organisationId },
              },
            },
          }
        : {}),
    };

    const result = await db.attachment.updateMany({
      where,
      data: {
        bugId: target.bugId,
        deliveryId: target.deliveryId,
        deliverySequence: target.deliverySequence ?? null,
      },
    });

    if (result.count !== uniqueIds.length) {
      throw new Error(`Failed to link all attachments: expected ${uniqueIds.length}, updated ${result.count}`);
    }
    return result.count;
  }

  const result = await db.attachment.updateMany({
    where: {
      ...baseWhere,
      ideaId: null,
      bugId: null,
    },
    data:
      "securityFindingId" in target
        ? { securityFindingId: target.securityFindingId }
        : "ideaId" in target
          ? { ideaId: target.ideaId }
          : {
              bugId: target.bugId,
              commentId: target.commentId ?? null,
              confirmationId: target.confirmationId ?? null,
            },
  });
  return result.count;
}
