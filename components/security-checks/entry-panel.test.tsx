import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/security-checks", () => ({ unlockSecurityFindings: vi.fn() }));
vi.mock("@/app/actions/security-assistant", () => ({ talkToSecurityAssistant: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/components/local-time", () => ({ LocalTime: () => <time>2 days ago</time> }));

import { SecurityChecksPanel } from "./entry-panel";
import type { WorkspaceCheckRow } from "@/lib/security-checks/entry";
import type { PreviewSummary } from "@/lib/security-checks/preview-summary";

const row = (over: Partial<WorkspaceCheckRow>): WorkspaceCheckRow => ({
  id: "c1", targetId: "t1", kind: "website", value: "settle.ng", status: "queued",
  verified: false, posted: false, findings: 0, unlocked: 0, moved: 0, preview: null, createdAt: new Date("2026-11-11T10:00:00Z"), ...over,
});

const quick: PreviewSummary = {
  kind: "website",
  target: "settle.ng",
  checkedAt: "2026-11-11T10:00:00.000Z",
  total: 2,
  counts: { critical: 0, high: 0, medium: 1, low: 1 },
  risk: "medium",
  areas: [
    { area: "https", label: "HTTPS", problems: 0 },
    { area: "headers", label: "Security headers", problems: 2 },
  ],
  rows: [
    { severity: "medium", area: "headers", label: "Security headers", title: "No Content Security Policy" },
    { severity: "low", area: "headers", label: "Security headers", title: "Browsers may guess file types" },
  ],
} as PreviewSummary;

describe("SecurityChecksPanel (#security-checks, 14 Nov plan)", () => {
  it("shows a new workspace only the big box, with no proof step", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[]} />);
    expect(html).toContain("What do you want to secure?");
    expect(html).toContain('name="target"');
    expect(html).not.toContain("Show it&#x27;s yours");
    expect(html).not.toContain("Your scans");
    expect(html).not.toContain("free");
  });

  it("keeps the box on top and lists the scans as cards, each with its stage and one click to its report", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel
        checks={[
          row({}),
          row({ id: "c2", targetId: "t2", kind: "repo", value: "settle/app", status: "checking" }),
          row({ id: "c3", targetId: "t3", value: "shop.ng", status: "done", posted: true, findings: 4, unlocked: 1 }),
          row({ id: "c4", targetId: "t4", value: "blog.ng", status: "done", posted: true, findings: 2, unlocked: 2, moved: 2 }),
        ]}
      />,
    );
    expect(html).toContain("What do you want to secure?");
    expect(html).toContain("Your scans");
    expect(html).toContain("Scanning");
    expect(html).toContain("Report ready");
    expect(html).toContain("In your app");
    // No proof step anywhere.
    expect(html).not.toContain("/verify");
    expect(html).not.toContain("Continue");
    // Still being checked: no report yet, so nothing to unlock.
    expect(html).toContain('href="/security/checks/c1"');
    expect(html).not.toContain('href="/security/checks/c1/pay"');
    // Posted with locked findings: unlock them.
    expect(html).toContain('href="/security/checks/c3/pay"');
    expect(html).toContain(">Unlock fixes</a>");
    expect(html).toContain("4 findings, 1 unlocked");
    // All unlocked and moved: the report stays one click away.
    expect(html).not.toContain('href="/security/checks/c4/pay"');
    expect(html).toContain("2 moved to your app.");
    // Cards, not the issue table or a sidebar.
    expect(html).not.toContain("<table");
    expect(html).not.toContain('aria-label="Status"');
  });

  it("says nothing to fix when the report found nothing", () => {
    const html = renderToStaticMarkup(<SecurityChecksPanel checks={[row({ status: "done", posted: true })]} />);
    expect(html).toContain("nothing to fix");
    expect(html).toContain('href="/security/checks/c1"');
    expect(html).not.toContain("/pay");
  });

  it("opens the newest scan's quick result, with what the browser saw as titles and no prices", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel checks={[row({ preview: quick }), row({ id: "c2", targetId: "t2", value: "shop.ng", preview: quick })]} />,
    );
    expect(html).toContain("No Content Security Policy");
    expect(html.match(/<details open=""/g)).toHaveLength(1);
    expect(html).toContain("See result");
    expect(html).not.toContain("coin");
  });

  it("confirms the fixes just unlocked", () => {
    const html = renderToStaticMarkup(
      <SecurityChecksPanel checks={[row({ status: "done", posted: true, findings: 3, unlocked: 3 })]} highlight={{ checkId: "c1", unlocked: 3 }} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("3 fixes unlocked.");
  });
});
