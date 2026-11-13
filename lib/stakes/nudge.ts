import "server-only";
import { prisma } from "@/lib/prisma";
import { sendAgentMessage } from "@/lib/agent-messages";
import { memberOrganisationById } from "@/lib/organisations";
import type { Actor } from "@/lib/agents/registry";
import type { NudgeResult } from "@/lib/activity/nudge";
import { stakeNudgeMessage } from "@/lib/stakes/board";
import { STAKE_REFRESH_MS } from "@/lib/stake-rules";

/**
 * Nudge the agent behind one of your live stakes to refresh it (#my-stakes).
 * Only the agent can refresh a stake (its proof of life), so this is an
 * ordinary message (lib/agent-messages.ts), under that rule of who may send
 * one. It is offered only on the person's own stakes, as the page shows no
 * others.
 */
export async function nudgeStakeAgent(actor: Actor & { name?: string | null }, stakeId: string): Promise<NudgeResult> {
  const stake = await prisma.issueStake.findUnique({
    where: { id: stakeId },
    select: {
      id: true,
      status: true,
      agentId: true,
      beneficiaryUserId: true,
      lastRefreshAt: true,
      agent: { select: { ownerUserId: true } },
      bug: { select: { number: true, title: true, organisationId: true } },
    },
  });
  if (!stake || (stake.beneficiaryUserId !== actor.id && stake.agent.ownerUserId !== actor.id)) {
    return { ok: false, error: "That stake doesn't exist." };
  }
  if (stake.status !== "open" && stake.status !== "contested") {
    return { ok: false, error: "Only a live stake on an issue needs refreshing." };
  }
  const organisation = stake.bug
    ? await memberOrganisationById(prisma, actor.id, stake.bug.organisationId)
    : null;
  if (!organisation || organisation.archivedAt) {
    return { ok: false, error: "That stake doesn't exist." };
  }
  const refreshDueAt = new Date(stake.lastRefreshAt.getTime() + STAKE_REFRESH_MS);
  if (refreshDueAt.getTime() < Date.now()) {
    return { ok: false, error: "This stake missed its refresh; Ziki drops it at its next check." };
  }
  const body = stakeNudgeMessage(
    { id: stake.id, target: stake.bug ? { kind: "issue", number: stake.bug.number, title: stake.bug.title } : null, refreshDueAt },
    actor.name?.trim() || "your owner",
  );
  const sent = await sendAgentMessage(actor, stake.agentId, { body });
  return sent.ok ? { ok: true, at: new Date().toISOString() } : sent;
}
