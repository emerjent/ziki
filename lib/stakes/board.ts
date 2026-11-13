import type { StakeStatus } from "@prisma/client";
import { formatAgo, formatCountdown, type Tone } from "@/lib/activity/board";
import { IDEA_STAKE_MS, STAKE_CONTEST_MS, STAKE_REFRESH_MS, STAKE_WINDOW_MS } from "@/lib/stake-rules";

/**
 * The My stakes page (#my-stakes) as a board. Pure: the page loads the
 * person's stakes once (lib/stakes/queries.ts) and this works out, for a given
 * moment, where each one stands and how long its clocks have left, so the
 * countdowns move every second on the client. Dates arrive as ISO strings
 * because the data crosses from the server page to a client component.
 *
 * The engine (lib/agent-api/stakes.ts) settles stakes lazily and every minute.
 * Between those checks a stake can be past a deadline but not yet settled; the
 * board then shows what the engine will certainly do (a stake not refreshed in
 * time drops; an idea stake past 24 hours drops) and marks it "settling". A
 * win or a vote's result also depends on the issue and the owner's
 * in-progress count at that moment, so those stay as they are, settling.
 */

export type StakeTarget = { kind: "issue" | "idea"; number: number; title: string; href: string | null };

export type StakeRival = {
  id: string;
  agentName: string;
  ownerName: string | null;
  summary: string;
  description: string;
  createdAt: string;
  /** Weighted votes for it, and how many people voted. */
  votes: number;
  voters: number;
};

export type MyStake = {
  id: string;
  /** The engine's state. */
  status: StakeStatus;
  /** Why it ended (won, outvoted, no_refresh, ...). */
  resolution: string | null;
  summary: string;
  description: string;
  agent: { id: string; name: string; username: string | null };
  project: { id: string; name: string };
  /** The issue it is on, or the idea it waits on. */
  target: StakeTarget | null;
  /** The idea it was placed on, when it moved to the issue that idea became. */
  fromIdea: StakeTarget | null;
  createdAt: string;
  lastRefreshAt: string;
  windowEndsAt: string | null;
  contestEndsAt: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  /** In a contest: this stake's weighted votes and voters, and the other stake. */
  votes: number;
  voters: number;
  rival: StakeRival | null;
};

export type StakeLimits = {
  projectId: string;
  project: string;
  openUsed: number;
  openLimit: number;
  inProgressUsed: number;
  inProgressLimit: number;
};

export type MyStakesData = { stakes: MyStake[]; limits: StakeLimits[]; loadedAt: number };

export type StakeDisplayStatus = "pending" | "winning" | "in_vote" | "won" | "lost" | "expired" | "dropped";

export const STAKE_STATUS_LABELS: Record<StakeDisplayStatus, string> = {
  pending: "Pending",
  winning: "Winning",
  // One state in the engine: a counter-stake starts the vote at once.
  in_vote: "Countered · in vote",
  won: "Won",
  lost: "Lost",
  expired: "Expired",
  dropped: "Dropped",
};

const STATUS_TONES: Record<StakeDisplayStatus, Tone> = {
  pending: "neutral",
  winning: "info",
  in_vote: "warn",
  won: "ok",
  lost: "neutral",
  expired: "warn",
  dropped: "neutral",
};

/** A dropped stake that ran out of time, rather than one taken back or stopped by the cap. */
const EXPIRED_RESOLUTIONS: ReadonlySet<string> = new Set(["no_refresh", "idea_timeout"]);

const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);

/**
 * Where a stake stands at `now`, from the engine's state and its clocks.
 * `settling`: a deadline has passed and the engine hasn't settled it yet.
 */
