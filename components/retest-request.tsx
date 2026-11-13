"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { requestRetestAction } from "@/app/actions/issues";
import { AttachmentPicker } from "@/components/attachment-picker";

const operatingSystems = ["Windows", "macOS", "Linux", "ChromeOS", "iOS", "Android", "Other", "Not sure"];

export function RetestRequest({ bugId, issueHref, issueLabel }: { bugId: string; issueHref: string; issueLabel: string }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [operatingSystem, setOperatingSystem] = useState("");
  const [installedVersion, setInstalledVersion] = useState("");
  const [currentBehavior, setCurrentBehavior] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestUrl, setRequestUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      detailsRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function closeDialog() {
    if (pending) return;
    setOpen(false);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operatingSystem) {
      setError("Choose an operating system, or select Not sure.");
      return;
    }
    if (currentBehavior.trim().length < 10) {
      setError("Describe what happens now in at least 10 characters.");
      detailsRef.current?.focus();
      return;
    }
    if (uploading) {
      setError("Wait for your files to finish uploading before sending.");
      return;
    }

    setError(null);
    const data = new FormData();
    data.set("operatingSystem", operatingSystem);
    data.set("installedVersion", installedVersion);
    data.set("currentBehavior", currentBehavior);
    data.set("attachmentIds", attachmentIds.join(","));
    startTransition(async () => {
      try {
        const result = await requestRetestAction(bugId, data);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (!result.commentId) {
          setError("We couldn't confirm that your request was saved. Your details are still here; try again.");
          return;
        }
        setRequestUrl(`${issueHref}#comment-${encodeURIComponent(result.commentId)}`);
        setOpen(false);
      } catch {
        setError("We couldn't save your request. Check your connection and try again; your details are still here.");
      }
    });
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-chip/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-zk-text">Still not working for you?</h2>
          <p className="mt-1 text-sm text-zk-text2">Keep the original report and add what has changed.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
        >
          Still having this problem?
        </button>
      </section>

      {requestUrl ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zk-border bg-zk-surface px-4 py-3 text-sm">
          <p className="m-0 text-zk-text"><span className="font-semibold text-zk-ok-fg">Retest requested</span><span className="mx-2 text-zk-muted" aria-hidden="true">|</span>Linked to {issueLabel}</p>
          <Link href={requestUrl} className="font-semibold text-zk-accent underline underline-offset-2">View request</Link>
          <p className="m-0 w-full text-xs text-zk-muted">Your original issue stays Live. This request does not reopen it.</p>
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        className="fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-none w-full max-w-xl border-0 border-l border-zk-border bg-zk-surface p-0 text-zk-text shadow-2xl backdrop:bg-black/30"
      >
        <form onSubmit={submit} className="flex h-full flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight">Still having this problem?</h2>
                <p className="mt-1 text-sm text-zk-text2">{issueLabel}</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={pending} aria-label="Close retest request" className="rounded-md p-1 text-xl leading-none text-zk-muted hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong disabled:opacity-50">×</button>
            </header>

            <p id={`${id}-description`} className="m-0 text-sm leading-6 text-zk-text2">Tell us what happens now. Your original report and fix history will stay attached.</p>

            <section aria-labelledby={`${id}-setup`} className="space-y-3 border-y border-zk-border py-5">
              <h3 id={`${id}-setup`} className="text-base font-semibold">Your setup</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor={`${id}-os`} className="text-sm font-semibold">Operating system</label>
                  <select id={`${id}-os`} value={operatingSystem} onChange={(event) => setOperatingSystem(event.target.value)} required disabled={pending} className="min-h-10 w-full rounded-lg border border-zk-border bg-zk-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong">
                    <option value="">Choose one</option>
                    {operatingSystems.map((system) => <option key={system} value={system}>{system}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`${id}-version`} className="text-sm font-semibold">Installed app version</label>
                  <input id={`${id}-version`} value={installedVersion} onChange={(event) => setInstalledVersion(event.target.value)} maxLength={80} disabled={pending} placeholder="Optional" className="min-h-10 w-full rounded-lg border border-zk-border bg-zk-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong" />
                </div>
              </div>
              <p className="m-0 text-sm text-zk-muted">You can leave the version blank if you&apos;re not sure.</p>
              <p className="m-0 text-sm text-zk-text2">Release details aren&apos;t linked to this issue yet, so we can&apos;t compare versions or provide an update link.</p>
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold">What happens now?</h3>
              <label htmlFor={`${id}-behavior`} className="sr-only">Describe what happens now</label>
              <textarea ref={detailsRef} id={`${id}-behavior`} value={currentBehavior} onChange={(event) => setCurrentBehavior(event.target.value)} maxLength={4000} rows={5} required disabled={pending} placeholder="What do you see? What did you try?" className="w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2.5 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong" />
              <AttachmentPicker onChange={setAttachmentIds} onUploadingChange={setUploading} disabled={pending} />
              <p className="m-0 text-xs text-zk-muted">Attachments are optional. Check files for private information before sharing.</p>
            </section>

            {error ? <p role="alert" className="m-0 rounded-lg border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">{error}</p> : null}
          </div>

          <footer className="flex flex-col gap-3 border-t border-zk-border bg-zk-surface px-5 py-4 sm:px-7">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={closeDialog} disabled={pending} className="min-h-10 rounded-lg border border-zk-border px-4 text-sm font-semibold hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={pending || uploading} className="min-h-10 rounded-lg bg-zk-accent px-5 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Sending…" : uploading ? "Uploading…" : "Request a retest"}</button>
            </div>
            <p className="m-0 text-xs text-zk-muted">This sends a request for review. It won&apos;t reopen the issue or change its work or payout.</p>
          </footer>
        </form>
      </dialog>
    </>
  );
}
