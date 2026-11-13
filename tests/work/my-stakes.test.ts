import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyStake } from "@/lib/stakes/board";

/**
 * My stakes (#my-stakes): where each stake stands and how long its clocks
 * have left, the caps it counts against, who sees which stakes, and the Nudge,
 * which goes out as an ordinary message to the agent.
 */

const membershipFindMany = vi.hoisted(() => vi.fn());
const membershipFindUnique = vi.hoisted(() => vi.fn());
const stakeFindMany = vi.hoisted(() => vi.fn());
const stakeFindUnique = vi.hoisted(() => vi.fn());
const stakeCount = vi.hoisted(() => vi.fn());
const claimFindMany = vi.hoisted(() => vi.fn());
const claimCount = vi.hoisted(() => vi.fn());
const voteGroupBy = vi.hoisted(() => vi.fn());
const userFindMany = vi.hoisted(() => vi.fn());
const projectFindMany = vi.hoisted(() => vi.fn());
const sendAgentMessage = vi.hoisted(() => vi.fn());
const workflowFor = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findMany: membershipFindMany, findUnique: membershipFindUnique },
    issueStake: { findMany: stakeFindMany, findUnique: stakeFindUnique, count: stakeCount },
    issueClaim: { findMany: claimFindMany, count: claimCount },
    stakeVote: { groupBy: voteGroupBy },
    user: { findMany: userFindMany },
    project: { findMany: projectFindMany },
  },
}));
vi.mock("@/lib/agent-messages", () => ({ sendAgentMessage }));
vi.mock("@/lib/workflow", () => ({ workflowFor }));

import {
  buildStakesBoard,
  decisionClock,
  limitLines,
  parseStakeTab,
  refreshClock,
  stakeRowAt,
  stakeStatusAt,
  voteProgress,
} from "@/lib/stakes/board";
import { loadMyStakes } from "@/lib/stakes/queries";
import { nudgeStakeAgent } from "@/lib/stakes/nudge";
import { LIVE_STAKE_STATUSES, stakeCapCounts } from "@/lib/stake-rules";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const SEC = 1000;
const MIN = 60 * SEC;
const at = (ms: number) => new Date(NOW + ms).toISOString();

function stake(overrides: Partial<MyStake> = {}): MyStake {
  return {
    id: "stake-1",
    status: "open",
    resolution: null,
    summary: "Keep focus in the search box.",
    description: "The plan in full.",
    agent: { id: "agent-builder", name: "Demo Builder", username: "demo-builder" },
    project: { id: "project-lab", name: "Stakes Lab" },
    target: { kind: "issue", number: 9101, title: "Search loses focus", href: "/demo/stakes-lab/9101" },
    fromIdea: null,
    createdAt: at(-4 * MIN),
    lastRefreshAt: at(-90 * SEC),
    windowEndsAt: at(6 * MIN),
    contestEndsAt: null,
    expiresAt: null,
    resolvedAt: null,
    votes: 0,
    voters: 0,
    rival: null,
    ...overrides,
  };
}

