// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), scan: vi.fn(), add: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/actions/security-preview", () => ({ runPublicScan: mocks.scan }));
vi.mock("@/app/actions/security-assistant", () => ({ addSecurityAsset: mocks.add }));

import { PublicScan, SCAN_RESULT_SLOT } from "./public-scan";

const SUMMARY = {
  kind: "website" as const,
  target: "settle.ng",
  checkedAt: "2026-11-13T10:00:00.000Z",
  total: 1,
  counts: { critical: 0, high: 0, medium: 0, low: 1 },
  risk: "low" as const,
  areas: [{ area: "cookies" as const, label: "Cookies", problems: 1 }],
};

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  // The page's own slot below the header, where the result opens.
  const slot = document.createElement("div");
  slot.id = SCAN_RESULT_SLOT;
  document.body.appendChild(slot);
  mocks.scan.mockResolvedValue({ ok: true, summary: SUMMARY });
});

afterEach(() => {
  cleanup();
  document.getElementById(SCAN_RESULT_SLOT)?.remove();
  vi.resetAllMocks();
});

async function scanAndShow() {
  const user = userEvent.setup();
  render(<PublicScan signedIn />);
  await user.type(screen.getByLabelText("Your URL"), "settle.ng");
  await user.click(screen.getByRole("button", { name: "Scan" }));
  await user.click(await screen.findByRole("button", { name: /Show it.s yours/ }));
}

it("signed in, Show it's yours goes on into the app", async () => {
  mocks.add.mockResolvedValue({ kind: "go", reply: "", href: "/security/targets/t1/verify" });
  await scanAndShow();
  await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/security/targets/t1/verify"));
});

it("says why when the site can't be added, instead of doing nothing", async () => {
  mocks.add.mockResolvedValue({ kind: "error", error: "Only workspace owners and admins can add assets and start checks." });
  await scanAndShow();
  expect(await screen.findByRole("alert")).toHaveTextContent("Only workspace owners and admins can add assets");
  expect(mocks.push).not.toHaveBeenCalled();
});

it("shows the monthly limit too", async () => {
  mocks.add.mockResolvedValue({ kind: "reply", reply: "You've used this month's 3 scans. More start on 1 December." });
  await scanAndShow();
  expect(await screen.findByRole("alert")).toHaveTextContent("this month's 3 scans");
});
