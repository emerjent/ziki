import Link from "next/link";

import { SecuritySettingsLink } from "@/components/security/security-settings-link";
import { SeverityChip } from "@/components/security-finding-panel";
import { SECURITY_STAGE_FILTERS } from "@/components/security-stage-filter";
import { SECURITY_SEVERITIES, SEVERITY_GUIDE } from "@/lib/security-severity";

const card = "rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6";
const stages = SECURITY_STAGE_FILTERS.filter((stage) => stage.value !== "all");

export function SecuritySettings({
  isAdmin,
  hasWorkspace,
}: {
  isAdmin: boolean;
  hasWorkspace: boolean;
}) {
  return (
    <div className="security-page mx-auto flex w-full max-w-5xl flex-col gap-5 pb-10">
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-3 text-xs text-zk-muted">
          <Link href="/security" className="hover:text-zk-text hover:underline">
            Security
          </Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page" className="font-semibold text-zk-text">
            Settings
          </span>
        </nav>
        <SecuritySettingsLink current />
      </div>

      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-zk-text">
          Security settings
        </h1>
        <p className="m-0 max-w-2xl text-sm leading-relaxed text-zk-text2">
          How security findings are protected, rated and moved through the workflow.
        </p>
        <Link href="/security?view=findings" className="w-fit text-sm font-semibold text-zk-accent hover:underline">
          Back to findings
        </Link>
      </header>

      {!hasWorkspace ? (
        <p className={`${card} text-sm text-zk-text2`}>
          Join or create a workspace to report and track security findings.
        </p>
      ) : (
        <>
          <div className={card} role="note">
            <p className="m-0 text-sm font-medium text-zk-text">
              Only workspace owners and admins can change security settings.
            </p>
            <p className="m-0 mt-1 text-sm text-zk-text2">Everything on this page is read-only.</p>
          </div>

          <section aria-labelledby="security-visibility" className={card}>
            <h2 id="security-visibility" className="m-0 text-base font-bold text-zk-text">
              Who can see a finding
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zk-text2">
              While a finding is private, its details are visible to the person who reported it and their agents,
              this workspace&apos;s owners and admins (including the site super admin), and agents cleared for security
              work. Everyone can read the details once the finding is disclosed. A workspace owner or admin decides when to disclose a finding.
            </p>
          </section>

          <section aria-labelledby="security-severity-guide" className={card}>
            <h2 id="security-severity-guide" className="m-0 text-base font-bold text-zk-text">
              Severity guide
            </h2>
            <dl className="m-0 mt-3 grid gap-4 sm:grid-cols-2">
              {SECURITY_SEVERITIES.map((severity) => (
                <div key={severity} className="space-y-1">
                  <dt>
                    <SeverityChip severity={severity} />
                  </dt>
                  <dd className="m-0 text-sm leading-relaxed text-zk-text2">{SEVERITY_GUIDE[severity]}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="security-cleared-agents" className={card}>
            <h2 id="security-cleared-agents" className="m-0 text-base font-bold text-zk-text">
              Agents cleared for security work
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zk-text2">
              {isAdmin
                ? "The Security page has the existing agent list and clearance controls. This settings page does not load or change agent clearance."
                : "Only workspace owners and admins can see or change agent clearance. This settings page does not load agent details."}
            </p>
            <Link
              href={isAdmin ? "/security?view=findings#agents-heading" : "/security?view=findings"}
              className="mt-3 inline-block text-sm font-semibold text-zk-accent hover:underline"
            >
              {isAdmin ? "View agent clearance on Security" : "Go to Security"}
            </Link>
          </section>

          <section aria-labelledby="security-workflow" className={card}>
            <h2 id="security-workflow" className="m-0 text-base font-bold text-zk-text">
              How findings move
            </h2>
            <p className="mt-2 text-sm text-zk-text2">Findings move through these stages in order:</p>
            <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {stages.map((stage, index) => (
                <li key={stage.value} className="flex items-center gap-3 text-sm text-zk-text2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zk-chip text-xs font-semibold tabular-nums text-zk-text">
                    {index + 1}
                  </span>
                  {stage.label}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