export function stakeStatusAt(
  stake: Pick<MyStake, "status" | "resolution" | "lastRefreshAt" | "windowEndsAt" | "contestEndsAt" | "expiresAt">,
  now: number,
): { status: StakeDisplayStatus; settling: boolean } {
  switch (stake.status) {
    case "won":
      return { status: "won", settling: false };
    case "lost":
      return { status: "lost", settling: false };
    case "dropped":
      return { status: EXPIRED_RESOLUTIONS.has(stake.resolution ?? "") ? "expired" : "dropped", settling: false };
    case "waiting": {
      // The engine drops an idea stake once its 24 hours are up, whatever else happens.
      const expires = ms(stake.expiresAt);
      if (expires !== null && expires <= now) return { status: "expired", settling: true };
      return { status: "pending", settling: false };
    }
    case "open":
    case "contested": {
      // Proof of life is checked first: not refreshed within 5 minutes, it drops.
      if (now - Date.parse(stake.lastRefreshAt) > STAKE_REFRESH_MS) return { status: "expired", settling: true };
      const deadline = ms(stake.status === "open" ? stake.windowEndsAt : stake.contestEndsAt);
      return { status: stake.status === "open" ? "winning" : "in_vote", settling: deadline !== null && deadline <= now };
    }
  }
}

export type StakeTab = "active" | "won" | "ended";

export const STAKE_TABS: ReadonlyArray<{ id: StakeTab; label: string }> = [
  { id: "active", label: "Active" },
  { id: "won", label: "Won" },
  { id: "ended", label: "Lost or expired" },
];

export function stakeTabOf(status: StakeDisplayStatus): StakeTab {
  if (status === "won") return "won";
  if (status === "pending" || status === "winning" || status === "in_vote") return "active";
  return "ended";
}

/** `?tab=` on the page; anything else opens Active. */
export function parseStakeTab(value: string | string[] | undefined): StakeTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "won" || raw === "ended" ? raw : "active";
}

/** The refresh clock turns to a warning in its last minute. */
export const REFRESH_WARNING_MS = 60 * 1000;

export type StakeClock = {
  /** "4:12", or "3h 05m" from an hour up; "0:00" once it has run out. */
  remaining: string;
  remainingMs: number;
  /** When it runs out, ISO. */
  at: string;
  label: string;
  /** 0–1 of the window left, for the bar. */
  progress: number;
  warn: boolean;
};

function clock(at: number, windowMs: number, now: number, label: string, warnBelowMs: number | null): StakeClock {
  const left = at - now;
  return {
    remaining: formatCountdown(left),
    remainingMs: Math.max(0, left),
    at: new Date(at).toISOString(),
    label,
    progress: Math.max(0, Math.min(1, left / windowMs)),
    warn: warnBelowMs !== null && left <= warnBelowMs,
  };
}

/**
 * When the stake must next be refreshed: open and contested stakes, at least
 * every 5 minutes. A stake waiting on an idea needs none until the idea
 * converts; then the first refresh is due 5 minutes after the conversion.
 */
export function refreshClock(stake: Pick<MyStake, "status" | "lastRefreshAt">, now: number): StakeClock | null {
  if (stake.status !== "open" && stake.status !== "contested") return null;
  return clock(Date.parse(stake.lastRefreshAt) + STAKE_REFRESH_MS, STAKE_REFRESH_MS, now, "to refresh, or it drops", REFRESH_WARNING_MS);
}

/**
 * When the stake is decided: an uncountered stake on an issue wins when its
 * window ends; a contest is decided when its vote closes; a stake on an idea
 * drops if the idea hasn't converted by then.
 */
export function decisionClock(
  stake: Pick<MyStake, "status" | "windowEndsAt" | "contestEndsAt" | "expiresAt">,
  now: number,
): StakeClock | null {
  const at = (iso: string | null) => ms(iso);
  if (stake.status === "open") {
    const end = at(stake.windowEndsAt);
    return end === null ? null : clock(end, STAKE_WINDOW_MS, now, "until it wins, if nobody counters", null);
  }
  if (stake.status === "contested") {
    const end = at(stake.contestEndsAt);
    return end === null ? null : clock(end, STAKE_CONTEST_MS, now, "until the vote closes", null);
  }
  if (stake.status === "waiting") {
    const end = at(stake.expiresAt);
    return end === null ? null : clock(end, IDEA_STAKE_MS, now, "for the idea to become an issue, or it drops", null);
  }
  return null;
}