describe("stake status", () => {
  it("shows an uncountered stake in its window as Winning, and a contested one as Countered · in vote", () => {
    expect(stakeStatusAt(stake(), NOW)).toEqual({ status: "winning", settling: false });
    const row = stakeRowAt(stake({ status: "contested", contestEndsAt: at(20 * MIN) }), NOW);
    expect(row.status).toBe("in_vote");
    expect(row.label).toBe("Countered · in vote");
    expect(row.tab).toBe("active");
  });

  it("shows a stake waiting on an idea as Pending until its 24 hours are up, then Expired while it settles", () => {
    const waiting = stake({ status: "waiting", windowEndsAt: null, expiresAt: at(22 * 60 * MIN) });
    expect(stakeStatusAt(waiting, NOW)).toEqual({ status: "pending", settling: false });
    expect(stakeStatusAt({ ...waiting, expiresAt: at(0) }, NOW)).toEqual({ status: "expired", settling: true });
  });

  it("drops a stake not refreshed within 5 minutes, as the engine does: strictly after 5 minutes", () => {
    expect(stakeStatusAt(stake({ lastRefreshAt: at(-5 * MIN) }), NOW).status).toBe("winning");
    const overdue = stakeRowAt(stake({ lastRefreshAt: at(-5 * MIN - 1) }), NOW);
    expect(overdue).toMatchObject({ status: "expired", settling: true, tab: "ended", canNudge: false });
    expect(overdue.reason).toBe("It wasn't refreshed within 5 minutes.");
  });

  it("keeps a stake whose window ended as Winning while it settles: winning also depends on the issue and the in-progress cap", () => {
    expect(stakeStatusAt(stake({ windowEndsAt: at(-1) }), NOW)).toEqual({ status: "winning", settling: true });
    expect(stakeStatusAt(stake({ status: "contested", contestEndsAt: at(-1) }), NOW)).toEqual({ status: "in_vote", settling: true });
  });

  it("files ended stakes under Won or Lost or expired, with the reason in plain words", () => {
    const won = stakeRowAt(stake({ status: "won", resolution: "won_vote", resolvedAt: at(-2 * 60 * MIN) }), NOW);
    expect(won).toMatchObject({ status: "won", tab: "won", endedAgo: "2h ago", reason: "It won the vote and took the issue." });
    expect(stakeRowAt(stake({ status: "lost", resolution: "tie_earlier", resolvedAt: at(-MIN) }), NOW)).toMatchObject({ status: "lost", tab: "ended" });
    expect(stakeRowAt(stake({ status: "dropped", resolution: "no_refresh", resolvedAt: at(-MIN) }), NOW).status).toBe("expired");
    expect(stakeRowAt(stake({ status: "dropped", resolution: "idea_timeout", resolvedAt: at(-MIN) }), NOW).status).toBe("expired");
    const withdrawn = stakeRowAt(stake({ status: "dropped", resolution: "withdrawn", resolvedAt: at(-MIN) }), NOW);
    expect(withdrawn).toMatchObject({ status: "dropped", tab: "ended", reason: "The agent took it back." });
  });

  it("opens the Active tab unless the address asks for Won or Lost or expired", () => {
    expect(parseStakeTab(undefined)).toBe("active");
    expect(parseStakeTab("won")).toBe("won");
    expect(parseStakeTab(["ended"])).toBe("ended");
    expect(parseStakeTab("everything")).toBe("active");
  });
});

describe("countdowns", () => {
  it("counts down to the refresh deadline, 5 minutes after the last refresh, and warns in the last minute", () => {
    expect(refreshClock(stake({ lastRefreshAt: at(-3 * MIN) }), NOW)).toMatchObject({ remaining: "2:00", warn: false, at: at(2 * MIN) });
    expect(refreshClock(stake({ lastRefreshAt: at(-4 * MIN) }), NOW)).toMatchObject({ remaining: "1:00", warn: true });
    expect(refreshClock(stake({ lastRefreshAt: at(-6 * MIN) }), NOW)).toMatchObject({ remaining: "0:00", remainingMs: 0, progress: 0 });
  });

  it("asks for no refresh while a stake waits on an idea", () => {
    expect(refreshClock(stake({ status: "waiting" }), NOW)).toBeNull();
    expect(stakeRowAt(stake({ status: "waiting", windowEndsAt: null, expiresAt: at(60 * MIN) }), NOW).canNudge).toBe(false);
  });

  it("counts down to when the stake is decided: its window, its vote, or its idea's 24 hours", () => {
    expect(decisionClock(stake({ windowEndsAt: at(6 * MIN) }), NOW)).toMatchObject({ remaining: "6:00", label: "until it wins, if nobody counters" });
    expect(decisionClock(stake({ status: "contested", contestEndsAt: at(28 * MIN) }), NOW)).toMatchObject({ remaining: "28:00", label: "until the vote closes" });
    expect(decisionClock(stake({ status: "waiting", expiresAt: at(22 * 60 * MIN) }), NOW)).toMatchObject({ remaining: "22h 00m" });
    expect(decisionClock(stake({ status: "won" }), NOW)).toBeNull();
  });

  it("puts the stake that runs out first at the top of Active, and the next refresh due on the board", () => {
    const board = buildStakesBoard(
      {
        stakes: [
          stake({ id: "later", lastRefreshAt: at(-30 * SEC) }),
          stake({ id: "sooner", lastRefreshAt: at(-4 * MIN - 15 * SEC) }),
        ],
        limits: [],
        loadedAt: NOW,
      },
      NOW,
    );
    expect(board.tabs.active.map((row) => row.stake.id)).toEqual(["sooner", "later"]);
    expect(board.nextRefresh?.stake.id).toBe("sooner");
    expect(board.nextRefresh?.refresh?.remaining).toBe("0:45");
  });
});

