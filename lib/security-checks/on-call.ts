import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ON_CALL_QUIET_AFTER_MS, isQuiet } from "@/lib/security-checks";

/**
 * On-call people (#on-call, 14 Nov plan): a person goes on call, not an agent.
 * Staff invite someone by email; they accept once signed in with that email.
 * Accepting sets `User.onCallAt` (and `User.securityClearedAt` when the invite
 * clears them). Every working agent they own then gets priority work.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export class OnCallError extends Error {
  constructor(
    readonly code: "invalid_email" | "already_on_call" | "already_invited" | "not_yours" | "not_pending",
    message: string,
  ) {
    super(message);
    this.name = "OnCallError";
  }
}

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Invites

/**
 * Staff invite a person by email. Refused for a bad address, a person already
 * on call (and already cleared when the invite would clear them), or one with a
 * pending invite. A person with an account gets an inbox note; one without
 * finds the invite when they sign up with that email.
 */
export async function inviteToOnCall(
  db: Db,
  input: { email: string; invitedById: string; clearForSecurity: boolean },
): Promise<{ inviteId: string }> {
  const email = normaliseEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OnCallError("invalid_email", "That doesn't look like an email address.");
  const person = await db.user.findUnique({ where: { email }, select: { id: true, onCallAt: true, securityClearedAt: true } });
  if (person?.onCallAt && (!input.clearForSecurity || person.securityClearedAt)) {
    throw new OnCallError("already_on_call", "That person is already on call.");
  }
  const pending = await db.onCallInvite.findFirst({ where: { email, status: "pending" }, select: { id: true } });
  if (pending) throw new OnCallError("already_invited", "That person already has a pending invite.");
  const invite = await db.onCallInvite.create({
    data: { email, invitedById: input.invitedById, clearForSecurity: input.clearForSecurity },
    select: { id: true },
  });
  if (person) {
    await db.notification.create({
      data: {
        userId: person.id,
        kind: "on_call_invite",
        title: `You're invited to go on call${input.clearForSecurity ? " and do security checks" : ""}`,
        url: "/agents/mine#on-call-invites",
      },
    });
  }
  return { inviteId: invite.id };
}

/** Staff withdraw a pending invite. */
export async function cancelOnCallInvite(db: Db, inviteId: string, now = new Date()): Promise<void> {
  const { count } = await db.onCallInvite.updateMany({
    where: { id: inviteId, status: "pending" },
    data: { status: "cancelled", respondedAt: now },
  });
  if (count !== 1) throw new OnCallError("not_pending", "That invite isn't pending any more.");
}

/**
 * The invited person accepts or declines, once. Accepting puts them on call, and
 * clears them for security checks when the invite says so. Only a signed-in
 * person whose account email is the invite's may answer.
 */
export async function respondToOnCallInvite(
  db: Db & Pick<PrismaClient, "$transaction">,
  input: { inviteId: string; userId: string; accept: boolean },
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const [invite, person] = await Promise.all([
      tx.onCallInvite.findUnique({ where: { id: input.inviteId }, select: { id: true, email: true, clearForSecurity: true } }),
      tx.user.findUnique({ where: { id: input.userId }, select: { email: true } }),
    ]);
    if (!invite || !person || normaliseEmail(person.email) !== invite.email) throw new OnCallError("not_yours", "That invite isn't for you.");
    const { count } = await tx.onCallInvite.updateMany({
      where: { id: invite.id, status: "pending" },
      data: { status: input.accept ? "accepted" : "declined", respondedAt: now },
    });
    if (count !== 1) throw new OnCallError("not_pending", "That invite was already answered or withdrawn.");
    if (!input.accept) return;
    await tx.user.update({
      where: { id: input.userId },
      data: { onCallAt: now, ...(invite.clearForSecurity ? { securityClearedAt: now } : {}) },
    });
  });
}

/** Pending invites for one person, by their account email, newest first, for My agents. */
export async function pendingInvitesFor(userId: string, db: Db = prisma) {
  const person = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!person) return [];
  return db.onCallInvite.findMany({
    where: { status: "pending", email: normaliseEmail(person.email) },
    orderBy: { createdAt: "desc" },
    select: { id: true, clearForSecurity: true, createdAt: true },
  });
}

/** Pending invites across the site, for the staff page. */
export async function pendingInvites(db: Db = prisma) {
  return db.onCallInvite.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, clearForSecurity: true, createdAt: true, invitedBy: { select: { name: true } } },
  });
}

/** Staff take a person off call. Their security clearance is separate and stays. */
export async function removeFromOnCall(db: Db, userId: string): Promise<void> {
  await db.user.updateMany({ where: { id: userId }, data: { onCallAt: null } });
}

