/**
 * Local scenario for the My stakes page (#my-stakes): the Demo owner's agents
 * with a stake in every state, so /stakes can be seen and worked on locally.
 *
 *   pnpm db:fixtures              # first, once: the Demo organisation and its people
 *   pnpm db:scenario:my-stakes    # then; rerun it to start the clocks again
 *
 * Sign in as demo@fixtures.local / ziki-demo-password and open /stakes.
 *
 * It adds two projects to the Demo organisation, Stakes Lab and Idea Lab, with
 * their own issues and ideas (the database numbers them in the organisation),
 * and these stakes:
 *
 * - "Search box loses focus…": Demo Builder's stake, uncountered (Winning).
 * - "Exported CSV drops the last row": Demo Lead's stake, countered by Amara's
 *   Claude, in a vote 2 to 1 (Countered · in vote), its refresh due in under a minute.
 * - "Webhook retries ignore…": Demo Builder's stake that won: the claim and the issue In progress.
 * - "Dark mode badge contrast…": Demo Lead's stake, outvoted by Chen's (Lost).
 * - "Rate limit header…": not refreshed in time (Expired); "Draft autosave…": withdrawn (Dropped).
 * - "Notification bell count…": Dara's live stake, which the Demo owner must not see.
 * - Idea Lab, "Let agents pin a note…": Demo Builder's stake waiting for the idea
 *   to convert (Pending); "Weekly digest…": a stake whose 24 hours ran out (Expired).
 *
 * So the Demo owner uses 2 of 2 open stakes and 1 of 2 in progress in Stakes
 * Lab, and 1 of 2 open stakes in Idea Lab (the projects' default caps).
 * Nothing refreshes these stakes and no cron runs locally, so within about five
 * minutes the live ones show as missing their refresh ("settling").
 *
 * Additive only (AGENTS.md: never reseed): it touches nothing but its own rows,
 * fixed ids `scn-ms-*`. A rerun deletes and recreates its two projects and
 * everything on them. It refuses to run against anything but a local database.
 */
import { PrismaClient } from "@prisma/client";

const ORGANISATION_ID = "fx-organisation";
const P = "scn-ms";
const LAB = `${P}-project-lab`;
const IDEAS = `${P}-project-ideas`;

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

const PEOPLE = ["demo", "amara", "bayo", "chen", "dara"] as const;
type Person = (typeof PEOPLE)[number];

const AGENTS = {
  demoBuilder: "fx-agent-demo-w",
  demoLead: "fx-agent-demo-m",
  amara: "fx-agent-amara-w",
  bayo: "fx-agent-bayo-w",
  chen: "fx-agent-chen-w",
  dara: "fx-agent-dara-w",
} as const;

const ISSUES = [
  { key: "winning", title: "Search box loses focus after the first result loads" },
  { key: "contest", title: "Exported CSV drops the last row" },
  { key: "won", title: "Webhook retries ignore the backoff header" },
  { key: "lost", title: "Dark mode badge contrast is too low" },
  { key: "expired", title: "Rate limit header shows seconds as minutes" },
  { key: "withdrawn", title: "Draft autosave fires twice" },
  { key: "others", title: "Notification bell count lags behind" },
] as const;

const IDEA_ROWS = [
  { key: "pending", title: "Let agents pin a note to an issue" },
  { key: "timeout", title: "Weekly digest of stalled issues" },
] as const;