describe("contest votes", () => {
  const rival = { id: "rival", agentName: "Amara's Claude", ownerName: "Amara Okafor", summary: "Their plan.", description: "Their plan in full.", createdAt: at(-2 * MIN), votes: 1, voters: 1 };

  it("says who countered whom and who leads", () => {
    const vote = voteProgress(stake({ status: "contested", createdAt: at(-6 * MIN), votes: 2, voters: 2, rival }));
    expect(vote).toMatchObject({ counteredYou: true, mine: 2, theirs: 1, voters: 3, leading: "you", winnerIfNow: "you" });
    expect(vote?.share).toBeCloseTo(2 / 3);
  });

  it("gives a tie to the earlier stake", () => {
    expect(voteProgress(stake({ status: "contested", createdAt: at(-1 * MIN), votes: 1, voters: 1, rival }))).toMatchObject({
      counteredYou: false,
      leading: "tie",
      winnerIfNow: "them",
    });
  });
});

describe("limits", () => {
  it("reads as the project's caps: 1 of 2 open stakes used, 1 of 2 in progress", () => {
    const lines = limitLines({ projectId: "p", project: "Stakes Lab", openUsed: 1, openLimit: 2, inProgressUsed: 1, inProgressLimit: 2 });
    expect(lines.open).toEqual({ text: "1 of 2 open stakes used", full: false });
    expect(lines.inProgress).toEqual({ text: "1 of 2 in progress", full: false });
    expect(limitLines({ projectId: "p", project: "x", openUsed: 2, openLimit: 2, inProgressUsed: 0, inProgressLimit: 2 }).open.full).toBe(true);
  });

  it("counts what the engine counts: live stakes on ideas and issues, and active claims on issues In progress", async () => {
    stakeCount.mockResolvedValue(1);
    claimCount.mockResolvedValue(2);
    const db = { issueStake: { count: stakeCount }, issueClaim: { count: claimCount } } as never;
    expect(await stakeCapCounts(db, { organisationId: "org", projectId: "p", userId: "me" })).toEqual({ open: 1, inProgress: 2 });
    expect(stakeCount.mock.calls[0][0].where).toEqual({ organisationId: "org", projectId: "p", beneficiaryUserId: "me", status: { in: LIVE_STAKE_STATUSES } });
    expect(LIVE_STAKE_STATUSES).toEqual(["waiting", "open", "contested"]);
    expect(claimCount.mock.calls[0][0].where).toEqual({
      beneficiaryUserId: "me", status: "active", releasedAt: null,
      bug: { organisationId: "org", projectId: "p", isDeleted: false, status: "in_progress" },
    });
  });

  it("notes stakes that missed their refresh but still count until the engine drops them", () => {
    const board = buildStakesBoard(
      {
        stakes: [stake({ lastRefreshAt: at(-6 * MIN) }), stake({ id: "fine" })],
        limits: [{ projectId: "project-lab", project: "Stakes Lab", openUsed: 2, openLimit: 2, inProgressUsed: 0, inProgressLimit: 2 }],
        loadedAt: NOW,
      },
      NOW,
    );
    expect(board.limits[0]).toMatchObject({ settling: 1, lines: { open: { text: "2 of 2 open stakes used", full: true } } });
  });
});

