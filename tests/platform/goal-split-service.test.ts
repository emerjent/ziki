import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Goal split guardrails end-to-end through `lib/goals/service` (#616): the
 * pool arithmetic, the transaction guards, sourceKey idempotency, and the
 * 400/404/409 IssueApiError map the web actions surface verbatim.
 */
const goalDb = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
const allocationDb = vi.hoisted(() => ({ findMany: vi.fn(), createMany: vi.fn() }));
const bugDb = vi.hoisted(() => ({ findMany: vi.fn() }));
const projectDb = vi.hoisted(() => ({ findFirst: vi.fn() }));
const agentDb = vi.hoisted(() => ({ findMany: vi.fn() }));
const transaction = vi.hoisted(() => vi.fn());
const publish = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    goal: goalDb,
    goalAllocation: allocationDb,
    bug: bugDb,
    project: projectDb,
    agent: agentDb,
    $transaction: transaction,
  },
}));
vi.mock("@/lib/agent-api/events", () => ({ publish }));

import {
  createGoalForPerson,
  splitGoalPoolForPerson,
  updateGoalStatusForPerson,
} from "@/lib/goals/service";
import { IssueApiError } from "@/lib/agent-api/errors";

const person = { userId: "user-1", organisationId: "org-1" };

function goalRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-11-09T10:00:00.000Z");
  return {
    id: "goal-1",
    organisationId: "org-1",
    projectId: "proj-1",
    createdById: "user-0",
    title: "Ship the launch",
    description: null,
    budgetPool: 1000,
    allocated: 400,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function formDataActionInput(payload: Record<string, unknown>) {
  return payload as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      goal: goalDb,
      goalAllocation: allocationDb,
      bug: bugDb,
      agent: agentDb,
      project: projectDb,
    };
    return fn(tx);
  });
  publish.mockResolvedValue({ id: "event-1" });
  // Default: an active goal with room in its pool, all targets present.
  goalDb.findFirst.mockResolvedValue(goalRow());
  bugDb.findMany.mockResolvedValue([{ id: "bug-1" }, { id: "bug-2" }, { id: "bug-3" }]);
  allocationDb.findMany.mockResolvedValue([]);
  goalDb.updateMany.mockResolvedValue({ count: 1 });
  goalDb.findUniqueOrThrow.mockResolvedValue(goalRow({ allocated: 1000 }));
  allocationDb.createMany.mockResolvedValue({ count: 3 });
  allocationDb.findMany.mockResolvedValue([]);
});