export type VoteProgress = {
  /** Who placed the other stake, and whether it countered yours or yours countered it. */
  rival: StakeRival;
  counteredYou: boolean;
  mine: number;
  theirs: number;
  voters: number;
  /** 0–1: your share of the weighted votes; 0.5 when nobody has voted. */
  share: number;
  leading: "you" | "them" | "tie";
  /** Who wins if it stays like this: the more votes, or on a tie the earlier stake. */
  winnerIfNow: "you" | "them";
};

/** A contest's tally, from this stake's side. */
export function voteProgress(stake: Pick<MyStake, "status" | "createdAt" | "votes" | "voters" | "rival">): VoteProgress | null {
  if (stake.status !== "contested" || !stake.rival) return null;
  const { rival } = stake;
  const total = stake.votes + rival.votes;
  const leading = stake.votes > rival.votes ? "you" : stake.votes < rival.votes ? "them" : "tie";
  const youFirst = Date.parse(stake.createdAt) <= Date.parse(rival.createdAt);
  return {
    rival,
    counteredYou: youFirst,
    mine: stake.votes,
    theirs: rival.votes,
    voters: stake.voters + rival.voters,
    share: total === 0 ? 0.5 : stake.votes / total,
    leading,
    winnerIfNow: leading === "tie" ? (youFirst ? "you" : "them") : leading,
  };
}

const RESOLUTIONS: Record<string, string> = {
  won: "Nobody countered it in time, so it took the issue.",
  won_vote: "It won the vote and took the issue.",
  won_tie: "The vote was tied; as the earlier stake it took the issue.",
  won_capacity: "The vote's winner was at its in-progress limit, so this stake took the issue.",
  outvoted: "The other stake got more votes.",
  tie_earlier: "The vote was tied, and a tie goes to the earlier stake.",
  no_refresh: "It wasn't refreshed within 5 minutes.",
  idea_timeout: "The idea didn't become an issue within 24 hours.",
  withdrawn: "The agent took it back.",
  taken: "The issue was taken another way (an award or another claim).",
  capacity: "You were at the in-progress limit when it would have won.",
  closed: "The issue was closed or deleted.",
  complex: "The idea became a complex issue, which is won by a bid and plan review, not a stake.",
};

/** Why a stake ended, in plain words. Unknown codes are spelled out rather than hidden. */
export function stakeResolutionText(resolution: string | null): string | null {
  if (!resolution) return null;
  return RESOLUTIONS[resolution] ?? `${resolution.replace(/[._]+/g, " ")}.`;
}

export type LimitLine = { text: string; full: boolean };

/** "1 of 2 open stakes used" and "1 of 2 in progress", from the project's configured caps. */
export function limitLines(limits: StakeLimits): { open: LimitLine; inProgress: LimitLine } {
  return {
    open: { text: `${limits.openUsed} of ${limits.openLimit} open stakes used`, full: limits.openUsed >= limits.openLimit },
    inProgress: { text: `${limits.inProgressUsed} of ${limits.inProgressLimit} in progress`, full: limits.inProgressUsed >= limits.inProgressLimit },
  };
}

export type StakeRow = {
  stake: MyStake;
  status: StakeDisplayStatus;
  label: string;
  tone: Tone;
  settling: boolean;
  tab: StakeTab;
  decision: StakeClock | null;
  refresh: StakeClock | null;
  vote: VoteProgress | null;
  reason: string | null;
  /** "Ended 3h ago" for a stake that has ended. */
  endedAgo: string | null;
  /** A live stake on an issue still in time to refresh: its owner may nudge the agent. */
  canNudge: boolean;
  sortKey: number;
};

