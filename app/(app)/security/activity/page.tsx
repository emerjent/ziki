import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { loadSecurityActivity } from "@/lib/security-activity";
import { orgListCard, ReadOnlyNote } from "../../[org]/[project]/org/org-ui";

export const metadata = { title: "Security activity" };

export default async function SecurityActivityPage() {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  const activity = access.organisationId
    ? await loadSecurityActivity({ organisationId: access.organisationId, userId: user.id, admin: access.admin })
    : [];

  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      <Link href="/security" className="text-sm font-semibold text-zk-accent hover:underline">Back to Security</Link>
      <header className="space-y-1"><h1 className="text-xl font-bold tracking-tight text-zk-text">Security activity</h1><p className="text-sm text-zk-text2">
        Recent submissions, confirmations, assignments, verification, and disclosures you can view.
      </p></header>
      {activity.length ? (
        <ol className={orgListCard + " divide-y divide-zk-border"}>
          {activity.map((event) => event.finding ? (
            <li key={event.id} className="space-y-1 px-4 py-3 text-sm sm:px-6">
              <p className="font-semibold text-zk-text">{event.action}</p>
              <Link href={"/security/findings/" + event.finding.id} className="break-words text-zk-accent hover:underline">{event.finding.title}</Link>
              <p className="text-zk-text2">{event.actor} ({event.kind}) · <LocalTime date={event.date} /></p>
            </li>
          ) : null)}
        </ol>
      ) : <ReadOnlyNote>No security activity to show yet.</ReadOnlyNote>}
    </div>
  );
}
