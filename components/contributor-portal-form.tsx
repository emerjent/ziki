"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { draftReportFromPrompt } from "@/lib/public-idea-draft";
import type { PublicIdeaMatch } from "@/lib/public-idea-intake";

type FormState = {
  error: string | null;
  fieldErrors: Record<string, string[]>;
  matches: PublicIdeaMatch[];
};

type SubmittedResult = {
  ideaNumber: number;
  trackingPath: string;
};

const EMPTY_STATE: FormState = { error: null, fieldErrors: {}, matches: [] };
const SCREENSHOT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

function createTrackingToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function ContributorPortalForm({
  orgSlug,
  projectSlug,
  projectName,
}: {
  orgSlug: string;
  projectSlug: string;
  projectName: string;
}) {
  const token = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [customSummary, setCustomSummary] = useState<string | null>(null);
  const [showDraftEditor, setShowDraftEditor] = useState(false);
  const [showMoreDetail, setShowMoreDetail] = useState(false);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [state, setState] = useState<FormState>(EMPTY_STATE);
  const [pending, setPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [acknowledgeSimilar, setAcknowledgeSimilar] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedResult | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const endpoint = `/api/public/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/ideas`;
  const drafted = useMemo(() => draftReportFromPrompt(prompt), [prompt]);
  const title = customTitle ?? drafted.title;
  const summary = customSummary ?? drafted.summary;

  useEffect(() => {
    const query = title.trim();
    if (query.length < 8) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await fetch(`${endpoint}?q=${encodeURIComponent(query.slice(0, 200))}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const body = (await result.json()) as { matches?: PublicIdeaMatch[] };
        if (result.ok) setState((current) => ({ ...current, matches: body.matches ?? [] }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState((current) => ({ ...current, matches: [] }));
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [endpoint, title]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState((current) => ({ ...current, error: null, fieldErrors: {} }));
    const raw = new FormData(event.currentTarget);
    token.current ??= createTrackingToken();

    const payload = new FormData();
    payload.set("prompt", prompt);
    payload.set("title", title);
    payload.set("summary", summary);
    payload.set("description", prompt);
    payload.set("stepsToReproduce", String(raw.get("stepsToReproduce") ?? ""));
    payload.set("expectedBehavior", String(raw.get("expectedBehavior") ?? ""));
    payload.set("actualBehavior", String(raw.get("actualBehavior") ?? ""));
    payload.set("website", String(raw.get("website") ?? ""));
    payload.set("acknowledgeSimilar", acknowledgeSimilar ? "true" : "false");
    payload.set("trackingToken", token.current);
    if (screenshot) {
      payload.set("screenshot", screenshot);
    }

    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: payload,
      });
      const body = (await result.json()) as {
        message?: string;
        fieldErrors?: Record<string, string[]>;
        matches?: PublicIdeaMatch[];
        trackingPath?: string;
        ideaNumber?: number;
      };
      if (result.ok && body.trackingPath && typeof body.ideaNumber === "number") {
        setSubmitted({ ideaNumber: body.ideaNumber, trackingPath: body.trackingPath });
        return;
      }
      if (result.status === 409 && body.matches?.length) {
        setAcknowledgeSimilar(true);
        setState({
          error: body.message ?? "Review the possible matches before submitting.",
          fieldErrors: {},
          matches: body.matches,
        });
        return;
      }
      setState({
        error: body.message ?? "The report could not be submitted.",
        fieldErrors: body.fieldErrors ?? {},
        matches: [],
      });
    } catch {
      setState({
        error: "The report could not be submitted. Check your connection and try again.",
        fieldErrors: {},
        matches: [],
      });
    } finally {
      setPending(false);
    }
  }

  function resetPortal() {
    token.current = null;
    setPrompt("");
    setCustomTitle(null);
    setCustomSummary(null);
    setShowDraftEditor(false);
    setShowMoreDetail(false);
    setScreenshot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setState(EMPTY_STATE);
    setAcknowledgeSimilar(false);
    setSubmitted(null);
    setCopiedLink(false);
  }

  if (submitted) {
    const absoluteUrl =
      typeof window !== "undefined" ? `${window.location.origin}${submitted.trackingPath}` : submitted.trackingPath;
    return (
      <div className="space-y-5">
        <div role="status" className="rounded-2xl border border-zk-ok-fg/30 bg-zk-ok-bg p-5">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-zk-ok-fg">Report received</p>
          <h2 className="mt-1 text-lg font-extrabold text-zk-text">
            Idea #{submitted.ideaNumber} sent to {projectName}
          </h2>
          <p className="mt-1 text-sm text-zk-text2">
            Save your private tracking link below to follow progress without signing in.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="portal-tracking-url" className="block text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
            Private tracking link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="portal-tracking-url" readOnly value={absoluteUrl} className="font-mono text-xs" />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(absoluteUrl);
                  setCopiedLink(true);
                } catch {
                  setCopiedLink(false);
                }
              }}
            >
              {copiedLink ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zk-border pt-4">
          <Link
            href={submitted.trackingPath}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zk-accent px-4 py-2 text-sm font-bold text-white hover:opacity-95"
          >
            View report status
          </Link>
          <Button type="button" variant="ghost" onClick={resetPortal}>
            Submit another report
          </Button>
        </div>
      </div>
    );
  }

  const fieldError = (field: string) => state.fieldErrors[field]?.[0];

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="portal-report-website">Website</label>
        <input id="portal-report-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor="portal-prompt" className="block text-sm font-bold text-zk-text">
          What went wrong, or what would you like?
        </label>
        <Textarea
          id="portal-prompt"
          name="prompt"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (event.target.value.trim().length < 8) setSearching(false);
            setAcknowledgeSimilar(false);
            setState((current) => ({ ...current, matches: [] }));
          }}
          rows={5}
          minLength={10}
          maxLength={2400}
          required
          placeholder="Describe what happened or what you'd like improved…"
          className="mt-2"
          aria-describedby={fieldError("prompt") || fieldError("description") ? "portal-prompt-error" : "portal-prompt-hint"}
        />
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-zk-muted">
          <span id="portal-prompt-hint">No account needed. Title and summary are drafted automatically.</span>
          <CharacterCounter length={prompt.length} max={2400} />
        </div>
        {fieldError("prompt") || fieldError("description") ? (
          <p id="portal-prompt-error" className="mt-1 text-xs text-zk-bad-fg">
            {fieldError("prompt") ?? fieldError("description")}
          </p>
        ) : null}
        {searching ? (
          <p role="status" className="mt-2 text-xs text-zk-muted">
            Checking for similar reports…
          </p>
        ) : null}
      </div>

      {prompt.trim().length >= 3 ? (
        <div className="rounded-xl border border-zk-border bg-zk-chip/50 p-3.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-zk-text2">
              Drafted title: <span className="text-zk-text">{title || "—"}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowDraftEditor((open) => !open)}
              className="shrink-0 font-semibold text-zk-accent hover:underline"
            >
              {showDraftEditor ? "Hide draft" : "Edit title & summary"}
            </button>
          </div>
          {showDraftEditor ? (
            <div className="mt-3 space-y-3 border-t border-zk-border pt-3">
              <div>
                <label htmlFor="portal-title" className="block text-xs font-semibold text-zk-text">
                  Title
                </label>
                <Input
                  id="portal-title"
                  name="title"
                  value={title}
                  onChange={(event) => {
                    setCustomTitle(event.target.value);
                    setAcknowledgeSimilar(false);
                    setState((current) => ({ ...current, matches: [] }));
                  }}
                  maxLength={200}
                  className="mt-1"
                />
                {fieldError("title") ? <p className="mt-1 text-xs text-zk-bad-fg">{fieldError("title")}</p> : null}
              </div>
              <div>
                <label htmlFor="portal-summary" className="block text-xs font-semibold text-zk-text">
                  Short summary
                </label>
                <Textarea
                  id="portal-summary"
                  name="summary"
                  value={summary}
                  onChange={(event) => setCustomSummary(event.target.value)}
                  rows={2}
                  maxLength={300}
                  className="mt-1"
                />
                {fieldError("summary") ? <p className="mt-1 text-xs text-zk-bad-fg">{fieldError("summary")}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.matches.length > 0 ? (
        <section aria-labelledby="portal-matches-heading" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 id="portal-matches-heading" className="text-sm font-bold text-zk-text">
            Is it one of these?
          </h2>
          <p className="mt-1 text-xs text-zk-text2">
            These reports already exist. Submit anyway only if yours is different.
          </p>
          <ul className="mt-3 space-y-2">
            {state.matches.map((match) => (
              <li
                key={`${match.kind}-${match.number}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-xs"
              >
                <span className="font-semibold text-zk-text">
                  {match.kind === "idea" ? "Idea" : "Issue"} #{match.number}: {match.title}
                </span>
                <span className="shrink-0 rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-medium text-zk-muted">
                  {match.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div>
        <label htmlFor="portal-screenshot" className="block text-xs font-semibold text-zk-text">
          Screenshot <span className="font-normal text-zk-muted">(optional)</span>
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            id="portal-screenshot"
            name="screenshot"
            type="file"
            accept={SCREENSHOT_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setScreenshot(file);
              setState((current) => ({
                ...current,
                fieldErrors: { ...current.fieldErrors, screenshot: [] },
              }));
            }}
            className="block w-full text-xs text-zk-text2 file:mr-3 file:rounded-lg file:border file:border-zk-border file:bg-zk-chip file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zk-text hover:file:bg-zk-surface sm:w-auto"
          />
          {screenshot ? (
            <button
              type="button"
              onClick={() => {
                setScreenshot(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="text-xs font-semibold text-zk-muted hover:text-zk-text"
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-zk-muted">PNG, JPG, GIF, or WebP up to 5 MB. Stored privately for the team.</p>
        {fieldError("screenshot") ? <p className="mt-1 text-xs text-zk-bad-fg">{fieldError("screenshot")}</p> : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowMoreDetail((open) => !open)}
          aria-expanded={showMoreDetail}
          className="text-xs font-semibold text-zk-accent hover:underline"
        >
          {showMoreDetail ? "Hide extra details" : "Add more detail"}
        </button>

        {showMoreDetail ? (
          <div className="mt-3 space-y-3 rounded-xl border border-zk-border bg-zk-chip/30 p-4">
            <div>
              <label htmlFor="portal-steps" className="block text-xs font-semibold text-zk-text">
                Steps to reproduce <span className="font-normal text-zk-muted">(optional)</span>
              </label>
              <Textarea id="portal-steps" name="stepsToReproduce" maxLength={1000} rows={3} placeholder="1. Open…&#10;2. Click…" className="mt-1" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-expected" className="block text-xs font-semibold text-zk-text">
                  Expected behaviour <span className="font-normal text-zk-muted">(optional)</span>
                </label>
                <Textarea id="portal-expected" name="expectedBehavior" maxLength={700} rows={3} placeholder="What should happen?" className="mt-1" />
              </div>
              <div>
                <label htmlFor="portal-actual" className="block text-xs font-semibold text-zk-text">
                  Actual behaviour <span className="font-normal text-zk-muted">(optional)</span>
                </label>
                <Textarea id="portal-actual" name="actualBehavior" maxLength={700} rows={3} placeholder="What happened instead?" className="mt-1" />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end border-t border-zk-border pt-4">
        <Button type="submit" variant="primary" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Submitting…" : acknowledgeSimilar ? "Submit as a different report" : "Submit report"}
        </Button>
      </div>
    </form>
  );
}