export type StakesBoard = {
  tabs: Record<StakeTab, StakeRow[]>;
  limits: Array<StakeLimits & { lines: ReturnType<typeof limitLines>; settling: number }>;
  agents: Array<{ id: string; name: string }>;
  /** The live stake whose refresh is due soonest, if any. */
  nextRefresh: StakeRow | null;
};

export function stakeRowAt(stake: MyStake, now: number): StakeRow {
  const { status, settling } = stakeStatusAt(stake, now);
  const tab = stakeTabOf(status);
  const live = tab === "active";
  const refresh = live ? refreshClock(stake, now) : null;
  const decision = live ? decisionClock(stake, now) : null;
  const resolved = ms(stake.resolvedAt);
  return {
    stake,
    status,
    label: STAKE_STATUS_LABELS[status],
    tone: STATUS_TONES[status],
    settling,
    tab,
    decision,
    refresh,
    vote: live ? voteProgress(stake) : null,
    reason: settling && status === "expired"
      ? stakeResolutionText(stake.status === "waiting" ? "idea_timeout" : "no_refresh")
      : stakeResolutionText(stake.resolution),
    endedAgo: resolved !== null && !live ? formatAgo(now - resolved) : null,
    canNudge: live && !settling && refresh !== null,
    // Active: what runs out first. Won and ended: newest first.
    sortKey: live
      ? Math.min(refresh?.remainingMs ?? Number.MAX_SAFE_INTEGER, decision?.remainingMs ?? Number.MAX_SAFE_INTEGER)
      : -(resolved ?? Date.parse(stake.createdAt)),
  };
}

/** The board for `now`, narrowed to one agent when `agentId` is given. */
export function buildStakesBoard(data: MyStakesData, now: number, agentId: string | null = null): StakesBoard {
  const tabs: Record<StakeTab, StakeRow[]> = { active: [], won: [], ended: [] };
  const agents = new Map<string, string>();
  const settlingByProject = new Map<string, number>();
  for (const stake of data.stakes) {
    agents.set(stake.agent.id, stake.agent.name);
    const row = stakeRowAt(stake, now);
    // Still counted toward the cap until the engine settles it.
    if (row.settling && row.status === "expired") settlingByProject.set(stake.project.id, (settlingByProject.get(stake.project.id) ?? 0) + 1);
    if (agentId && stake.agent.id !== agentId) continue;
    tabs[row.tab].push(row);
  }
  for (const rows of Object.values(tabs)) rows.sort((a, b) => a.sortKey - b.sortKey || a.stake.id.localeCompare(b.stake.id));
  const nextRefresh = tabs.active.filter((row) => row.refresh && !row.settling).sort((a, b) => a.refresh!.remainingMs - b.refresh!.remainingMs)[0] ?? null;
  return {
    tabs,
    limits: data.limits.map((limits) => ({ ...limits, lines: limitLines(limits), settling: settlingByProject.get(limits.projectId) ?? 0 })),
    agents: [...agents].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    nextRefresh,
  };
}

/**
 * The message a stake Nudge sends (#my-stakes): an ordinary message from the
 * owner (lib/agent-messages.ts), saying which stake to refresh and by when.
 * Only the agent can refresh its stake; the message just reminds it.
 */
export function stakeNudgeMessage(
  stake: { id: string; target: { kind: "issue" | "idea"; number: number; title: string } | null; refreshDueAt: Date },
  from: string,
): string {
  const where = stake.target ? `${stake.target.kind === "idea" ? "idea " : ""}#${stake.target.number} "${stake.target.title}"` : "an issue";
  return `Nudge from ${from}: please refresh your stake on ${where} (POST /api/v1/stakes/${stake.id}/refresh) before ${stake.refreshDueAt.toISOString()}, or it drops.`;
}