describe("splitGoalPoolForPerson (#616)", () => {
  it("splits the remaining pool evenly across three issues with indexed sourceKeys", async () => {
    const input = {
      method: "even" as const,
      sourceKey: "ui-abc",
      targets: [
        { targetType: "issue" as const, targetBugId: "bug-1" },
        { targetType: "issue" as const, targetBugId: "bug-2" },
        { targetType: "issue" as const, targetBugId: "bug-3" },
      ],
    };
    const result = await splitGoalPoolForPerson(person, "goal-1", formDataActionInput(input));

    // Remaining = 1000 - 400 = 600, even across three: 200 each.
    expect(allocationDb.createMany).toHaveBeenCalledTimes(1);
    const rows = (allocationDb.createMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.amount)).toEqual([200, 200, 200]);
    expect(rows.map((row) => row.sourceKey)).toEqual(["ui-abc:0", "ui-abc:1", "ui-abc:2"]);
    expect(rows.every((row) => row.goalId === "goal-1" && row.method === "even")).toBe(true);

    // The pool-wide guard bumps `allocated` by exactly the split total.
    const guard = goalDb.updateMany.mock.calls[0]![0] as {
      where: { allocated: { lte: number } };
      data: { allocated: { increment: number } };
    };
    // The invariant: still within budget after the increment (1000 - 600 = 400 left of headroom).
    expect(guard.where.allocated.lte).toBe(400);
    expect(guard.data.allocated.increment).toBe(600);

    // No agent audit; the event carries a null actor.
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "goal.split", actorAgentId: null }));

    expect(result.goal.allocated).toBe(1000);
    expect(result.goal.budget.remaining).toBe(0);
    expect(result.goal.budget.splitStatus).toBe("fully-split");
  });

  it("refuses a retry of a sourceKey that already exists, before anything moves", async () => {
    allocationDb.findMany.mockResolvedValue([{ sourceKey: "ui-abc:0" }, { sourceKey: "ui-abc:1" }]);
    await expect(
      splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
        method: "even",
        sourceKey: "ui-abc",
        targets: [
          { targetType: "issue", targetBugId: "bug-1" },
          { targetType: "issue", targetBugId: "bug-2" },
        ],
      })),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already applied") });
    expect(goalDb.updateMany).not.toHaveBeenCalled();
    expect(allocationDb.createMany).not.toHaveBeenCalled();
  });

  it("answers 409 when the pool-wide guard sees no room left (a racing split took it)", async () => {
    goalDb.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
        method: "even",
        sourceKey: "ui-race",
        targets: [
          { targetType: "issue", targetBugId: "bug-1" },
          { targetType: "issue", targetBugId: "bug-2" },
        ],
      })),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("over-allocate") });
    expect(allocationDb.createMany).not.toHaveBeenCalled();
  });

  it("refuses an incoming split larger than what is left, before the transaction", async () => {
    await expect(
      splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
        method: "manual",
        sourceKey: "ui-big",
        targets: [
          { targetType: "issue", targetBugId: "bug-1", amount: 600 },
          { targetType: "issue", targetBugId: "bug-2", amount: 2 },
        ],
      })),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("only 600 of the 1000-credit pool") });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("answers 409 for a completed or cancelled goal", async () => {
    goalDb.findFirst.mockResolvedValue(goalRow({ status: "completed" }));
    await expect(
      splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
        method: "even",
        sourceKey: "ui-x",
        targets: [{ targetType: "issue", targetBugId: "bug-1" }],
      })),
    ).rejects.toMatchObject({ status: 409, message: "Only active goals can be split." });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("answers 404 for a goal outside the person's organisation and for unknown targets", async () => {
    goalDb.findFirst.mockResolvedValue(null);
    await expect(
      splitGoalPoolForPerson(person, "goal-elsewhere", formDataActionInput({
        method: "even",
        sourceKey: "ui-x",
        targets: [{ targetType: "issue", targetBugId: "bug-1" }],
      })),
    ).rejects.toMatchObject({ status: 404 });
    expect(transaction).not.toHaveBeenCalled();

    goalDb.findFirst.mockResolvedValue(goalRow());
    bugDb.findMany.mockResolvedValue([{ id: "bug-1" }]); // bug-2 and bug-3 missing
    await expect(
      splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
        method: "even",
        sourceKey: "ui-x",
        targets: [
          { targetType: "issue", targetBugId: "bug-1" },
          { targetType: "issue", targetBugId: "bug-2" },
        ],
      })),
    ).rejects.toMatchObject({ status: 404, message: expect.stringContaining("Issue bug-2 not found in this project") });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses self-funding with 400", async () => {
    goalDb.findFirst.mockResolvedValue(goalRow());
    bugDb.findMany.mockResolvedValue([{ id: "bug-1" }]);
    await expect(
      splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
        method: "even",
        sourceKey: "ui-x",
        targets: [
          { targetType: "issue", targetBugId: "bug-1" },
          { targetType: "goal", targetGoalId: "goal-1" },
        ],
      })),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("cannot fund itself") });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not write rows for targets whose slice rounds to zero", async () => {
    // 2 credits across 3 issues: [1, 1, 0] — the zero slice is dropped.
    goalDb.findFirst.mockResolvedValue(goalRow({ allocated: 998 }));
    goalDb.findUniqueOrThrow.mockResolvedValue(goalRow({ allocated: 1000 }));
    await splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
      method: "even",
      sourceKey: "ui-dust",
      targets: [
        { targetType: "issue", targetBugId: "bug-1" },
        { targetType: "issue", targetBugId: "bug-2" },
        { targetType: "issue", targetBugId: "bug-3" },
      ],
    }));
    const rows = (allocationDb.createMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceKey)).toEqual(["ui-dust:0", "ui-dust:1"]);
    expect(goalDb.updateMany.mock.calls[0]![0]).toMatchObject({ data: { allocated: { increment: 2 } } });
  });
});

describe("createGoalForPerson and updateGoalStatusForPerson (#616)", () => {
  it("creates a goal attributed to the person, publishing an event without an agent actor", async () => {
    projectDb.findFirst.mockResolvedValue({ id: "proj-1", organisationId: "org-1" });
    goalDb.create.mockResolvedValue(goalRow({ allocated: 0, budgetPool: 1200 }));

    const goal = await createGoalForPerson(person, { title: "Launch week", budgetPool: 1200, projectId: "proj-1" });

    expect(goalDb.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        createdById: "user-1",
        organisationId: "org-1",
        projectId: "proj-1",
        budgetPool: 1200,
      }),
    }));
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: "goal.created",
      actorAgentId: null,
      payload: expect.objectContaining({ projectId: "proj-1", budgetPool: 1200 }),
    }));
    expect(goal.allocated).toBe(0);
  });

  it("answers 404 when the organisation has no such project", async () => {
    projectDb.findFirst.mockResolvedValue(null);
    await expect(
      createGoalForPerson(person, { title: "Launch week", budgetPool: 1200, projectId: "proj-gone" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("moves status and publishes goal.updated with a null actor", async () => {
    goalDb.update.mockResolvedValue(goalRow({ status: "completed" }));

    const goal = await updateGoalStatusForPerson(person, "goal-1", { status: "completed" });

    expect(goalDb.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "goal-1" },
      data: { status: "completed" },
    }));
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: "goal.updated",
      actorAgentId: null,
      payload: expect.objectContaining({ goalId: "goal-1", status: "completed" }),
    }));
    expect(goal.status).toBe("completed");
    expect(goal.budget.splitStatus).toBe("partially-split");
  });
});

it("maps PoolBudgetError instances onto IssueApiError statuses", async () => {
  // An empty pool splitting its (absent) remainder defaults to 0 and must refuse.
  goalDb.findFirst.mockResolvedValue(goalRow({ budgetPool: 0, allocated: 0 }));
  try {
    await splitGoalPoolForPerson(person, "goal-1", formDataActionInput({
      method: "even",
      sourceKey: "ui-empty",
      targets: [{ targetType: "issue", targetBugId: "bug-1" }],
    }));
    throw new Error("expected a refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(IssueApiError);
    expect((error as IssueApiError).status).toBe(409);
    expect((error as IssueApiError).message).toContain("empty (0 credits)");
  }
});
