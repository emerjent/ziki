import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { activeProjectIdFor } from "@/lib/project-context";
import { humanNotesActor, readProjectNotes, listNoteComments, listNoteRevisions } from "@/lib/project-notes";
import { NotesDocument } from "./notes-document";
import { AddNoteButton, NoteDiscussion } from "./note-discussion";

export const metadata = { title: "Project notes · Ziki" };
export default async function NotesPage({ searchParams }: { searchParams: Promise<{ cursor?: string; history?: string }> }) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  const projectId = tenantId ? await activeProjectIdFor(prisma, tenantId) : null;
  if (!tenantId || !projectId) return (
    <div className="mx-auto w-full max-w-6xl rounded-[20px] border border-zk-border bg-zk-surface p-7">
      <h1 className="font-bold text-zk-text">Project notes</h1>
      <p className="mt-2 text-sm text-zk-text2">Select a workspace and project to read its notes.</p>
      <Link href="/org/projects" className="mt-4 inline-block text-sm font-semibold text-zk-accent underline">View projects</Link>
    </div>
  );
  const params = await searchParams;
  const actor = await humanNotesActor(user, tenantId, projectId);
  const [project, result, comments, revisions] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
    readProjectNotes(actor),
    listNoteComments(actor, new URLSearchParams(params.cursor ? { cursor: params.cursor } : {})),
    listNoteRevisions(actor, new URLSearchParams({ limit: "10", ...(params.history ? { cursor: params.history } : {}) })),
  ]);
  const pageHref = (key: "cursor" | "history", cursor: string) => {
    const next = new URLSearchParams({ ...(params.cursor ? { cursor: params.cursor } : {}), ...(params.history ? { history: params.history } : {}), [key]: cursor });
    return `/notes?${next}`;
  };
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-zk-text2"><Link href="/issues" className="truncate hover:text-zk-text">{project.name}</Link><span aria-hidden="true">›</span><h1 aria-current="page" className="font-semibold text-zk-text">Notes</h1></nav>
        <div className="flex flex-wrap gap-2"><AddNoteButton /><Link href="/issues" className="rounded-lg border border-zk-border px-3 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip">Back to issues</Link></div>
      </div>
      <NotesDocument key={projectId} projectId={projectId} canEdit={result.canEdit}
        notes={result.notes ? { ...result.notes, updatedAt: result.notes.updatedAt.toISOString() } : null}
        revisions={revisions.items.map((revision) => ({ ...revision, createdAt: revision.createdAt.toISOString() }))}
        historyLink={revisions.nextCursor ? pageHref("history", revisions.nextCursor) : undefined} />
      <NoteDiscussion key={projectId} projectId={projectId}
        comments={comments.items.map((comment) => ({ id: comment.id, body: comment.body, authorName: comment.authorName,
          agentId: comment.agentId, createdAt: comment.createdAt.toISOString(), upvotes: comment.upvotes }))}
        nextHref={comments.nextCursor ? pageHref("cursor", comments.nextCursor) : undefined}
        latestHref={params.cursor || params.history ? "/notes" : undefined} />
    </div>
  );
}
