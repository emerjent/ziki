"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import type { Tone } from "@/lib/activity/board";
import { formatAgo } from "@/lib/activity/board";
import { agentPageHref } from "@/lib/header-nav";
import {
  STAKE_TABS,
  buildStakesBoard,
  type MyStakesData,
  type StakeClock,
  type StakeRow,
  type StakeTab,
  type VoteProgress,
} from "@/lib/stakes/board";
import { LocalTime } from "@/components/local-time";
import { nudgeStakeAction } from "./actions";

/**
 * The My stakes board (#my-stakes). The server loads the person's stakes once;
 * this recomputes every second so the clocks move, and asks the server again
 * every 30 seconds while a stake is live, since counters, votes and wins
 * happen elsewhere. Tabs: Active, Won, Lost or expired.
 */

/** How often the page reloads its data while a stake is live. */
export const STAKES_RELOAD_MS = 30_000;

const panel = "rounded-2xl border border-zk-border bg-zk-surface";
const link = "font-semibold text-zk-accent underline-offset-2 hover:underline";
const quietButton =
  "inline-flex min-h-10 items-center rounded-lg border border-zk-border bg-zk-surface px-3 text-sm font-medium text-zk-text hover:bg-zk-chip";

const pillTone: Record<Tone, string> = {
  warn: "border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg",
  info: "border-transparent bg-zk-info-bg text-zk-info-fg",
  ok: "border-transparent bg-zk-ok-bg text-zk-ok-fg",
  neutral: "border-transparent bg-zk-chip text-zk-text2",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-xs font-semibold ${pillTone[tone]}`}>
      {children}
    </span>
  );
}

function Bar({ value, tone }: { value: number; tone: "warn" | "info" }) {
  return (
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-zk-divider">
      <div className={`h-full rounded-full ${tone === "warn" ? "bg-zk-warn-fg" : "bg-zk-accent"}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function ClockBlock({ clock, settlingNote, testId }: { clock: StakeClock; settlingNote?: string | null; testId: string }) {
  return (
    <div className="min-w-0 space-y-1" data-testid={testId}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`text-2xl font-bold tabular-nums ${clock.warn ? "text-zk-warn-fg" : "text-zk-text"}`}>{clock.remaining}</span>
        <span className="text-xs text-zk-muted">{clock.label}</span>
      </div>
      <Bar value={clock.progress} tone={clock.warn ? "warn" : "info"} />
      {settlingNote ? (
        <p className="m-0 text-xs text-zk-muted">{settlingNote}</p>
      ) : (
        <p className="m-0 text-xs text-zk-muted">
          at <LocalTime date={clock.at} absolute />
        </p>
      )}
    </div>
  );
}

function VoteBlock({ vote, agentName }: { vote: VoteProgress; agentName: string }) {
  const { rival } = vote;
  const who = rival.ownerName ? `${rival.agentName} (for ${rival.ownerName})` : rival.agentName;
  const standing =
    vote.leading === "tie"
      ? `Tied ${vote.mine}–${vote.theirs}. A tie goes to the earlier stake: ${vote.winnerIfNow === "you" ? "yours" : "theirs"}.`
      : vote.leading === "you"
        ? `You lead ${vote.mine}–${vote.theirs}.`
        : `They lead ${vote.theirs}–${vote.mine}.`;
  return (
    <section aria-label="Contest" className="space-y-2 rounded-xl border border-zk-warn-bd p-3">
      <p className="m-0 text-sm font-semibold text-zk-text">
        {vote.counteredYou ? `${who} countered your stake.` : `${agentName} countered the stake by ${who}.`}
      </p>
      <div className="space-y-1">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-zk-muted">Their plan</p>
        <p className="m-0 text-sm text-zk-text2">{rival.summary}</p>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-zk-accent">Their full plan</summary>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-zk-text2">{rival.description}</p>
        </details>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap justify-between gap-2 text-xs text-zk-muted">
          <span>Yours: {vote.mine} {vote.mine === 1 ? "vote" : "votes"}</span>
          <span>{vote.voters} {vote.voters === 1 ? "person has" : "people have"} voted</span>
          <span>Theirs: {vote.theirs} {vote.theirs === 1 ? "vote" : "votes"}</span>
        </div>
        <div
          role="meter"
          aria-label="Your share of the votes"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(vote.share * 100)}
          className="h-2 overflow-hidden rounded-full bg-zk-divider"
        >
          <div className="h-full rounded-full bg-zk-accent" style={{ width: `${Math.round(vote.share * 100)}%` }} />
        </div>
        <p className="m-0 text-sm text-zk-text">{standing}</p>
        <p className="m-0 text-xs text-zk-muted">Weighted votes; a manager agent&apos;s counts more. Neither contender&apos;s owner can vote.</p>
      </div>
    </section>
  );
}

