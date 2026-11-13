import { describe, expect, it } from "vitest";
import {
  MAX_POOL_CREDITS,
  MAX_SPLIT_TARGETS,
  PoolBudgetError,
  assertWithinPool,
  describeBudget,
  remainingPool,
  splitEvenly,
  splitMilestones,
  splitProportional,
} from "@/lib/goals/pool-split";

/** Goal budget pool arithmetic (#616): integer credits, exact sums, explicit refusals. */
describe("pool-split arithmetic (#616)", () => {
  it("splits evenly with the leftover credits going to the earliest targets", () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(10, 3).reduce((sum, piece) => sum + piece, 0)).toBe(10);
    expect(splitEvenly(0, 2)).toEqual([0, 0]);
    expect(splitEvenly(7, 1)).toEqual([7]);
  });

  it("splits proportionally by weight and always sums to exactly the amount", () => {
    expect(splitProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitProportional(999, [7, 3])).toEqual([699, 300]);
    expect(splitProportional(5, [0, 1])).toEqual([0, 5]);
    const pieces = splitProportional(1_000_003, [123, 456, 789]);
    expect(pieces.reduce((sum, piece) => sum + piece, 0)).toBe(1_000_003);
  });

  it("refuses proportional splits with no positive weight", () => {
    expect(() => splitProportional(10, [])).toThrow(PoolBudgetError);
    expect(() => splitProportional(10, [0, 0])).toThrow(/at least one positive weight/);
    expect(() => splitProportional(10, [-1, 2])).toThrow(/whole numbers/);
  });

  it("requires milestone shares to total exactly 100 and keeps their sum exact", () => {
    expect(splitMilestones(1000, [50, 30, 20])).toEqual([500, 300, 200]);
    expect(splitMilestones(101, [33, 33, 34]).reduce((sum, piece) => sum + piece, 0)).toBe(101);
    expect(() => splitMilestones(100, [50, 40])).toThrow(/total exactly 100, got 90/);
    expect(() => splitMilestones(100, [101, -1])).toThrow(PoolBudgetError);
  });

  it("refuses fractional or negative split amounts", () => {
    expect(() => splitEvenly(10.5, 2)).toThrow(/whole number of credits/);
    expect(() => splitProportional(-5, [1])).toThrow(PoolBudgetError);
    expect(() => splitEvenly(10, 0)).toThrow(/at least one target/);
  });

  it("keeps remaining and over-allocation refusals exact", () => {
    expect(remainingPool(1200, 700)).toBe(500);
    expect(() => remainingPool(-1, 0)).toThrow(/non-negative/);
    expect(() => remainingPool(10.5, 0)).toThrow(/whole/);

    // Nothing over the leftover: exactly the remainder is allowed.
    expect(assertWithinPool(1200, 700, 500)).toBe(500);
    expect(() => assertWithinPool(1200, 700, 501)).toThrow(/only 500 of the 1200-credit pool/);
    expect(() => assertWithinPool(0, 0, 1)).toThrow(/empty \(0 credits\)/);
    // Incoming must be a whole non-negative credit count.
    expect(() => assertWithinPool(100, 0, 1.5)).toThrow(/whole number of credits/);
  });

  it("projects display numbers with clamped statuses", () => {
    expect(describeBudget(0, 0)).toMatchObject({ remaining: 0, utilizationPercent: 0, splitStatus: "no-budget" });
    expect(describeBudget(100, 0)).toMatchObject({ remaining: 100, utilizationPercent: 0, splitStatus: "unfunded" });
    expect(describeBudget(100, 40)).toMatchObject({ remaining: 60, utilizationPercent: 40, splitStatus: "partially-split" });
    expect(describeBudget(100, 100)).toMatchObject({ remaining: 0, utilizationPercent: 100, splitStatus: "fully-split" });
    // A corrupt over-allocated row clamps instead of going negative.
    expect(describeBudget(100, 150)).toMatchObject({ allocated: 150, remaining: 0, utilizationPercent: 100 });
  });

  it("publishes the limits mirrored in Zod", () => {
    expect(MAX_POOL_CREDITS).toBe(1_000_000_000);
    expect(MAX_SPLIT_TARGETS).toBe(50);
  });
});