const dbStake = (overrides: Record<string, unknown> = {}) => ({
  id: "stake-1",
  organisationId: "org-demo",
  projectId: "project-lab",
  status: "open",
  resolution: null,
  summary: "Mine.",
  description: "Mine in full.",
  createdAt: new Date(NOW - 4 * MIN),
  lastRefreshAt: new Date(NOW - MIN),
  windowEndsAt: new Date(NOW + 6 * MIN),
  contestEndsAt: null,
  expiresAt: null,
  resolvedAt: null,
  bugId: "bug-1",
  agent: { id: "agent-builder", name: "Demo Builder", username: "demo-builder" },
  bug: { number: 9101, title: "Search loses focus", isDeleted: false },
  idea: null,
  ...overrides,
});

describe("who sees which stakes (loadMyStakes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipFindMany.mockResolvedValue([{ organisationId: "org-demo" }, { organisationId: "org-work" }]);
    stakeFindMany.mockResolvedValue([]);
    claimFindMany.mockResolvedValue([]);
    voteGroupBy.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);
    projectFindMany.mockResolvedValue([{ id: "project-lab", name: "Stakes Lab", slug: "stakes-lab", organisationId: "org-demo", organisation: { slug: "demo" } }]);
    stakeCount.mockResolvedValue(1);
    claimCount.mockResolvedValue(0);
    workflowFor.mockResolvedValue({ stakeLimit: 2, stakeInProgressLimit: 2 });
  });

  it("shows nothing, and reads no stakes, for someone in no organisation", async () => {
    membershipFindMany.mockResolvedValue([]);
    expect(await loadMyStakes("jennifer")).toMatchObject({ stakes: [], limits: [] });
    expect(stakeFindMany).not.toHaveBeenCalled();
  });

  it("reads only stakes for the person or by an agent they own, in organisations they belong to now", async () => {
    await loadMyStakes("jennifer");
    expect(membershipFindMany.mock.calls[0][0].where).toMatchObject({ userId: "jennifer" });
    const scope = {
      organisationId: { in: ["org-demo", "org-work"] },
      OR: [{ beneficiaryUserId: "jennifer" }, { agent: { ownerUserId: "jennifer" } }],
    };
    expect(stakeFindMany).toHaveBeenCalledTimes(2);
    for (const call of stakeFindMany.mock.calls) expect(call[0].where.AND[0]).toEqual(scope);
  });

  it("loads the other contender in a contest, with both sides' weighted votes", async () => {
    stakeFindMany
      .mockResolvedValueOnce([dbStake({ id: "mine", status: "contested", contestEndsAt: new Date(NOW + 20 * MIN) })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "rival", bugId: "bug-1", summary: "Theirs.", description: "Theirs in full.", createdAt: new Date(NOW - 2 * MIN), beneficiaryUserId: "amara", agent: { name: "Amara's Claude" } },
      ]);
    voteGroupBy.mockResolvedValue([
      { stakeId: "mine", _sum: { weight: 2 }, _count: { _all: 2 } },
      { stakeId: "rival", _sum: { weight: 3 }, _count: { _all: 1 } },
    ]);
    userFindMany.mockResolvedValue([{ id: "amara", name: "Amara Okafor" }]);
    const data = await loadMyStakes("jennifer");
    // The rival is looked up only on the issues of the person's own contests.
    expect(stakeFindMany.mock.calls[2][0].where).toEqual({ bugId: { in: ["bug-1"] }, status: "contested", id: { notIn: ["mine"] } });
    expect(data.stakes[0]).toMatchObject({
      votes: 2,
      voters: 2,
      target: { kind: "issue", number: 9101, href: "/demo/stakes-lab/9101" },
      rival: { id: "rival", agentName: "Amara's Claude", ownerName: "Amara Okafor", votes: 3, voters: 1 },
    });
  });

  it("takes each project's caps from its workflow settings, not a fixed number", async () => {
    stakeFindMany.mockResolvedValueOnce([dbStake()]).mockResolvedValueOnce([]);
    workflowFor.mockResolvedValue({ stakeLimit: 3, stakeInProgressLimit: 1 });
    stakeCount.mockResolvedValue(1);
    claimCount.mockResolvedValue(1);
    const data = await loadMyStakes("jennifer");
    expect(workflowFor).toHaveBeenCalledWith("project-lab");
    expect(data.limits).toEqual([{ projectId: "project-lab", project: "Stakes Lab", openUsed: 1, openLimit: 3, inProgressUsed: 1, inProgressLimit: 1 }]);
    expect(stakeCount.mock.calls[0][0].where).toMatchObject({ organisationId: "org-demo", projectId: "project-lab", beneficiaryUserId: "jennifer" });
  });

  it("links a stake waiting on an idea to the idea", async () => {
    stakeFindMany.mockResolvedValueOnce([dbStake({ status: "waiting", bugId: null, bug: null, idea: { number: 9201, title: "Pin a note", isDeleted: false } })]).mockResolvedValueOnce([]);
    const data = await loadMyStakes("jennifer");
    expect(data.stakes[0].target).toEqual({ kind: "idea", number: 9201, title: "Pin a note", href: "/demo/stakes-lab/ideas/9201" });
  });
});

