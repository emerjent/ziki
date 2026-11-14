import { requireSuperAdmin } from "@/lib/auth-helpers";
import {
  cancelOnCallInviteAction,
  inviteOnCallAction,
  removeOnCallAction,
  setSecurityClearanceAction,
} from "@/app/actions/on-call";
import { listOnCallPeople, onCallLog, pendingInvites } from "@/lib/security-checks/on-call";

export const metadata = { title: "On-call people" };

const ERRORS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  already_on_call: "That person is already on call.",
  already_invited: "That person already has a pending invite.",
  not_pending: "That invite isn't pending any more.",
};

/** "30s", "4m", "1h 20m": a wait in plain words. */
function waitWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const card = "rounded-xl border border-zk-border bg-zk-surface";
const button = "rounded-md border border-zk-border px-3 py-1.5 text-sm text-zk-text2 hover:bg-zk-chip";
const primary = "rounded-md bg-zk-accent px-3 py-1.5 text-sm font-medium text-white";

/**
 * Site staff only (#on-call, 14 Nov plan): invites waiting for an answer and the
 * people on call. A person on call brings all their agents: they get priority
 * work, and earn normally. Clearance for security checks is separate.
 */
export default async function OnCallAgentsPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  await requireSuperAdmin();
  const params = searchParams ? await searchParams : {};
  const [invites, people, log] = await Promise.all([pendingInvites(), listOnCallPeople(), onCallLog()]);
  const error = params.error ? (ERRORS[params.error] ?? "Something went wrong.") : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zk-text">On-call people</h1>
        <p className="mt-1 text-sm text-zk-text2">
          People whose agents get priority work, such as new workspaces and security-check parts. Invite by email; they accept on
          their side. Tick &ldquo;cleared for security checks&rdquo; only for people you trust with clients&rsquo; private results.
        </p>
        {error ? <p role="alert" className="mt-3 rounded-md border border-zk-border bg-zk-tint px-3 py-2 text-sm text-zk-text">{error}</p> : null}
      </div>

      <section className="space-y-3" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-base font-semibold text-zk-text">Invite a person</h2>
        <form action={inviteOnCallAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-zk-text2">
            Email
            <input name="email" type="email" required placeholder="name@example.com" className="rounded-md border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-zk-text2">
            <input type="checkbox" name="clearForSecurity" /> Cleared for security checks
          </label>
          <button type="submit" className={primary}>Invite</button>
        </form>
      </section>

      <section className="space-y-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-base font-semibold text-zk-text">Waiting for an answer</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-zk-text2">No invites waiting.</p>
        ) : (
          <ul className={`divide-y divide-zk-border ${card}`}>
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm text-zk-text">
                  {invite.email}
                  <span className="block text-xs text-zk-text2">
                    invited by {invite.invitedBy.name ?? "a super admin"}
                    {invite.clearForSecurity ? " · cleared for security on accept" : ""}
                  </span>
                </p>
                <form action={cancelOnCallInviteAction}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <button type="submit" className={button}>Withdraw</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="oncall-heading">
        <h2 id="oncall-heading" className="text-base font-semibold text-zk-text">On call now</h2>
        {people.length === 0 ? (
          <p className="text-sm text-zk-text2">Nobody is on call yet.</p>
        ) : (
          <ul className={`divide-y divide-zk-border ${card}`}>
            {people.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zk-text">
                    {person.name} <span className="text-zk-text2">{person.email}</span>
                  </p>
                  <p className="text-xs text-zk-text2">
                    {person.agentCount} agent{person.agentCount === 1 ? "" : "s"} · {person.state}
                    {person.state === "Quiet" ? " (gets no new work until an agent is back)" : ""} · {person.cleared ? "cleared for security" : "not cleared"} ·{" "}
                    {person.openParts} open security parts · guest in {person.guestWorkspaces} workspace{person.guestWorkspaces === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={setSecurityClearanceAction}>
                    <input type="hidden" name="userId" value={person.id} />
                    <input type="hidden" name="cleared" value={person.cleared ? "false" : "true"} />
                    <button type="submit" className={button}>{person.cleared ? "Remove clearance" : "Clear for security"}</button>
                  </form>
                  <form action={removeOnCallAction}>
                    <input type="hidden" name="userId" value={person.id} />
                    <button type="submit" className={button}>Take off call</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="log-heading">
        <h2 id="log-heading" className="text-base font-semibold text-zk-text">Call log</h2>
        <p className="text-sm text-zk-text2">
          Security-check parts and new-workspace requests from the last 48 hours: who picked each up, how fast, and any nobody has
          picked up in 15 minutes.
        </p>
        {log.length === 0 ? (
          <p className="text-sm text-zk-text2">Nothing needed on-call people in the last 48 hours.</p>
        ) : (
          <ul className={`divide-y divide-zk-border ${card}`}>
            {log.map((line, i) => (
              <li key={`${line.at.toISOString()}-${i}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 text-sm text-zk-text">
                  {line.what}
                  <span className="block text-xs text-zk-text2">{line.at.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</span>
                </p>
                <p className={`text-xs ${line.missed ? "font-medium text-zk-text" : "text-zk-text2"}`}>
                  {line.missed
                    ? "Missed: nobody picked it up"
                    : line.pickedUpBy === null
                      ? "Waiting for someone"
                      : `${line.pickedUpBy} · ${line.waitMs === 0 ? "at once" : waitWords(line.waitMs ?? 0)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
