import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { SecurityVerificationForm } from "@/components/security-verification-form";
import { SeverityChip } from "@/components/security-finding-panel";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { prisma } from "@/lib/prisma";
import { canViewFinding } from "@/lib/security-findings";
import { issuePath } from "@/lib/issue-ref";
import { ideaPath, refOf } from "@/lib/project-paths";
import { substatusLabel } from "@/lib/labels";
import { safeHref } from "@/lib/rich-text";
import { orgCard } from "../../../[org]/[project]/org/org-ui";

export const metadata = { title: "Security finding" };

export default async function FindingPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ severity?: string; stage?: string; q?: string; project?: string; assignee?: string; reporter?: string }>;
}) {
  const [{ id }, filters, user] = await Promise.all([params, searchParams, requireUser()]);
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) notFound();

  const finding = await prisma.securityFinding.findFirst({
    where: {
      id,
      organisationId: access.organisationId,
      OR: [{ bug: { isDeleted: false } }, { bugId: null, idea: { isDeleted: false } }],
    },
    select: {
      organisationId: true, reporterId: true, disclosedAt: true, severity: true,
      title: true, summary: true, description: true, createdAt: true,
      reporter: { select: { name: true } },
      project: { select: { name: true, slug: true, organisation: { select: { slug: true } } } },
      idea: { select: { number: true, status: true, isDeleted: true, createdByAgent: { select: { name: true } } } },
      bug: {
        select: {
          number: true, status: true, substatus: true, pullRequestUrl: true,
          assignee: { select: { name: true } },
          deliveries: { orderBy: { updatedAt: "desc" }, select: { id: true, summary: true, updatedAt: true, agent: { select: { name: true } } } },
          testVerdicts: { orderBy: { updatedAt: "desc" }, select: { id: true, summary: true, goodToMerge: true, updatedAt: true, agent: { select: { name: true } } } },
        },
      },
      attachments: { select: { id: true, filename: true } },
      verifications: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, passed: true, notes: true, reopened: true, createdAt: true, reviewer: { select: { name: true } }, evidence: { select: { id: true, filename: true } } } },
    },
  });
  if (!finding || !canViewFinding(finding, {
    kind: "person", userId: user.id, organisationId: access.organisationId, organisationAdmin: access.admin,
  })) notFound();

  const query = new URLSearchParams({ view: "findings" });
  for (const key of ["severity", "stage", "q", "project", "assignee", "reporter"] as const) {
    if (typeof filters[key] === "string") query.set(key, filters[key]);
  }
  const back = "/security?" + query.toString();
  const project = refOf(finding.project);
  const bug = finding.bug;
  const idea = finding.idea?.isDeleted ? null : finding.idea;
  const pullRequest = bug?.pullRequestUrl ? safeHref(bug.pullRequestUrl) : null;
  const reporter = finding.idea?.createdByAgent?.name;
  const linkClass = "font-semibold text-zk-accent hover:underline";

  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      <Link href={back} className={linkClass}>Back to Security</Link>
      <header className="space-y-2">
        <h1 className="break-words text-2xl font-bold tracking-tight text-zk-text">{finding.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zk-text2">
          <SeverityChip severity={finding.severity} />
          <span>{bug ? substatusLabel[bug.substatus] : idea?.status === "open" ? "Waiting for verdicts" : idea?.status ?? "Reported"}</span>
          <span>{finding.disclosedAt ? "Disclosed" : "Private"}</span>
        </div>
      </header>
      <section className={orgCard} aria-labelledby="report-heading">
        <h2 id="report-heading" className="text-base font-semibold text-zk-text">Report</h2>
        <dl className="my-3 grid gap-3 text-sm text-zk-text2 sm:grid-cols-2">
          <div><dt>Project</dt><dd>{finding.project.name}</dd></div>
          <div><dt>Reporter</dt><dd>{reporter ? reporter + " (agent)" : finding.reporter.name + " (person)"}</dd></div>
          <div><dt>Owner</dt><dd>{bug?.assignee?.name ?? "Unassigned"}</dd></div>
          <div><dt>Reported</dt><dd><LocalTime date={finding.createdAt} /></dd></div>
        </dl>
        {finding.summary ? <p className="mb-2 text-sm font-medium text-zk-text">{finding.summary}</p> : null}
        <RichText content={finding.description} className="text-sm" />
      </section>
      <section className={orgCard} aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="text-base font-semibold text-zk-text">Evidence</h2>
        {finding.attachments.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {finding.attachments.map((file) => (
              <li key={file.id}><a href={"/api/attachments/" + file.id} className={linkClass}>{file.filename}</a></li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-zk-text2">No evidence attached.</p>}
      </section>
      <section className={orgCard} aria-labelledby="remediation-heading">
        <h2 id="remediation-heading" className="text-base font-semibold text-zk-text">Remediation</h2>
        <div className="my-2 flex flex-wrap gap-3 text-sm">
          {idea ? <Link href={ideaPath(project, idea.number)} className={linkClass}>Idea #{idea.number}</Link> : null}
          {bug ? <Link href={issuePath(project, bug.number)} className={linkClass}>Issue #{bug.number}</Link> : null}
          {pullRequest ? <a href={pullRequest} className={linkClass}>Pull request</a> : null}
        </div>
        {bug?.deliveries.length ? (
          <ul className="divide-y divide-zk-border text-sm text-zk-text2">
            {bug.deliveries.map((entry) => (
              <li key={entry.id} className="py-2">
                <p>{entry.summary}</p>
                <p>{entry.agent.name} (agent) · <LocalTime date={entry.updatedAt} /></p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-zk-text2">No fixes delivered yet.</p>}
      </section>
      <section className={orgCard} aria-labelledby="independent-verification-heading">
        <h2 id="independent-verification-heading" className="text-base font-semibold text-zk-text">Independent verification</h2>
        {finding.verifications.length ? (
          <ul className="divide-y divide-zk-border text-sm text-zk-text2">
            {finding.verifications.map((entry) => (
              <li key={entry.id} className="space-y-1 py-2">
                <p className="font-semibold">{entry.passed ? "Fix verified" : entry.reopened ? "Verification failed and issue reopened" : "Verification failed"}</p>
                <p>{entry.reviewer?.name ?? "Former member"} · <LocalTime date={entry.createdAt} /></p>
                <p className="whitespace-pre-wrap break-words">{entry.notes}</p>
                {entry.evidence ? <a href={"/api/attachments/" + entry.evidence.id} className={linkClass}>{entry.evidence.filename}</a> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-zk-text2">No independent verification recorded yet.</p>}
        {access.admin && bug?.status === "resolved" ? <SecurityVerificationForm findingId={id} /> : null}
      </section>
      <section className={orgCard} aria-labelledby="verification-heading">
        <h2 id="verification-heading" className="text-base font-semibold text-zk-text">Fix review</h2>
        {bug?.testVerdicts.length ? (
          <ul className="divide-y divide-zk-border text-sm text-zk-text2">
            {bug.testVerdicts.map((entry) => (
              <li key={entry.id} className="py-2">
                <p className="font-semibold">{entry.goodToMerge ? "Good to merge" : "Changes needed"}</p>
                <p>{entry.summary}</p>
                <p>{entry.agent.name} (agent) · <LocalTime date={entry.updatedAt} /></p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-zk-text2">No fix reviews recorded yet.</p>}
      </section>
    </div>
  );
}