/** Staff grant or take away a person's site-wide security clearance. */
export async function setSecurityClearance(db: Db, userId: string, cleared: boolean, now = new Date()): Promise<void> {
  await db.user.updateMany({ where: { id: userId }, data: { securityClearedAt: cleared ? now : null } });
}

// ---------------------------------------------------------------------------
// The on-call list

export type OnCallState = "Online" | "Quiet" | "Paused" | "No agents";

/** The on-call people for the staff page: state of their best agent, open work and guest stays. */
export async function listOnCallPeople(now = new Date(), db: Db = prisma) {
  const people = await db.user.findMany({
    where: { onCallAt: { not: null } },
    orderBy: { onCallAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      securityClearedAt: true,
      onCallAt: true,
      agents: {
        where: { revokedAt: null },
        select: {
          pausedAt: true,
          apiKeys: { where: { revokedAt: null }, select: { lastUsedAt: true } },
          activations: { where: { guest: true, guestEndedAt: null, deactivatedAt: null }, select: { id: true } },
          _count: { select: { securityCheckItems: { where: { status: "checking" } } } },
        },
      },
    },
  });
  return people.map((person) => {
    const working = person.agents.filter((agent) => agent.pausedAt === null);
    const lastSeen = working
      .flatMap((agent) => agent.apiKeys.map((key) => key.lastUsedAt))
      .reduce<Date | null>((latest, seen) => (seen && (!latest || seen > latest) ? seen : latest), null);
    const state: OnCallState =
      person.agents.length === 0 ? "No agents" : working.length === 0 ? "Paused" : isQuiet(lastSeen, now) ? "Quiet" : "Online";
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      state,
      lastSeen,
      cleared: person.securityClearedAt !== null,
      onCallSince: person.onCallAt,
      agentCount: person.agents.length,
      openParts: person.agents.reduce((sum, agent) => sum + agent._count.securityCheckItems, 0),
      guestWorkspaces: person.agents.reduce((sum, agent) => sum + agent.activations.length, 0),
    };
  });
}

// ---------------------------------------------------------------------------
// The call log

/** The log looks back this far, and shows at most this many lines. */
export const CALL_LOG_WINDOW_MS = 48 * 60 * 60 * 1000;
export const CALL_LOG_LINES = 40;

export type CallLogLine = {
  kind: "security_part" | "guest_request";
  at: Date;
  /** What was needed, in plain words. */
  what: string;
  /** The person who picked it up; null when nobody has. */
  pickedUpBy: string | null;
  /** How long it took, in ms; null when nobody has picked it up. */
  waitMs: number | null;
  /** Nobody picked it up within ON_CALL_QUIET_AFTER_MS. */
  missed: boolean;
};

/** Pure: turns the rows into log lines, newest first. */
export function buildCallLog(
  parts: ReadonlyArray<{ createdAt: Date; assignedAt: Date | null; title: string; agent: { owner: { name: string | null; email: string } } | null }>,
  guests: ReadonlyArray<{ createdAt: Date; organisation: { name: string }; agent: { owner: { name: string | null; email: string } } }>,
  now = new Date(),
): CallLogLine[] {
  const lines: CallLogLine[] = [];
  for (const part of parts) {
    const picked = part.assignedAt !== null && part.agent !== null;
    lines.push({
      kind: "security_part",
      at: part.createdAt,
      what: `Security check part: ${part.title}`,
      pickedUpBy: picked ? (part.agent!.owner.name ?? part.agent!.owner.email) : null,
      waitMs: picked ? Math.max(0, part.assignedAt!.getTime() - part.createdAt.getTime()) : null,
      missed: !picked && now.getTime() - part.createdAt.getTime() >= ON_CALL_QUIET_AFTER_MS,
    });
  }
  for (const guest of guests) {
    lines.push({
      kind: "guest_request",
      at: guest.createdAt,
      what: `New workspace: ${guest.organisation.name}`,
      pickedUpBy: guest.agent.owner.name ?? guest.agent.owner.email,
      // A guest is added the moment the workspace is created.
      waitMs: 0,
      missed: false,
    });
  }
  return lines.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, CALL_LOG_LINES);
}

/** The call log for the staff page: security parts and guest requests of the last 48 hours. */
export async function onCallLog(now = new Date(), db: Db = prisma): Promise<CallLogLine[]> {
  const since = new Date(now.getTime() - CALL_LOG_WINDOW_MS);
  const owner = { select: { owner: { select: { name: true, email: true } } } } as const;
  const [parts, guests] = await Promise.all([
    db.securityCheckItem.findMany({
      where: { kind: "check", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: CALL_LOG_LINES,
      select: { createdAt: true, assignedAt: true, title: true, agent: owner },
    }),
    db.agentActivation.findMany({
      where: { guest: true, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: CALL_LOG_LINES,
      select: { createdAt: true, organisation: { select: { name: true } }, agent: owner },
    }),
  ]);
  return buildCallLog(parts, guests, now);
}
