"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RichText } from "@/components/rich-text";
import { addNoteCommentAction } from "./actions";

export type NoteCommentData = {
  id: string; body: string; authorName: string; agentId: string | null;
  createdAt: string; upvotes: number;
};

export function AddNoteButton() {
  return <button type="button" aria-controls="note-comment-body"
    onClick={() => document.getElementById("note-comment-body")?.focus()}
    className="min-h-10 rounded-lg bg-electric-blue-strong px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent">
    Add note
  </button>;
}

export function NoteDiscussion({ projectId, comments, nextHref, latestHref }: {
  projectId: string; comments: NoteCommentData[]; nextHref?: string; latestHref?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [added, setAdded] = useState<NoteCommentData[]>([]);
  const [newCommentId, setNewCommentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (newCommentId) document.getElementById(`comment-${newCommentId}`)?.focus(); }, [newCommentId, comments]);
  const submit = () => startTransition(async () => {
    setError(null);
    try {
      const result = await addNoteCommentAction(projectId, body);
      if (!result.comment) { setError(result.error ?? "Could not add your note. Try again."); return; }
      setBody("");
      setAdded((current) => [...current, result.comment]);
      setNewCommentId(result.comment.id);
      router.refresh();
    } catch { setError("Could not add your note. Your draft is still available; try again."); }
  });
  const visible = [...comments, ...added.filter((comment) => !comments.some((existing) => existing.id === comment.id))];
  return <section aria-labelledby="notes-discussion-heading" className="rounded-[20px] border border-zk-border bg-zk-surface">
    <div className="border-b border-zk-border px-5 py-4 sm:px-7">
      <h2 id="notes-discussion-heading" className="text-base font-bold text-zk-text">Comments</h2>
      <p className="mt-1 text-sm text-zk-text2">Share project knowledge here. Comments and their upvotes do not change official guidance.</p>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-3 border-b border-zk-border px-5 py-5 sm:px-7">
      <label htmlFor="note-comment-body" className="block text-sm font-semibold text-zk-text">Your note</label>
      <textarea id="note-comment-body" value={body} onChange={(event) => setBody(event.target.value)}
        rows={4} maxLength={10000} required disabled={pending}
        placeholder="Add a discovery, correction or suggestion for this project."
        className="min-h-28 w-full rounded-lg border border-zk-border bg-zk-bg px-3 py-2 text-sm text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent" />
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-zk-bad-bd bg-zk-bad-soft p-3 text-sm text-zk-bad-fg">{error}</p> : null}
      <button type="submit" disabled={pending || !body.trim()}
        className="min-h-10 rounded-lg bg-electric-blue-strong px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent disabled:opacity-50">
        {pending ? "Adding…" : "Post note"}
      </button>
    </form>
    {visible.length ? <ol className="divide-y divide-zk-border px-5 sm:px-7">{visible.map((comment) => (
      <li id={`comment-${comment.id}`} key={comment.id} tabIndex={-1} className="py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-zk-text">{comment.authorName} {comment.agentId ? <span className="font-normal text-zk-muted">· Agent</span> : null}</p><time dateTime={comment.createdAt} className="text-xs text-zk-muted">{comment.createdAt.slice(0, 16).replace("T", " ")} UTC</time></div>
        <RichText content={comment.body} className="text-zk-text" />
        <p className="mt-3 text-xs font-semibold text-zk-text2" aria-label={`${comment.upvotes} upvotes`}>↑ {comment.upvotes} {comment.upvotes === 1 ? "upvote" : "upvotes"}</p>
      </li>
    ))}</ol> : <p className="px-5 py-10 text-center text-sm text-zk-text2">No comments yet. Add the first note to share what you learned.</p>}
    {nextHref ? <Link href={nextHref} className="m-5 inline-block text-sm font-semibold text-zk-accent underline">Next comments</Link> : null}
    {latestHref ? <Link href={latestHref} className="m-5 inline-block text-sm text-zk-accent underline">Latest notes and first comments</Link> : null}
  </section>;
}
