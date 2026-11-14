import Link from "next/link";
import { TARGET_KIND_LABEL } from "@/lib/security-checks";
import { scanStage, type ScanStage, type WorkspaceCheckRow } from "@/lib/security-checks/entry";
import { LocalTime } from "@/components/local-time";
import { KindIcon } from "./entry-box";
import { SecurityWelcome } from "./security-welcome";
import { SecurityChat } from "./security-chat";
import { FlashNote } from "./flash-note";
import { PreviewResult } from "./preview-result";

/** One panel for everything, as wide as the tabs above it, like a project's Ideas and Issues. */
const PANEL = "mx-auto w-full max-w-6xl overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface";
const PRIMARY_BUTTON =
  "inline-flex h-9 items-center rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";
const BUTTON =
  "inline-flex h-9 items-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text transition hover:border-zk-accent hover:text-zk-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

const STAGE: Record<ScanStage, { label: string; tone: string }> = {
  scanning: { label: "Scanning", tone: "bg-zk-tint text-zk-accent" },
  report: { label: "Report ready", tone: "bg-zk-ok-bg text-zk-ok-fg" },
  in_app: { label: "In your app", tone: "bg-zk-chip text-zk-text" },
  cancelled: { label: "Cancelled", tone: "bg-zk-chip text-zk-muted" },
};

function PrivacyNote() {
  return (
    <p className="m-0 flex items-start gap-2 text-xs text-zk-muted">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      Agents only look. They never log in as you, change anything, or use what they find. Results stay private to you.
    </p>
  );
}

/**
 * The Security page (#security-checks, 14 Nov plan): one page, no wizard and
 * no proof step. With nothing scanned yet it's the one big box; after that
 * the box stays on top and the person's scans sit under it as cards, each
 * one click from its report.
 */
export function SecurityChecksPanel({
  checks,
  highlight,
  startWith,
}: {
  checks: WorkspaceCheckRow[];
  highlight?: { checkId: string; unlocked: number };
  /** An address brought from the public page after sign-up: its scan starts on arrival. */
  startWith?: string;
}) {
  if (checks.length === 0) {
    return (
      <section aria-label="Security" className={PANEL}>
        <SecurityWelcome startWith={startWith} />
      </section>
    );
  }

  return (
    <section aria-labelledby="security-scans-heading" className={PANEL}>
      <div className="border-b border-zk-divider bg-gradient-to-b from-zk-tint/60 to-zk-surface px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 text-center">
          <p className="m-0 text-xl font-extrabold tracking-tight text-zk-text sm:text-2xl">What do you want to secure?</p>
          <p className="m-0 text-sm text-zk-muted">Paste a website, server address or GitHub repo. Its scan shows here.</p>
          <div className="mt-4 w-full text-left">
            <SecurityChat id="security-chat" startWith={startWith} />
          </div>
        </div>
      </div>
      {highlight?.unlocked ? (
        <FlashNote>
          {highlight.unlocked === 1 ? "1 fix unlocked." : `${highlight.unlocked} fixes unlocked.`} Open the report to read each one in full, with how to fix it.
        </FlashNote>
      ) : null}
      <div className="p-3 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="security-scans-heading" className="m-0 text-base font-bold text-zk-text">
            Your scans <span className="font-normal tabular-nums text-zk-muted">{checks.length}</span>
          </h2>
          <p className="m-0 text-xs text-zk-muted">Newest first</p>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {/* The newest scan shows its whole result, so a reload after scanning still shows it. */}
          {checks.map((check, index) => (
            <ScanCard key={check.id} check={check} highlighted={highlight?.checkId === check.id} open={index === 0} />
          ))}
        </ul>
      </div>
      <div className="border-t border-zk-border bg-zk-bg px-4 py-3 sm:px-6">
        <PrivacyNote />
      </div>
    </section>
  );
}

const SEVERITY_DOT: Record<"critical" | "high" | "medium" | "low", string> = {
  critical: "bg-[#be123c]",
  high: "bg-[#dc2626]",
  medium: "bg-[#ea580c]",
  low: "bg-zk-muted",
};

/** One scan: what it is, where it is, what was found, and the one next click. */
function ScanCard({ check, highlighted, open }: { check: WorkspaceCheckRow; highlighted: boolean; open: boolean }) {
  const stage = scanStage(check);
  const reportHref = `/security/checks/${check.id}`;
  const payHref = `/security/checks/${check.id}/pay`;
  const canUnlock = check.posted && check.unlocked < check.findings;
  const quick = check.preview;
  const counts = quick ? (["critical", "high", "medium", "low"] as const).filter((severity) => quick.counts[severity] > 0) : [];

  const status = check.posted
    ? check.findings === 0
      ? "Report ready: nothing to fix."
      : `Report ready: ${check.findings} ${check.findings === 1 ? "finding" : "findings"}${check.unlocked ? `, ${check.unlocked} unlocked` : ""}.`
    : stage === "cancelled"
      ? "This scan was cancelled."
      : "Agents are checking it now.";

  return (
    <li className={`flex flex-col rounded-2xl border bg-zk-surface transition hover:border-zk-accent/50 hover:shadow-sm ${highlighted ? "border-zk-accent ring-2 ring-zk-accent/20" : "border-zk-border"}`}>
      <div className="flex items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zk-border bg-zk-bg">
          <KindIcon kind={check.kind} className="text-zk-text2" />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={reportHref} className="block truncate text-base font-bold text-zk-text hover:text-zk-accent">{check.value}</Link>
          <p className="m-0 text-[13px] text-zk-muted">
            {TARGET_KIND_LABEL[check.kind]} · <LocalTime date={check.createdAt} />
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${STAGE[stage].tone}`}>
          {stage === "scanning" ? <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
          {STAGE[stage].label}
        </span>
      </div>

      {/* The quick scan from when it was added: its counts at a glance, and the whole result one click away. */}
      {quick ? (
        <details open={open} className="group mx-4 rounded-xl bg-zk-bg">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] text-zk-text2 [&::-webkit-details-marker]:hidden">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zk-muted">Quick scan</span>
            {quick.total ? (
              counts.map((severity) => (
                <span key={severity} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SEVERITY_DOT[severity]}`} />
                  <span className="font-semibold tabular-nums text-zk-text">{quick.counts[severity]}</span> {severity}
                </span>
              ))
            ) : (
              <span className="text-zk-ok-fg">✓ Nothing found</span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 font-semibold text-zk-accent">
              <span className="group-open:hidden">See result</span>
              <span className="hidden group-open:inline">Hide result</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg>
            </span>
          </summary>
          <div className="px-2 pb-2 sm:px-3 sm:pb-3">
            <PreviewResult summary={quick} />
          </div>
        </details>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="m-0 min-w-0 flex-1 text-[13px] text-zk-text2">
          {status}
          {check.moved ? ` ${check.moved} moved to your app.` : ""}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {canUnlock ? (
            <>
              <Link href={reportHref} className={BUTTON}>Open report</Link>
              <Link href={payHref} className={PRIMARY_BUTTON}>Unlock fixes</Link>
            </>
          ) : (
            <Link href={reportHref} className={check.posted ? PRIMARY_BUTTON : BUTTON}>
              {check.posted ? "Open report" : "See progress"}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
