import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContributorPortalForm } from "@/components/contributor-portal-form";
import { portalIntroSentence } from "@/lib/public-idea-draft";
import { findPublicProject } from "@/lib/public-projects";
import { NOINDEX } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}): Promise<Metadata> {
  const { org, project: projectSlug } = await params;
  const project = await findPublicProject({ orgSlug: org, projectSlug }, { requireGuestIntake: true });
  return {
    title: project ? `Report an issue · ${project.name}` : "Contributor portal",
    robots: NOINDEX,
  };
}

export default async function ContributorPortalPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project: projectSlug } = await params;
  const project = await findPublicProject(
    { orgSlug: org, projectSlug },
    { requireGuestIntake: true },
  );
  if (!project) notFound();

  const initial = project.name.trim().charAt(0).toUpperCase() || "Z";
  const intro = portalIntroSentence(project.goal, project.name);

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <main className="mx-auto w-full max-w-xl space-y-6">
        <header className="flex items-start gap-3.5">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zk-border bg-zk-surface text-base font-extrabold text-zk-text shadow-xs"
          >
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zk-muted">{project.organisation.name}</p>
            <h1 className="text-xl font-extrabold tracking-tight text-zk-text">{project.name}</h1>
            <p className="mt-1 text-sm leading-6 text-zk-text2">{intro}</p>
          </div>
        </header>

        <section className="rounded-[20px] border border-zk-border bg-zk-surface p-5 shadow-xs sm:p-6">
          <ContributorPortalForm
            orgSlug={org}
            projectSlug={projectSlug}
            projectName={project.name}
          />
        </section>
      </main>
    </div>
  );
}
