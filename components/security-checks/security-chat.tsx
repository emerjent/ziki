"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { talkToSecurityAssistant } from "@/app/actions/security-assistant";
import { TARGET_KIND_LABEL } from "@/lib/security-checks";
import { ClaudeWorking } from "@/components/claude-working";
import { parseSecurityTarget, PRIVATE_TARGET_ERROR } from "@/lib/security-checks/target";
import type { AssistantTurn } from "@/lib/security-checks/assistant";
import type { PreviewSummary } from "@/lib/security-checks/preview-summary";
import { PreviewResult } from "./preview-result";
import { ScanProgress } from "./scan-progress";

const MESSAGE_MAX = 600;

/** What Ziki is doing while it answers, typed out like the Ideas chat. */
const WORKING_STEPS = [
  "Reading what you wrote…",
  "Working out what you want to secure…",
  "Checking it's a website, server or repo…",
  "Writing back…",
];

/**
 * The conversation, kept while the client moves around Security and back, so
 * nothing typed or said is lost. It lives only in this browser tab's memory:
 * a refresh starts afresh.
 */
const kept: { turns: ChatItem[]; text: string; started?: string } = { turns: [], text: "" };

/** A message in the chat; a reply can carry a quick scan of the site. */
type ChatItem = AssistantTurn & { scan?: { target: string; summary: PreviewSummary | null; note: string | null; checkId: string | null } };

/**
 * The box on Security, with Ziki's AI behind it (#security-checks, 14 Nov plan
 * C1 and C3). It looks like the Ideas box. Paste a link and its quick scan runs
 * here, then it's added to the person's scans; type anything else ("I want to
 * secure my shop's website") and the reply asks for what's missing. There is no
 * proof step, and the chat stays on the page after each answer.
 */