describe("nudging an agent to refresh its stake", () => {
  const jennifer = { id: "jennifer", name: "Jennifer", role: "user" as const };
  const live = (overrides: Record<string, unknown> = {}) => ({
    id: "stake-1",
    status: "open",
    agentId: "agent-builder",
    beneficiaryUserId: "jennifer",
    lastRefreshAt: new Date(Date.now() - 2 * MIN),
    agent: { ownerUserId: "jennifer" },
    bug: { number: 9101, title: "Search loses focus", organisationId: "org-demo" },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sendAgentMessage.mockResolvedValue({ ok: true, id: "message-1" });
    membershipFindUnique.mockResolvedValue({
      role: "member",
      organisation: { id: "org-demo", name: "Demo", slug: "demo", archivedAt: null },
    });
  });

  it("refuses someone else's stake, as if it didn't exist, and sends nothing", async () => {
    stakeFindUnique.mockResolvedValue(live({ beneficiaryUserId: "dara", agent: { ownerUserId: "dara" } }));
    expect(await nudgeStakeAgent(jennifer, "stake-1")).toEqual({ ok: false, error: "That stake doesn't exist." });
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("refuses a former organisation member even when they still own the stake's agent", async () => {
    stakeFindUnique.mockResolvedValue(live());
    membershipFindUnique.mockResolvedValue(null);
    expect(await nudgeStakeAgent(jennifer, "stake-1")).toEqual({ ok: false, error: "That stake doesn't exist." });
    expect(membershipFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organisationId_userId: { organisationId: "org-demo", userId: "jennifer" } },
    }));
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("refuses a stake that has ended, or one waiting on an idea, or one past its refresh", async () => {
    stakeFindUnique.mockResolvedValueOnce(live({ status: "won" }));
    expect((await nudgeStakeAgent(jennifer, "stake-1")).ok).toBe(false);
    stakeFindUnique.mockResolvedValueOnce(live({ status: "waiting", bug: null }));
    expect((await nudgeStakeAgent(jennifer, "stake-1")).ok).toBe(false);
    stakeFindUnique.mockResolvedValueOnce(live({ lastRefreshAt: new Date(Date.now() - 6 * MIN) }));
    expect((await nudgeStakeAgent(jennifer, "stake-1")).ok).toBe(false);
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("messages the agent behind your live stake, under the ordinary message rule, with the refresh deadline", async () => {
    const lastRefreshAt = new Date(Date.now() - 2 * MIN);
    stakeFindUnique.mockResolvedValue(live({ lastRefreshAt }));
    const result = await nudgeStakeAgent(jennifer, "stake-1");
    expect(result.ok).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(jennifer, "agent-builder", {
      body: `Nudge from Jennifer: please refresh your stake on #9101 "Search loses focus" (POST /api/v1/stakes/stake-1/refresh) before ${new Date(lastRefreshAt.getTime() + 5 * MIN).toISOString()}, or it drops.`,
    });
  });

  it("passes on the message rule's refusal (for example a revoked agent)", async () => {
    stakeFindUnique.mockResolvedValue(live());
    sendAgentMessage.mockResolvedValue({ ok: false, error: "That agent is revoked." });
    expect(await nudgeStakeAgent(jennifer, "stake-1")).toEqual({ ok: false, error: "That agent is revoked." });
  });
});
