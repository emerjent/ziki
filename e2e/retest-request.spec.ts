import { e2eDb } from "./db";
import { expect, test, expectNoHorizontalScroll } from "./fixtures";
import { emailFor } from "./users";

test("requests a retest on a Live issue and keeps its workflow and payout history", async ({ page, width }) => {
  const prisma = e2eDb();
  const liveIssues = await prisma.bug.findMany({
    where: {
      organisationId: "fx-organisation",
      status: "resolved",
      claims: { some: {} },
      deliveries: { some: {} },
      testVerdicts: { some: {} },
      mergeReviews: { some: {} },
    },
    orderBy: { number: "asc" },
    select: { id: true, number: true, title: true, status: true, substatus: true, reporterId: true, heldPayout: true, payoutReleasedAt: true },
  });
  const issue = liveIssues[width === "mobile" ? 1 : 0];
  if (!issue) throw new Error("The Demo E2E fixtures need two Live issues with complete review history.");
  const requester = await prisma.user.findUniqueOrThrow({ where: { email: emailFor("user", width) }, select: { id: true } });
  // `e2e:seed` makes the test accounts members of Zedu, but not Demo. Add only
  // this requester to the fixture tenant so the issue route and workspace
  // switch exercised below behave consistently in CI and local runs.
  await prisma.membership.createMany({
    data: [{ organisationId: "fx-organisation", userId: requester.id, role: "member" }],
    skipDuplicates: true,
  });

  const snapshot = async () => prisma.bug.findUniqueOrThrow({
    where: { id: issue.id },
    select: {
      status: true,
      substatus: true,
      assigneeId: true,
      heldPayout: true,
      payoutReleasedAt: true,
      claims: { orderBy: { id: "asc" }, select: { id: true, status: true, claimedAt: true, releasedAt: true, releaseReason: true } },
      deliveries: { orderBy: { id: "asc" }, select: { id: true, updatedAt: true, pullRequestUrl: true } },
      testVerdicts: { orderBy: { id: "asc" }, select: { id: true, goodToMerge: true, updatedAt: true } },
      mergeReviews: { orderBy: { id: "asc" }, select: { id: true, verdict: true, updatedAt: true } },
      pointEntries: { orderBy: { id: "asc" }, select: { id: true, role: true, points: true, sourceKey: true, correctedAt: true } },
    },
  });

  try {
    expect(issue.status).toBe("resolved");
    const before = JSON.parse(JSON.stringify(await snapshot())) as unknown;
    expect(await prisma.issueClaim.count({ where: { bugId: issue.id } })).toBeGreaterThan(0);
    expect(await prisma.delivery.count({ where: { bugId: issue.id } })).toBeGreaterThan(0);
    expect(await prisma.testVerdict.count({ where: { bugId: issue.id } })).toBeGreaterThan(0);
    expect(await prisma.mergeReview.count({ where: { bugId: issue.id } })).toBeGreaterThan(0);

    const previousRequests = await prisma.comment.count({ where: { bugId: issue.id, authorId: requester.id, body: { startsWith: "Retest request" } } });
    await page.goto("/demo/demo/1");
    const switchWorkspace = page.getByRole("button", { name: /Switch to Demo and open #\d+/ });
    if (await switchWorkspace.isVisible()) {
      await switchWorkspace.click();
      await expect(page.getByRole("heading", { name: "This issue is in the Demo workspace" })).toHaveCount(0);
    }
    await expect(page).toHaveURL(/\/demo\/demo\/1$/);
    await expect(page.getByRole("button", { name: "Still having this problem?" })).toHaveCount(0);

    await page.goto(`/demo/demo/${issue.number}`);
    await expect(page.getByRole("heading", { name: issue.title })).toBeVisible();
    const trigger = page.getByRole("button", { name: "Still having this problem?" });
    await expect(trigger).toBeVisible();
    await expectNoHorizontalScroll(page);

    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Still having this problem?" });
    await expect(dialog).toBeVisible();
    const details = dialog.getByLabel("Describe what happens now");
    await expect(details).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByLabel("Operating system").selectOption("Not sure");
    await dialog.getByLabel("Installed app version").fill("");
    await details.fill("The save action still fails after I restart the app and try again.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await expect(dialog.getByLabel("Operating system")).toHaveValue("Not sure");
    await expect(details).toHaveValue("The save action still fails after I restart the app and try again.");
    await expect(dialog.getByText(/Release details aren't linked to this issue yet/)).toBeVisible();
    await expect(dialog.getByText(/can't compare versions or provide an update link/)).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "retest-evidence.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("The failing save action remains visible after restart."),
    });
    await expect(dialog.getByText("retest-evidence.txt")).toBeVisible();
    await expect(dialog.getByText("54 B")).toBeVisible();
    await page.screenshot({ path: `test-results/retest-request-${width}.png` });

    // First fail the action request at the network boundary; the filled form and
    // already uploaded file must remain available for retry.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await dialog.getByRole("button", { name: "Request a retest" }).click();
    await expect(dialog.getByRole("alert")).toContainText("We couldn't save your request");
    await expect(details).toHaveValue("The save action still fails after I restart the app and try again.");
    await expect(dialog.getByText("retest-evidence.txt")).toBeVisible();
    await page.unroute("**/*");

    // Hold the server action briefly so pending protection and a second click
    // are exercised while the first request is still in flight.
    let releaseRequest!: () => void;
    let interceptedRequest!: () => void;
    const intercepted = new Promise<void>((resolve) => { interceptedRequest = resolve; });
    const waiting = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let held = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!held && request.method() === "POST" && request.headers()["next-action"]) {
        held = true;
        interceptedRequest();
        await waiting;
      }
      await route.continue();
    });
    try {
      await dialog.getByRole("button", { name: "Request a retest" }).click();
      await intercepted;
      const sending = dialog.getByRole("button", { name: "Sending…" });
      await expect(sending).toBeDisabled();
      await sending.evaluate((button) => (button as HTMLButtonElement).click());
      releaseRequest();
      await expect(page.locator('[role="status"]').filter({ hasText: "Retest requested" })).toBeVisible();
    } finally {
      releaseRequest();
      await page.unroute("**/*");
    }

    const saved = await prisma.comment.findFirstOrThrow({
      where: { bugId: issue.id, authorId: requester.id, body: { startsWith: "Retest request" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, body: true, attachments: { select: { id: true, filename: true, bugId: true, commentId: true, uploaderId: true } } },
    });
    expect(saved.body).toContain("Operating system: Not sure");
    expect(saved.body).toContain("Installed version: Unknown");
    expect(saved.body).toContain("Release information: No fixed version or update link is connected to this issue yet.");
    expect(saved.body).toContain("The save action still fails after I restart the app and try again.");
    expect(saved.attachments).toHaveLength(1);
    expect(saved.attachments[0]).toMatchObject({ filename: "retest-evidence.txt", bugId: issue.id, commentId: saved.id, uploaderId: requester.id });
    expect(await prisma.comment.count({ where: { bugId: issue.id, authorId: requester.id, body: { startsWith: "Retest request" } } })).toBe(previousRequests + 1);

    const requestLink = page.getByRole("link", { name: "View request" });
    await expect(requestLink).toHaveAttribute("href", `/demo/demo/${issue.number}#comment-${saved.id}`);
    await requestLink.click();
    await expect(page).toHaveURL(new RegExp(`#comment-${saved.id}$`));
    await page.reload();
    const persistedComment = page.locator(`#comment-${saved.id}`);
    await expect(persistedComment.getByText("Installed version: Unknown")).toBeVisible();
    await expect(persistedComment.getByText("The save action still fails after I restart the app and try again.")).toBeVisible();
    await expect(persistedComment.getByText("retest-evidence.txt")).toBeVisible();

    const after = JSON.parse(JSON.stringify(await snapshot())) as unknown;
    expect(after).toEqual(before);

    await expect.poll(async () => prisma.notification.findFirst({
      where: { bugId: issue.id, userId: issue.reporterId, kind: "comment_added", url: { contains: saved.id } },
      select: { id: true },
    }), { timeout: 15_000 }).not.toBeNull();
    await expect.poll(async () => {
      const events = await prisma.agentEvent.findMany({ where: { bugId: issue.id, type: "comment.created" }, orderBy: { createdAt: "desc" }, take: 10, select: { payload: true } });
      return events.some((event) => (event.payload as { commentId?: string }).commentId === saved.id);
    }, { timeout: 10_000 }).toBe(true);
  } finally {
    await prisma.$disconnect();
  }
});
