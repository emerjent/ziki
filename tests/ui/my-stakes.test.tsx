// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyStake, MyStakesData } from "@/lib/stakes/board";

/** My stakes (#my-stakes): tabs, live clocks and the refresh warning, the contest, limits, Nudge, and the loading, empty and error states. */

const nudgeStakeAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/stakes/actions", () => ({ nudgeStakeAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StakesBoard, STAKES_RELOAD_MS } from "@/app/(app)/stakes/stakes-board";
import StakesError from "@/app/(app)/stakes/error";
import StakesLoading from "@/app/(app)/stakes/loading";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const SEC = 1000;
const MIN = 60 * SEC;
const at = (ms: number) => new Date(NOW + ms).toISOString();

function stake(id: string, number: number, overrides: Partial<MyStake> = {}): MyStake {
  return {
    id,
    status: "open",
    resolution: null,
    summary: `Plan for ${number}.`,
    description: `The full plan for ${number}.`,
    agent: { id: "agent-builder", name: "Demo Builder", username: "demo-builder" },
    project: { id: "project-lab", name: "Stakes Lab" },
    target: { kind: "issue", number, title: `Issue ${number}`, href: `/demo/stakes-lab/${number}` },
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

const LIMITS = [{ projectId: "project-lab", project: "Stakes Lab", openUsed: 1, openLimit: 2, inProgressUsed: 1, inProgressLimit: 2 }];

function renderBoard(data: Partial<MyStakesData>, initialTab: "active" | "won" | "ended" = "active") {
  return render(<StakesBoard data={{ stakes: [], limits: [], loadedAt: NOW, ...data }} initialTab={initialTab} />);
}

// The board's clock ticks from the data's moment: keep the page's "now" at NOW, moving with real time.
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("StakesBoard", () => {
  it("shows a winning stake with both clocks and the project's limits", () => {
    renderBoard({ stakes: [stake("s1", 9101)], limits: LIMITS });
    const card = screen.getByRole("article", { name: /Issue #9101 Issue 9101/ });
    expect(within(card).getByText("Winning")).toBeInTheDocument();
    expect(within(within(card).getByTestId("decision-clock")).getByText("6:00")).toBeInTheDocument();
    expect(within(within(card).getByTestId("refresh-clock")).getByText("3:30")).toBeInTheDocument();
    expect(within(card).queryByText(/Refresh due soon/)).not.toBeInTheDocument();
    const limits = screen.getByRole("region", { name: "Your stake limits" });
    expect(within(limits).getByText("1 of 2 open stakes used")).toBeInTheDocument();
    expect(within(limits).getByText("1 of 2 in progress")).toBeInTheDocument();
  });

  it("moves the clocks every second and warns in the last minute before a refresh is due", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: NOW });
    renderBoard({ stakes: [stake("s1", 9101, { lastRefreshAt: at(-3 * MIN - 58 * SEC) })] });
    const card = screen.getByRole("article");
    expect(within(card).getByTestId("refresh-clock")).toHaveTextContent("1:02");
    expect(within(card).queryByText(/Refresh due soon/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3 * SEC);
    });
    expect(within(card).getByTestId("refresh-clock")).toHaveTextContent("0:59");
    expect(within(card).getByRole("status")).toHaveTextContent("Refresh due soon: Demo Builder must refresh this stake or it drops.");
  });

  it("reloads the data every 30 seconds while a stake is live, and not when none is", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: NOW });
    const { unmount } = renderBoard({ stakes: [stake("s1", 9101)] });
    act(() => {
      vi.advanceTimersByTime(STAKES_RELOAD_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    refresh.mockClear();
    renderBoard({ stakes: [stake("s2", 9102, { status: "won", resolution: "won", resolvedAt: at(-MIN) })] });
    act(() => {
      vi.advanceTimersByTime(STAKES_RELOAD_MS * 2);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a contest: who countered, their plan, the vote and its deadline", () => {
    renderBoard({
      stakes: [
        stake("mine", 9102, {
          status: "contested",
          createdAt: at(-6 * MIN),
          contestEndsAt: at(28 * MIN),
          votes: 2,
          voters: 2,
          rival: { id: "rival", agentName: "Amara's Claude", ownerName: "Amara Okafor", summary: "Use the streaming writer.", description: "Flush on end.", createdAt: at(-2 * MIN), votes: 1, voters: 1 },
        }),
      ],
    });
    const card = screen.getByRole("article");
    expect(within(card).getByText("Countered · in vote")).toBeInTheDocument();
    const contest = within(card).getByRole("region", { name: "Contest" });
    expect(contest).toHaveTextContent("Amara's Claude (for Amara Okafor) countered your stake.");
    expect(contest).toHaveTextContent("Use the streaming writer.");
    expect(contest).toHaveTextContent("You lead 2–1.");
    expect(contest).toHaveTextContent("3 people have voted");
    expect(within(contest).getByRole("meter", { name: "Your share of the votes" })).toHaveAttribute("aria-valuenow", "67");
    const deadline = within(card).getByTestId("decision-clock");
    expect(deadline).toHaveTextContent("28:00");
    expect(deadline).toHaveTextContent("until the vote closes");
  });

  it("switches tabs, with counts, and keeps the reason a stake ended", () => {
    renderBoard({
      stakes: [
        stake("active", 9101),
        stake("won", 9103, { status: "won", resolution: "won", resolvedAt: at(-2 * 60 * MIN) }),
        stake("lost", 9104, { status: "lost", resolution: "outvoted", resolvedAt: at(-60 * MIN) }),
        stake("expired", 9105, { status: "dropped", resolution: "no_refresh", resolvedAt: at(-30 * MIN) }),
      ],
    });
    const tabs = screen.getByRole("tablist", { name: "Stakes" });
    expect(within(tabs).getByRole("tab", { name: /Active/ })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: /Lost or expired/ })).toHaveTextContent("2");

    fireEvent.click(within(tabs).getByRole("tab", { name: /Won/ }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("article")).toHaveLength(1);
    expect(panel).toHaveTextContent("Nobody countered it in time, so it took the issue.");
    expect(panel).toHaveTextContent("Won 2h ago.");
    expect(window.location.search).toBe("?tab=won");

    fireEvent.keyDown(within(tabs).getByRole("tab", { name: /Won/ }), { key: "ArrowRight" });
    expect(within(tabs).getByRole("tab", { name: /Lost or expired/ })).toHaveFocus();
    const ended = screen.getByRole("tabpanel");
    expect(within(ended).getAllByRole("article").map((card) => within(card).getAllByText(/^(Lost|Expired)$/)[0].textContent)).toEqual(["Expired", "Lost"]);
    expect(ended).toHaveTextContent("The other stake got more votes.");
    expect(ended).toHaveTextContent("It wasn't refreshed within 5 minutes.");
  });

  it("opens on the tab the address names", () => {
    renderBoard({ stakes: [stake("won", 9103, { status: "won", resolution: "won_tie", resolvedAt: at(-MIN) })] }, "won");
    expect(screen.getByRole("tab", { name: /Won/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("The vote was tied; as the earlier stake it took the issue.");
  });

  it("shows a stake waiting on an idea as Pending, with no refresh to do yet", () => {
    renderBoard({
      stakes: [
        stake("idea", 9201, {
          status: "waiting",
          windowEndsAt: null,
          expiresAt: at(22 * 60 * MIN),
          project: { id: "project-ideas", name: "Idea Lab" },
          target: { kind: "idea", number: 9201, title: "Pin a note", href: "/demo/idea-lab/ideas/9201" },
        }),
      ],
    });
    const card = screen.getByRole("article", { name: /Idea #9201 Pin a note/ });
    expect(within(card).getByText("Pending")).toBeInTheDocument();
    expect(within(card).getByTestId("decision-clock")).toHaveTextContent("22h 00m");
    expect(within(card).getByText(/No refresh needed while it waits/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Nudge/ })).not.toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open idea" })).toHaveAttribute("href", "/demo/idea-lab/ideas/9201");
  });

  it("shows the empty state on each tab", () => {
    renderBoard({});
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No active stakes.");
    fireEvent.click(screen.getByRole("tab", { name: /Won/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No won stakes yet.");
    fireEvent.click(screen.getByRole("tab", { name: /Lost or expired/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No lost or expired stakes.");
    expect(screen.queryByRole("region", { name: "Your stake limits" })).not.toBeInTheDocument();
  });

  it("narrows the board to one agent", () => {
    renderBoard({
      stakes: [stake("a", 9101), stake("b", 9102, { agent: { id: "agent-lead", name: "Demo Lead", username: null } })],
    });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.click(within(screen.getByRole("group", { name: "Show one agent" })).getByRole("button", { name: "Demo Lead" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveTextContent("Issue #9102");
  });

  it("nudges the agent to refresh, and says so; a refusal shows as an alert", async () => {
    nudgeStakeAction.mockResolvedValueOnce({ ok: true, at: new Date(NOW).toISOString() });
    renderBoard({ stakes: [stake("s1", 9101)] });
    fireEvent.click(screen.getByRole("button", { name: "Nudge Demo Builder to refresh" }));
    await waitFor(() => expect(nudgeStakeAction).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText(/Nudge sent .*Demo Builder will see it the next time it runs\./)).toBeInTheDocument();

    nudgeStakeAction.mockResolvedValueOnce({ ok: false, error: "That agent is revoked." });
    // The button turns back on once the transition settles, which can trail the status line.
    fireEvent.click(await screen.findByRole("button", { name: "Nudge again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That agent is revoked.");
  });
});

describe("My stakes loading and error states", () => {
  it("shows a loading outline that says what it is waiting for", () => {
    render(<StakesLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your stakes…");
  });

  it("shows an error with a way to try again", () => {
    const reset = vi.fn();
    render(<StakesError reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your stakes could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
