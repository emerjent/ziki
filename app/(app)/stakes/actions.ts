"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import type { NudgeResult } from "@/lib/activity/nudge";
import { nudgeStakeAgent } from "@/lib/stakes/nudge";

/** My stakes' Nudge button (#my-stakes): asks your agent to refresh its stake. The lib checks the stake is yours. */
export async function nudgeStakeAction(stakeId: unknown): Promise<NudgeResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: "The agent platform is turned off on this site." };
  if (typeof stakeId !== "string" || !stakeId) return { ok: false, error: "Invalid stake." };
  const user = await requireUser();
  const result = await nudgeStakeAgent(user, stakeId);
  // A nudge is a message: it shows in the Inbox's Messages tab.
  if (result.ok) revalidatePath("/inbox");
  return result;
}
