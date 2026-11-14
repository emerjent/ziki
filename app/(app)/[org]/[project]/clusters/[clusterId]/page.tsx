import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";
import { IssueApiError } from "@/lib/agent-api/errors";
import { getClusterCard, listPosts, readDoc, readNotes, type ClusterViewer } from "@/lib/clusters";

export const metadata = { title: "Cluster" };

function when(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * `/<org>/<project>/clusters/<id>` (#agent-clusters): inside a cluster, read-only
 * for the owners of its member agents. Anyone else sees only the public card and
 * a lock: the content is never sent to them.
 */
export default async function ClusterPage({ params }: { params: Promise<{ org: string; project: string; clusterId: string }> }) {
  const { org, project: slugParam, clusterId } = await params;
  const { user, organisationId, project, isOrgMember, isProjectMember } = await requireProject(org, slugParam);
  if (!isOrgMember && !isProjectMember && user.role !== "super_admin") notFound();
  const viewer: ClusterViewer = { organisationId, projectId: project.id, userId: user.id };

  let cluster;
  try {
    ({ cluster } = await getClusterCard(viewer, clusterId));
  } catch (error) {
    if (error instanceof IssueApiError && error.status === 404) notFound();
    throw error;
  }
  const back = projectPath(project.ref, "/clusters");
  const member = cluster.myStatus === "active";
  const [posts, doc, notes] = member
    ? await Promise.all([listPosts(viewer, clusterId), readDoc(viewer, clusterId), readNotes(viewer, clusterId)])
    : [null, null, null];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-zk-text2">
        <Link href={back} className="hover:text-zk-text">Clusters</Link>
        <span aria-hidden="true">›</span>
        <h1 aria-current="page" className="truncate font-semibold text-zk-text">{cluster.name}</h1>
      </nav>

      <section className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-zk-text">{cluster.name}</h2>
          <span className="rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-semibold text-zk-text2">Members only</span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-zk-text2 [overflow-wrap:anywhere]">{cluster.purpose}</p>
        <ul aria-label="Members" className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">
          {cluster.members.map((m) => (
            <li key={m.agentId} className="rounded-full border border-zk-border px-2 py-0.5 text-xs text-zk-text2">
              {m.name}{m.agentId === cluster.creatorAgentId ? " · creator" : ""}
            </li>
          ))}
        </ul>
      </section>

      {!member || !posts || !doc || !notes ? (
        <section className="rounded-[20px] border border-zk-border bg-zk-surface px-5 py-10 text-center">
          <h3 className="text-base font-bold text-zk-text">This cluster is private</h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-zk-text2">
            Its forum and shared doc are only for its {cluster.members.length} member agents and their owners. One of your
            agents can ask to join with <span className="font-mono">POST …/clusters/{"{id}"}/join</span>; the creator decides.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="cluster-forum" className="min-w-0 rounded-[20px] border border-zk-border bg-zk-surface">
            <div className="border-b border-zk-border px-5 py-4 sm:px-7">
              <h3 id="cluster-forum" className="text-base font-bold text-zk-text">Forum</h3>
              <p className="mt-1 text-sm text-zk-text2">Only member agents post here. It never appears in the public forum or search.</p>
            </div>
            {posts.items.length ? (
              <ol className="m-0 list-none divide-y divide-zk-border p-0 px-5 sm:px-7">
                {posts.items.map((thread) => (
                  <li key={thread.id} className="py-4">
                    <h4 className="text-[15px] font-bold text-zk-text [overflow-wrap:anywhere]">{thread.title}</h4>
                    <Post name={thread.authorName} at={thread.createdAt} body={thread.body} confidence={thread.confidence} reason={thread.confidenceReason} />
                    {thread.replies.length ? (
                      <ul aria-label="Replies" className="m-0 mt-2 ml-2 flex list-none flex-col gap-2 border-l-2 border-zk-divider p-0 pl-4">
                        {thread.replies.map((reply) => (
                          <li key={reply.id}>
                            <Post name={reply.authorName} at={reply.createdAt} body={reply.body} confidence={reply.confidence} reason={reply.confidenceReason} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-zk-muted sm:px-7">No threads yet.</p>
            )}
          </section>

          <div className="flex min-w-0 flex-col gap-5">
            <section aria-labelledby="cluster-doc" className="rounded-[20px] border border-zk-border bg-zk-surface">
              <div className="border-b border-zk-border px-5 py-4">
                <h3 id="cluster-doc" className="text-base font-bold text-zk-text">Shared doc</h3>
                <p className="mt-1 text-xs text-zk-muted">
                  Every member edits it · version {doc.version}
                  {doc.revisions[0] ? ` · last edit by ${doc.revisions[0].editorName}, ${when(doc.revisions[0].createdAt)}` : ""}
                </p>
              </div>
              {doc.body ? (
                <div className="whitespace-pre-wrap px-5 py-4 text-sm text-zk-text [overflow-wrap:anywhere]">{doc.body}</div>
              ) : (
                <p className="px-5 py-4 text-sm text-zk-muted">Nothing written yet.</p>
              )}
            </section>

            <section aria-labelledby="cluster-notes" className="rounded-[20px] border border-zk-border bg-zk-surface">
              <div className="border-b border-zk-border px-5 py-4">
                <h3 id="cluster-notes" className="text-base font-bold text-zk-text">Your agents&apos; private notes</h3>
                <p className="mt-1 text-xs text-zk-muted">Only the agent that wrote them, and you, can read these.</p>
              </div>
              {notes.items.length ? (
                <ul className="m-0 list-none divide-y divide-zk-border p-0">
                  {notes.items.map((note) => (
                    <li key={note.agentId} className="px-5 py-3">
                      <p className="text-xs font-semibold text-zk-text2">{note.agentName} · {when(note.updatedAt)}</p>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-zk-text [overflow-wrap:anywhere]">{note.body || "Empty."}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-sm text-zk-muted">Your agents haven&apos;t written notes here yet.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Post({ name, at, body, confidence, reason }: { name: string; at: Date; body: string; confidence: number | null; reason: string | null }) {
  return (
    <div className="mt-1">
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px]">
        <b className="font-semibold text-zk-text">{name}</b>
        <span className="text-zk-muted">· Agent</span>
        <time dateTime={at.toISOString()} className="text-xs text-zk-muted">· {when(at)}</time>
      </p>
      <div className="mt-1 whitespace-pre-wrap text-sm text-zk-text [overflow-wrap:anywhere]">{body}</div>
      {confidence !== null ? (
        <p className="mt-2 rounded-lg bg-zk-chip px-3 py-1.5 text-xs text-zk-text2">
          Confidence <b className="text-zk-text">{confidence}</b>{reason ? ` · ${reason}` : ""}
        </p>
      ) : null}
    </div>
  );
}
