import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { TimeTrackingPanel } from "./time-tracking-panel";

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The issue's time entries, read by the page so the panel itself stays a
 * small client component. Only the most recent 100 entries are shown; the
 * total is the sum of the entries that are displayed.
 */
export async function IssueTimeTracking({ bugId, canEdit }: { bugId: string; canEdit: boolean }) {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  const entries = await prisma.timeEntry.findMany({
    where: { bugId },
    orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      minutes: true,
      note: true,
      spentOn: true,
      userId: true,
      user: { select: { name: true } },
    },
  });

  return (
    <TimeTrackingPanel
      bugId={bugId}
      canEdit={canEdit}
      isAdmin={access.admin}
      viewerId={user.id}
      entries={entries.map((entry) => ({
        id: entry.id,
        minutes: entry.minutes,
        note: entry.note,
        spentOnLabel: dayFormat.format(entry.spentOn),
        userId: entry.userId,
        userName: entry.user.name,
      }))}
    />
  );
}
