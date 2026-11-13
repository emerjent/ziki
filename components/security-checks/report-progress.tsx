import type { SecurityCheckItemStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { statusClass, substatusClass } from "@/lib/labels";
import { ITEM_STATUS_LABEL } from "@/lib/security-checks";
import type { ReportPart } from "@/lib/security-checks/report";

/** Ziki's issue status colours, by meaning: waiting like Requires confirmation (amber), checking like In progress, done like Live, skipped like Closed. */
const PART_STATUS_CLASS: Record<SecurityCheckItemStatus, string> = {
  waiting: substatusClass.requires_confirmation,
  checking: statusClass.in_progress,
  done: statusClass.resolved,
  skipped: statusClass.closed,
};

/**
 * How far the agents have got with a security check (#security-checks, part
 * 4): a bar with the numbers (so it isn't colour-only), then each part with
 * its status. Never shows what a part found.
 */
export function ReportProgress({
  progress,
  parts,
}: {
  progress: { done: number; total: number; percent: number };
  parts: ReportPart[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <div
          role="progressbar"
          aria-label="Check progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-valuetext={`${progress.done} of ${progress.total} parts done`}
          className="h-2 w-full overflow-hidden rounded-full bg-zk-chip"
        >
          <div
            className="h-full rounded-full bg-electric-blue-strong transition-[width]"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="mt-1 text-xs tabular-nums text-zk-text2">
          {progress.done} of {progress.total} parts done · {progress.percent}%
        </p>
      </div>
      <ul className="divide-y divide-zk-border">
        {parts.map((part) => (
          <li key={part.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 wrap-break-word text-sm text-zk-text">{part.title}</span>
            <Badge className={`shrink-0 ${PART_STATUS_CLASS[part.status]}`}>{ITEM_STATUS_LABEL[part.status]}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