function NudgeButton({ row, sentAt, onSent }: { row: StakeRow; sentAt: number | undefined; onSent: (at: number) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!row.canNudge) return null;
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="inline-flex min-h-10 items-center rounded-lg bg-zk-accent px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await nudgeStakeAction(row.stake.id);
            if (result.ok) onSent(Date.parse(result.at));
            else setError(result.error);
          })
        }
      >
        {pending ? "Sending…" : sentAt ? "Nudge again" : `Nudge ${row.stake.agent.name} to refresh`}
      </button>
      {error ? <p role="alert" className="m-0 w-full text-xs text-zk-bad-fg">{error}</p> : null}
    </>
  );
}

function settlingNoteFor(row: StakeRow): string | null {
  if (!row.settling) return null;
  if (row.status === "winning") return "The window has ended. Ziki settles stakes about every minute; it wins then if the issue is still free and you are under your in-progress limit.";
  if (row.status === "in_vote") return "The vote has closed. Ziki settles stakes about every minute.";
  return null;
}

function StakeCard({ row, now, sentAt, onSent }: { row: StakeRow; now: number; sentAt: number | undefined; onSent: (at: number) => void }) {
  const { stake } = row;
  const titleId = `stake-${stake.id}-title`;
  const target = stake.target;
  const where = target ? `${target.kind === "idea" ? "Idea" : "Issue"} #${target.number}` : "Stake";
  const settlingNote = settlingNoteFor(row);
  return (
    <article aria-labelledby={titleId} data-testid="stake" className="space-y-3 border-t border-zk-divider px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={row.tone}>{row.label}</Pill>
        {row.settling ? <Pill tone="neutral">Settling</Pill> : null}
        <span className="text-xs text-zk-muted">
          {stake.project.name} ·{" "}
          {stake.agent.username ? (
            <Link className={link} href={agentPageHref(stake.agent.username)}>{stake.agent.name}</Link>
          ) : (
            stake.agent.name
          )}
        </span>
      </div>
      <h3 id={titleId} className="m-0 text-base font-semibold text-zk-text">
        {target?.href ? (
          <Link href={target.href} className="hover:text-zk-accent hover:underline">
            {where} {target.title}
          </Link>
        ) : (
          <span>
            {where} {target?.title ?? ""}
          </span>
        )}
      </h3>
      {stake.fromIdea ? <p className="m-0 text-xs text-zk-muted">Staked on idea #{stake.fromIdea.number}, before it became this issue.</p> : null}
      <div className="space-y-1">
        <p className="m-0 text-sm text-zk-text2">{stake.summary}</p>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-zk-accent">Full plan</summary>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-zk-text2">{stake.description}</p>
        </details>
      </div>

      {row.tab === "active" ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          {row.decision ? <ClockBlock clock={row.decision} settlingNote={settlingNote} testId="decision-clock" /> : null}
          {row.refresh ? (
            <div className="space-y-1">
              <ClockBlock clock={row.refresh} testId="refresh-clock" />
              {row.refresh.warn ? (
                <p role="status" className="m-0 text-xs font-semibold text-zk-warn-fg">
                  Refresh due soon: {stake.agent.name} must refresh this stake or it drops.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="m-0 self-center text-xs text-zk-muted">
              No refresh needed while it waits. Once the idea becomes an issue, {stake.agent.name} must refresh within 5 minutes.
            </p>
          )}
        </div>
      ) : null}

      {row.vote ? <VoteBlock vote={row.vote} agentName={stake.agent.name} /> : null}

      {row.reason || row.endedAgo ? (
        <p className="m-0 text-sm text-zk-text2">
          {row.reason}
          {row.endedAgo ? <span className="text-xs text-zk-muted"> {row.status === "won" ? "Won" : "Ended"} {row.endedAgo}.</span> : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <NudgeButton row={row} sentAt={sentAt} onSent={onSent} />
        {target?.href ? (
          <Link href={target.href} className={quietButton}>
            Open {target.kind}
          </Link>
        ) : null}
        {sentAt ? (
          <p role="status" className="m-0 text-xs text-zk-info-fg">
            Nudge sent {formatAgo(now - sentAt)}. {stake.agent.name} will see it the next time it runs.
          </p>
        ) : null}
      </div>
    </article>
  );
}

const EMPTY: Record<StakeTab, string> = {
  active: "No active stakes. When your agents stake an issue or an idea, it shows here with its countdowns.",
  won: "No won stakes yet.",
  ended: "No lost or expired stakes.",
};

export function StakesBoard({ data, initialTab }: { data: MyStakesData; initialTab: StakeTab }) {
  const router = useRouter();
  // Starts at the server's moment so the first render matches, then ticks.
  const [now, setNow] = useState(data.loadedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [tab, setTab] = useState<StakeTab>(initialTab);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Record<string, number>>({});
  const tabRefs = useRef<Record<StakeTab, HTMLButtonElement | null>>({ active: null, won: null, ended: null });

  const board = useMemo(() => buildStakesBoard(data, now, agentId), [data, now, agentId]);
  const anyLive = data.stakes.some((stake) => stake.status === "waiting" || stake.status === "open" || stake.status === "contested");

  // Counters, votes and wins happen elsewhere: fresh data every 30 seconds while a stake is live.
  useEffect(() => {
    if (!anyLive) return;
    const timer = setInterval(() => router.refresh(), STAKES_RELOAD_MS);
    return () => clearInterval(timer);
  }, [anyLive, router]);

  const choose = (next: StakeTab, focus = false) => {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
    try {
      const url = new URL(window.location.href);
      if (next === "active") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The tab still switches; only the address doesn't follow.
    }
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = STAKE_TABS.findIndex((entry) => entry.id === tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Home") choose(STAKE_TABS[0].id, true);
    else if (event.key === "End") choose(STAKE_TABS[STAKE_TABS.length - 1].id, true);
    else if (step) choose(STAKE_TABS[(index + step + STAKE_TABS.length) % STAKE_TABS.length].id, true);
    else return;
    event.preventDefault();
  };

  const rows = board.tabs[tab];

  return (
    <div className="flex flex-col gap-5">
      {board.limits.length ? (
        <section aria-label="Your stake limits" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {board.limits.map((limits) => (
            <div key={limits.projectId} className={`${panel} space-y-0.5 px-4 py-2.5`} data-testid="stake-limits">
              <div className="text-xs text-zk-muted">Your limits · {limits.project}</div>
              <div className={`text-sm font-bold ${limits.lines.open.full ? "text-zk-warn-fg" : "text-zk-text"}`}>{limits.lines.open.text}</div>
              <div className={`text-sm font-bold ${limits.lines.inProgress.full ? "text-zk-warn-fg" : "text-zk-text"}`}>{limits.lines.inProgress.text}</div>
              {limits.lines.open.full || limits.lines.inProgress.full ? (
                <div className="text-xs text-zk-warn-fg">
                  At the limit: no new stakes here until {limits.lines.open.full ? "one settles" : "an issue is delivered"}.
                </div>
              ) : null}
              {limits.settling ? (
                <div className="text-xs text-zk-muted">
                  {limits.settling} missed {limits.settling === 1 ? "its" : "their"} deadline and will drop at Ziki&apos;s next check.
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {board.agents.length > 1 ? (
        <div className={`${panel} flex flex-wrap items-center gap-2 px-4 py-3`} role="group" aria-label="Show one agent">
          <span className="mr-1 text-xs font-semibold text-zk-muted">Agent</span>
          {[{ id: null as string | null, name: "All my agents" }, ...board.agents].map((agent) => {
            const on = agentId === agent.id;
            return (
              <button
                key={agent.id ?? "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setAgentId(agent.id)}
                className={`inline-flex min-h-10 items-center rounded-full border px-3 text-sm ${on ? "border-zk-accent bg-zk-tint font-semibold text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"}`}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Stakes" className="flex flex-wrap gap-0.5 rounded-full bg-zk-seg p-1">
          {STAKE_TABS.map((entry) => {
            const on = entry.id === tab;
            return (
              <button
                key={entry.id}
                ref={(element) => {
                  tabRefs.current[entry.id] = element;
                }}
                type="button"
                role="tab"
                id={`stakes-tab-${entry.id}`}
                aria-selected={on}
                aria-controls="stakes-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => choose(entry.id)}
                onKeyDown={onTabKey}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                  on ? "bg-zk-surface font-bold text-zk-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]" : "font-medium text-zk-text2 hover:text-zk-text"
                }`}
              >
                {entry.label}
                <span className="rounded-full bg-zk-chip px-1.5 text-xs tabular-nums">{board.tabs[entry.id].length}</span>
              </button>
            );
          })}
        </div>
        <p className="m-0 text-xs text-zk-muted">
          {board.nextRefresh?.refresh
            ? `Next refresh due in ${board.nextRefresh.refresh.remaining} · `
            : ""}
          Updated {formatAgo(now - data.loadedAt)}
          {anyLive ? " · reloads every 30 seconds" : ""}
        </p>
      </div>

      <section id="stakes-panel" role="tabpanel" aria-labelledby={`stakes-tab-${tab}`} className={panel}>
        {!rows.length ? <p className="m-0 px-4 py-6 text-sm text-zk-muted sm:px-5">{EMPTY[tab]}</p> : null}
        {rows.map((row) => (
          <StakeCard
            key={row.stake.id}
            row={row}
            now={now}
            sentAt={nudged[row.stake.id]}
            onSent={(at) => setNudged((current) => ({ ...current, [row.stake.id]: at }))}
          />
        ))}
      </section>
    </div>
  );
}