export function SecurityChat({
  id = "security-chat",
  focusOnOpen = false,
  startWith,
}: {
  id?: string;
  focusOnOpen?: boolean;
  /** An address brought from the public page after sign-up: sent once, so its quick scan starts on arrival. */
  startWith?: string;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<ChatItem[]>(() => kept.turns);
  const [text, setText] = useState(() => kept.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** A site was sent: think first, like the Ideas chat, then show the scan's progress. */
  const [thinking, setThinking] = useState(false);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
  }, []);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const value = text.trim();
  const parsed = value ? parseSecurityTarget(value) : null;
  const target = parsed?.ok ? parsed.target : null;
  const isPrivate = parsed !== null && !parsed.ok && parsed.error === PRIVATE_TARGET_ERROR;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (focusOnOpen) box.current?.focus();
  }, [focusOnOpen]);
  // Keep the conversation for when the client comes back to it.
  useEffect(() => {
    kept.turns = turns;
    kept.text = text;
  }, [turns, text]);
  // Keep the newest message in view.
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns, pending]);
  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function send() {
    sendText(value);
  }

  function sendText(raw: string) {
    const words = raw.trim();
    if (!words || pending) return;
    const next: ChatItem[] = [...turns, { role: "user", text: words.slice(0, MESSAGE_MAX) }];
    setTurns(next);
    setText("");
    setError(null);
    setThinking(true);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(() => setThinking(false), 2200);
    startTransition(async () => {
      try {
        // Only the words go to the server, never a scan card.
        const answer = await talkToSecurityAssistant(next.map(({ role, text }) => ({ role, text })));
        if (answer.kind === "error") {
          setError(answer.error);
          return;
        }
        if (answer.kind === "scan") {
          setTurns([...next, { role: "assistant", text: answer.reply, scan: { target: answer.target, summary: answer.summary, note: answer.note, checkId: answer.checkId } }]);
          // Added to the person's scans: the list below picks it up.
          if (answer.checkId) router.refresh();
          return;
        }
        if (answer.kind === "go") {
          kept.turns = [];
          kept.text = "";
          router.push(answer.href);
          return;
        }
        setTurns([...next, { role: "assistant", text: answer.reply }]);
      } catch {
        setError("Ziki couldn't answer just now. Try again.");
      }
    });
  }

  // Brought an address from the public page: send it once, as if typed. Kept in
  // memory, so it isn't sent again when the page swaps the empty box for the list.
  useEffect(() => {
    if (!startWith || kept.started === startWith) return;
    kept.started = startWith;
    sendText(startWith);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
  const lastTarget = lastUser ? parseSecurityTarget(lastUser) : null;
  // Only while the answer is still coming: not while the list below refreshes after it.
  const waiting = pending && turns.at(-1)?.role === "user";
  const scanning = waiting && !thinking && lastTarget?.ok === true;

  return (
    <div className="flex flex-col gap-3">
      {turns.length ? (
        <ol ref={log} aria-label="Conversation with Ziki" aria-live="polite" className="m-0 flex list-none flex-col gap-2.5 p-0">
          {turns.map((turn, index) => (
            <li key={index} className={turn.role === "user" ? "ml-auto max-w-[85%]" : `mr-auto flex flex-col gap-2 ${turn.scan ? "w-full" : "max-w-[90%]"}`}>
              {turn.role === "user" ? (
                <p className="m-0 whitespace-pre-wrap break-words rounded-[18px] rounded-br-md bg-electric-blue-strong px-4 py-2 text-[15px] text-white">
                  <span className="sr-only">You: </span>
                  {turn.text}
                </p>
              ) : (
                <>
                  {turn.text ? (
                    <p className="m-0 w-fit whitespace-pre-wrap break-words rounded-[18px] rounded-tl-md border border-zk-border bg-zk-surface px-4 py-2 text-[15px] text-zk-text2">
                      <span className="sr-only">Reply: </span>
                      {turn.text}
                    </p>
                  ) : null}
                  {turn.scan ? <ScanCard scan={turn.scan} /> : null}
                </>
              )}
            </li>
          ))}
          {waiting ? (
            // The same "Claude is working" lines as the Ideas chat, for this job.
            <li className="mr-auto w-full max-w-[90%]">
              {scanning && lastTarget?.ok ? (
                <ScanProgress site={lastTarget.target.value} />
              ) : (
                <ClaudeWorking steps={WORKING_STEPS} statusText="Ziki is reading your message." />
              )}
            </li>
          ) : null}
        </ol>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        noValidate
      >
        <div className="rounded-[22px] border border-zk-border bg-zk-surface px-4 pb-2.5 pt-3 shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:border-electric-blue-strong/50">
          <label htmlFor={id} className="sr-only">What do you want to secure?</label>
          <textarea
            id={id}
            ref={box}
            name="target"
            rows={1}
            value={text}
            disabled={pending}
            maxLength={MESSAGE_MAX}
            placeholder={turns.length ? "Reply to Ziki" : "Tell Ziki what you want to secure"}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : `${id}-reading`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            className="block min-h-[28px] w-full resize-none border-0 bg-transparent p-1 text-[15px] leading-6 text-zk-text placeholder:text-zk-muted focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p id={`${id}-reading`} aria-live="polite" className="m-0 min-w-0 truncate px-1 text-[13px] text-zk-muted">
              {target ? (
                <span className="inline-flex items-center gap-1.5 text-zk-ok-fg">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {TARGET_KIND_LABEL[target.kind]}: <span className="font-semibold">{target.value}</span>
                </span>
              ) : isPrivate ? (
                <span className="text-zk-bad-fg">That&apos;s a private address</span>
              ) : null}
            </p>
            <button
              type="submit"
              disabled={pending || !value}
              aria-label="Send"
              title="Send"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zk-text text-zk-surface transition disabled:opacity-30"
            >
              {pending ? (
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              )}
            </button>
          </div>
        </div>
        {error ? <p id={errorId} role="alert" className="m-0 mt-2 px-2 text-sm text-zk-bad-fg">{error}</p> : null}
      </form>
    </div>
  );
}

/** The quick scan in the chat: its locked rows, and that it's now in the person's scans with agents checking it. */
function ScanCard({ scan }: { scan: NonNullable<ChatItem["scan"]> }) {
  const added = scan.checkId ? (
    <p className="m-0 border-t border-zk-divider pt-3 text-[13px] leading-snug text-zk-muted">
      Added to your scans below. Agents are checking it properly now; its report will be on its card.
    </p>
  ) : null;
  if (scan.summary) return <PreviewResult summary={scan.summary}>{added}</PreviewResult>;
  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface p-4 text-left">
      <p className="m-0 text-sm leading-relaxed text-zk-text2">{scan.note ?? "The quick scan couldn't run just now."}</p>
      {added}
    </div>
  );
}
