"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateGoalStatusAction, type GoalActionResult } from "@/app/actions/goals";

/**
 * Move a goal between active, completed and cancelled — and reopen a closed
 * one — without leaving its page. Each button submits the same server
 * action with its own status value.
 */
export function GoalStatusControls({
  org,
  slug,
  goalId,
  status,
}: {
  org: string;
  slug: string;
  goalId: string;
  status: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState<GoalActionResult | undefined, FormData>(
    updateGoalStatusAction,
    undefined,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast(state.message ?? "Status updated.", "success");
      router.refresh();
    } else {
      toast(state.error, "error");
    }
  }, [state, toast, router]);

  const transitions =
    status === "active"
      ? [
          { value: "completed", label: "Mark completed", variant: "secondary" as const },
          { value: "cancelled", label: "Cancel goal", variant: "danger-secondary" as const },
        ]
      : [{ value: "active", label: "Reopen goal", variant: "secondary" as const }];

  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-testid="goal-status-controls">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="goalId" value={goalId} />
      {transitions.map((transition) => (
        <Button
          key={transition.value}
          type="submit"
          name="status"
          value={transition.value}
          variant={transition.variant}
          disabled={pending}
          className="rounded-lg px-3 py-1.5 text-[13px]"
        >
          {transition.label}
        </Button>
      ))}
    </form>
  );
}
