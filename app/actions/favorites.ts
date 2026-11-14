"use server";

import { revalidatePath } from "next/cache";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { setFavorite } from "@/lib/favorites";

/** Star or unstar an issue (#902). Anyone who can see the issue may. */
export async function setFavoriteAction(
  bugId: string,
  favorite: boolean,
): Promise<{ ok?: boolean; favorited?: boolean; error?: string }> {
  const user = await requireUser();
  const bug = await prisma.bug.findUnique({
    where: { id: bugId },
    select: { id: true, isDeleted: true, organisationId: true, projectId: true, project: { select: { visibility: true } } },
  });
  if (!bug || bug.isDeleted) return { error: "Issue not found" };

  const canAccess =
    user.role === "super_admin" ||
    bug.project.visibility === "public" ||
    Boolean(
      (await prisma.projectMembership.findFirst({
        where: { projectId: bug.projectId, userId: user.id },
        select: { id: true },
      })) ||
        (await prisma.membership.findFirst({
          where: { organisationId: bug.organisationId, userId: user.id },
          select: { id: true },
        })),
    );
  if (!canAccess) return { error: "Issue not found" };

  const favorited = await setFavorite(prisma, user.id, bugId, Boolean(favorite));
  revalidateIssue();
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath(`/bugs/${bugId}`);
  // The "Starred" list lives beside the "Issues I'm watching" list (#312).
  revalidatePath("/bugs");
  return { ok: true, favorited };
}
