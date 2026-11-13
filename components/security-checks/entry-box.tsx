import type { SecurityTargetKind } from "@prisma/client";

/** A globe, server or code icon for what was pasted. */
export function KindIcon({ kind, className = "text-zk-muted" }: { kind: SecurityTargetKind | null; className?: string }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: `shrink-0 ${className}` };
  if (kind === "server") {
    return (
      <svg {...common}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
    );
  }
  if (kind === "repo") {
    return <svg {...common}><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" /></svg>;
  }
  return (
    <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>
  );
}