const plan = (what: string) => ({
  summary: `I'll ${what}, with a test that fails before the fix.`,
  description: `## Plan\n\n1. Reproduce it locally and write a failing test.\n2. ${what[0].toUpperCase()}${what.slice(1)}.\n3. Check the 375 px layout and both themes, then open a small pull request.`,
});

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  try {
    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms);
    const from = (date: Date, ms: number) => new Date(date.getTime() + ms);

    const organisation = await db.organisation.findUnique({ where: { id: ORGANISATION_ID }, select: { slug: true } });
    if (!organisation) throw new Error("The Demo organisation isn't loaded. Run `pnpm db:fixtures` first.");
    const found = await db.user.findMany({ where: { email: { in: PEOPLE.map((key) => `${key}@fixtures.local`) } }, select: { id: true, email: true } });
    const user = new Map(found.map((row) => [row.email.split("@")[0] as Person, row.id]));
    for (const key of PEOPLE) if (!user.has(key)) throw new Error(`${key}@fixtures.local is missing. Run \`pnpm db:fixtures\` first.`);
    const id = (key: Person) => user.get(key)!;

    // Replace this scenario's own rows only.
    const projectIds = [LAB, IDEAS];
    const oldBugs = await db.bug.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
    const bugIds = oldBugs.map((bug) => bug.id);
    await db.stakeVote.deleteMany({ where: { bugId: { in: bugIds } } });
    await db.issueStake.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.issueClaim.deleteMany({ where: { bugId: { in: bugIds } } });
    await db.bug.deleteMany({ where: { id: { in: bugIds } } });
    await db.idea.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });

    await db.project.create({
      data: { id: LAB, organisationId: ORGANISATION_ID, slug: "stakes-lab", name: "Stakes Lab", repoUrl: "https://github.com/example/stakes-lab", workflow: { create: {} } },
    });
    await db.project.create({
      data: { id: IDEAS, organisationId: ORGANISATION_ID, slug: "idea-lab", name: "Idea Lab", repoUrl: "https://github.com/example/idea-lab", workflow: { create: {} } },
    });

    const held: Record<string, Person> = { won: "demo", lost: "chen" };
    for (const issue of ISSUES) {
      const holder = held[issue.key];
      await db.bug.create({
        data: {
          id: `${P}-bug-${issue.key}`,
          title: issue.title,
          summary: `${issue.title}.`,
          description: `## Summary\n\n${issue.title}.\n\n## Acceptance criteria\n\n- [ ] Fixed, with a test.`,
          organisationId: ORGANISATION_ID,
          projectId: LAB,
          reporterId: id("dara"),
          beneficiaryUserId: id("dara"),
          status: holder ? "in_progress" : "open",
          substatus: holder ? "in_progress" : "open",
          assigneeId: holder ? id(holder) : null,
          createdAt: ago(3 * 24 * HOUR),
        },
      });
    }
    for (const idea of IDEA_ROWS) {
      await db.idea.create({
        data: {
          id: `${P}-idea-${idea.key}`,
          title: idea.title,
          summary: `${idea.title}.`,
          description: `## Summary\n\n${idea.title}.`,
          organisationId: ORGANISATION_ID,
          projectId: IDEAS,
          reporterId: id("bayo"),
          beneficiaryUserId: id("bayo"),
          status: "open",
          createdAt: ago(2 * 24 * HOUR),
        },
      });
    }

    const bug = (key: (typeof ISSUES)[number]["key"]) => `${P}-bug-${key}`;
    const onLab = { organisationId: ORGANISATION_ID, projectId: LAB };

    // Winning: uncountered, its window running, refreshed 1.5 minutes ago.
    const winningAt = ago(4 * MIN);
    await db.issueStake.create({
      data: {
        id: `${P}-stake-winning`, ...onLab, bugId: bug("winning"), agentId: AGENTS.demoBuilder, beneficiaryUserId: id("demo"),
        ...plan("keep focus in the search box while results stream in"), status: "open",
        createdAt: winningAt, lastRefreshAt: ago(90 * SEC), windowEndsAt: from(winningAt, 10 * MIN),
      },
    });

    // In a vote: Demo Lead staked first, Amara's Claude countered; 2 votes to 1; Demo Lead's refresh is due in 45 seconds.
    const counteredAt = ago(2 * MIN);
    const contestEndsAt = from(counteredAt, 30 * MIN);
    await db.issueStake.create({
      data: {
        id: `${P}-stake-contest-mine`, ...onLab, bugId: bug("contest"), agentId: AGENTS.demoLead, beneficiaryUserId: id("demo"),
        ...plan("write the last row before closing the CSV stream"), status: "contested",
        createdAt: ago(6 * MIN), lastRefreshAt: ago(4 * MIN + 15 * SEC), windowEndsAt: from(ago(6 * MIN), 10 * MIN), contestEndsAt,
      },
    });
    await db.issueStake.create({
      data: {
        id: `${P}-stake-contest-rival`, ...onLab, bugId: bug("contest"), agentId: AGENTS.amara, beneficiaryUserId: id("amara"),
        summary: "I'll switch the export to the streaming CSV writer, which flushes on end, and add a regression test.",
        description: "## Plan\n\n1. Replace the hand-rolled join with the streaming writer.\n2. Flush on `end`, so the last row is written.\n3. Test a one-row and a ten-thousand-row export.",
        status: "contested", createdAt: counteredAt, lastRefreshAt: ago(30 * SEC), contestEndsAt,
      },
    });
    await db.stakeVote.createMany({
      data: [
        { id: `${P}-vote-bayo`, stakeId: `${P}-stake-contest-mine`, bugId: bug("contest"), onBehalfOfUserId: id("bayo"), agentId: AGENTS.bayo, weight: 1 },
        { id: `${P}-vote-chen`, stakeId: `${P}-stake-contest-mine`, bugId: bug("contest"), onBehalfOfUserId: id("chen"), agentId: AGENTS.chen, weight: 1 },
        { id: `${P}-vote-dara`, stakeId: `${P}-stake-contest-rival`, bugId: bug("contest"), onBehalfOfUserId: id("dara"), agentId: AGENTS.dara, weight: 1 },
      ],
    });

    // Won: uncountered for 10 minutes, so Demo Builder holds the issue (an active claim, In progress).
    const wonAt = ago(2 * HOUR + 50 * MIN);
    const wonClaim = await db.issueClaim.create({
      data: {
        id: `${P}-claim-won`, bugId: bug("won"), beneficiaryUserId: id("demo"), agentId: AGENTS.demoBuilder, status: "active",
        createdAt: wonAt, claimedAt: wonAt, lastHeartbeatAt: ago(5 * MIN), deliverBy: from(wonAt, 4 * HOUR),
      },
    });
    await db.issueStake.create({
      data: {
        id: `${P}-stake-won`, ...onLab, bugId: bug("won"), agentId: AGENTS.demoBuilder, beneficiaryUserId: id("demo"),
        ...plan("honour Retry-After before each webhook retry"), status: "won", resolution: "won", claimId: wonClaim.id,
        createdAt: from(wonAt, -10 * MIN), lastRefreshAt: from(wonAt, -2 * MIN), windowEndsAt: wonAt, resolvedAt: wonAt,
      },
    });

    // Lost: Chen's stake won the vote and holds the issue.
    const lostAt = ago(23 * HOUR);
    const chenClaim = await db.issueClaim.create({
      data: {
        id: `${P}-claim-lost`, bugId: bug("lost"), beneficiaryUserId: id("chen"), agentId: AGENTS.chen, status: "active",
        createdAt: lostAt, claimedAt: lostAt, lastHeartbeatAt: ago(10 * MIN), deliverBy: from(lostAt, 48 * HOUR),
      },
    });
    await db.issueStake.create({
      data: {
        id: `${P}-stake-lost-chen`, ...onLab, bugId: bug("lost"), agentId: AGENTS.chen, beneficiaryUserId: id("chen"),
        ...plan("raise the badge colours to 4.5:1 in both themes"), status: "won", resolution: "won_vote", claimId: chenClaim.id,
        createdAt: from(lostAt, -40 * MIN), lastRefreshAt: from(lostAt, -1 * MIN), contestEndsAt: lostAt, resolvedAt: lostAt,
      },
    });
    await db.issueStake.create({
      data: {
        id: `${P}-stake-lost`, ...onLab, bugId: bug("lost"), agentId: AGENTS.demoLead, beneficiaryUserId: id("demo"),
        ...plan("use the contrast tokens for every badge"), status: "lost", resolution: "outvoted",
        createdAt: from(lostAt, -32 * MIN), lastRefreshAt: from(lostAt, -2 * MIN), contestEndsAt: lostAt, resolvedAt: lostAt,
      },
    });

    // Expired: not refreshed within 5 minutes. Dropped: the agent took it back.
    const expiredAt = ago(4 * HOUR + 54 * MIN);
    await db.issueStake.create({
      data: {
        id: `${P}-stake-expired`, ...onLab, bugId: bug("expired"), agentId: AGENTS.demoBuilder, beneficiaryUserId: id("demo"),
        ...plan("format the reset header in seconds"), status: "dropped", resolution: "no_refresh",
        createdAt: from(expiredAt, -6 * MIN), lastRefreshAt: from(expiredAt, -6 * MIN), windowEndsAt: from(expiredAt, 4 * MIN), resolvedAt: expiredAt,
      },
    });
    const withdrawnAt = ago(47 * HOUR);
    await db.issueStake.create({
      data: {
        id: `${P}-stake-withdrawn`, ...onLab, bugId: bug("withdrawn"), agentId: AGENTS.demoLead, beneficiaryUserId: id("demo"),
        ...plan("debounce the autosave and key it by draft"), status: "dropped", resolution: "withdrawn",
        createdAt: from(withdrawnAt, -3 * MIN), lastRefreshAt: from(withdrawnAt, -3 * MIN), windowEndsAt: from(withdrawnAt, 7 * MIN), resolvedAt: withdrawnAt,
      },
    });

    // Someone else's live stake: not the Demo owner's, so My stakes never shows it.
    await db.issueStake.create({
      data: {
        id: `${P}-stake-others`, ...onLab, bugId: bug("others"), agentId: AGENTS.dara, beneficiaryUserId: id("dara"),
        ...plan("refresh the bell count from the event stream"), status: "open",
        createdAt: ago(1 * MIN), lastRefreshAt: ago(1 * MIN), windowEndsAt: from(ago(1 * MIN), 10 * MIN),
      },
    });

    // Idea Lab: a stake waiting for its idea to convert, and one whose 24 hours ran out.
    const onIdeas = { organisationId: ORGANISATION_ID, projectId: IDEAS };
    const pendingAt = ago(2 * HOUR);
    await db.issueStake.create({
      data: {
        id: `${P}-stake-pending`, ...onIdeas, ideaId: `${P}-idea-pending`, agentId: AGENTS.demoBuilder, beneficiaryUserId: id("demo"),
        ...plan("add a pinned note to the issue page and the agent API"), status: "waiting",
        createdAt: pendingAt, lastRefreshAt: pendingAt, expiresAt: from(pendingAt, 24 * HOUR),
      },
    });
    const timeoutPlaced = ago(26 * HOUR);
    await db.issueStake.create({
      data: {
        id: `${P}-stake-timeout`, ...onIdeas, ideaId: `${P}-idea-timeout`, agentId: AGENTS.demoLead, beneficiaryUserId: id("demo"),
        ...plan("send a weekly email of issues with no activity"), status: "dropped", resolution: "idea_timeout",
        createdAt: timeoutPlaced, lastRefreshAt: timeoutPlaced, expiresAt: from(timeoutPlaced, 24 * HOUR), resolvedAt: from(timeoutPlaced, 24 * HOUR),
      },
    });

    console.log(
      `[scenario] My stakes: 9 stakes for the Demo owner in Stakes Lab and Idea Lab (organisation "${organisation.slug}"). ` +
        "Sign in as demo@fixtures.local / ziki-demo-password and open /stakes. Rerun to restart the clocks.",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
