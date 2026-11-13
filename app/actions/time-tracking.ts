"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { bugInOrganisation, currentOrganisationIdFor } from "@/lib/organisation-context";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { formatDuration, isValidMinutes, MAX_TIME_ENTRY_MINUTES } from "@/lib/time-tracking";

export type TimeTrackingActionResult = { ok?: true; error?: string };

function revalidate() {
  revalidateIssue();
  revalidatePath("/[project]", "layout");
}

/**
 * Log time against an issue. Only the issue's assignee or an organisation
 * admin may log time, matching who may change the issue's planning fields.
 */
export async function addTimeEntryAction(
  bugId: string,
  minutes: number,
  note: string,
): Promise<TimeTrackingActionResult> {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { error: "Select an organization first." };
  if (!isValidMinutes(minutes)) {
    return { error: `Enter whole minutes between 1 and ${MAX_TIME_ENTRY_MINUTES}.` };
  }
  const noteText = (note ?? "").trim();
  if (noteText.length > 500) return { error: "Keep the note under 500 characters." };

  const bug = await prisma.bug.findFirst({
    where: { id: bugId, ...bugInOrganisation(organisationId), isDeleted: false },
    select: { id: true, number: true, assigneeId: true },
  });
  if (!bug) return { error: "This issue no longer exists or was deleted." };

  const isAssignee = bug.assigneeId === user.id;
  if (!access.admin && !isAssignee) {
    return { error: "Only the assignee or an admin can log time on this issue." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.create({
        data: { bugId: bug.id, userId: user.id, minutes, note: noteText || null },
      });
      await tx.bugActivity.create({
        data: {
          bugId: bug.id,
          actorId: user.id,
          type: "commented",
          summary: `logged ${formatDuration(minutes)} on this issue`,
          metadata: { field: "time", minutes },
        },
      });
    });
  } catch (error) {
    console.error("Failed to log time:", error);
    return { error: "Failed to log time." };
  }

  revalidate();
  return { ok: true };
}

/** Remove a time entry. People may remove their own; admins may remove any. */
export async function deleteTimeEntryAction(entryId: string): Promise<TimeTrackingActionResult> {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { error: "Select an organization first." };

  const entry = await prisma.timeEntry.findFirst({
    where: { id: entryId, bug: { organisationId } },
    select: { id: true, bugId: true, userId: true, minutes: true },
  });
  if (!entry) return { ok: true };
  if (!access.admin && entry.userId !== user.id) {
    return { error: "You can only remove your own time entries." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.delete({ where: { id: entry.id } });
      await tx.bugActivity.create({
        data: {
          bugId: entry.bugId,
          actorId: user.id,
          type: "commented",
          summary: `removed a ${formatDuration(entry.minutes)} time entry`,
          metadata: { field: "time", minutes: -entry.minutes },
        },
      });
    });
  } catch (error) {
    console.error("Failed to remove time entry:", error);
    return { error: "Failed to remove the time entry." };
  }

  revalidate();
  return { ok: true };
}
