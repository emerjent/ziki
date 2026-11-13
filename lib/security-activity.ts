import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const LIMIT = 100;
const findingSelect = { id: true, title: true } as const;

export async function loadSecurityActivity(viewer: { organisationId: string; userId: string; admin: boolean }) {
  const visible: Prisma.SecurityFindingWhereInput = {
    organisationId: viewer.organisationId,
    AND: [
      { OR: [{ bug: { isDeleted: false } }, { bugId: null, idea: { isDeleted: false } }] },
      ...(viewer.admin ? [] : [{ OR: [{ reporterId: viewer.userId }, { disclosedAt: { not: null } }] }]),
    ],
  };
  const issue = { securityFinding: { is: visible }, isDeleted: false };
  const [reports, confirmations, assignments, verifications, disclosures] = await Promise.all([
    prisma.securityFinding.findMany({
      where: visible, take: LIMIT, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        ...findingSelect, createdAt: true, reporter: { select: { name: true } },
        idea: { select: { createdByAgent: { select: { name: true } } } },
      },
    }),
    prisma.issueConfirmation.findMany({
      where: { bug: issue, verdict: "confirm", undoneAt: null }, take: LIMIT,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true, updatedAt: true, agent: { select: { name: true } }, onBehalfOf: { select: { name: true } },
        bug: { select: { securityFinding: { select: findingSelect } } },
      },
    }),
    prisma.bugActivity.findMany({
      where: { bug: issue, type: "assignee_changed" }, take: LIMIT, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true, actor: { select: { name: true } }, bug: { select: { securityFinding: { select: findingSelect } } } },
    }),
    prisma.securityVerification.findMany({
      where: { finding: visible }, take: LIMIT, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true, passed: true, reopened: true, reviewer: { select: { name: true } }, finding: { select: findingSelect } },
    }),
    prisma.securityFinding.findMany({
      where: { ...visible, disclosedAt: { not: null } }, take: LIMIT, orderBy: [{ disclosedAt: "desc" }, { id: "desc" }],
      select: { ...findingSelect, disclosedAt: true, disclosedById: true },
    }),
  ]);
  const publisherIds = [...new Set(disclosures.flatMap((row) => row.disclosedById ? [row.disclosedById] : []))];
  const publishers = publisherIds.length
    ? await prisma.user.findMany({ where: { id: { in: publisherIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(publishers.map((person) => [person.id, person.name]));

  return [
    ...reports.map((row) => ({
      id: "reported-" + row.id, finding: row, date: row.createdAt, action: "Submitted a finding",
      actor: row.idea?.createdByAgent?.name ?? row.reporter.name, kind: row.idea?.createdByAgent ? "Agent" : "Person",
    })),
    ...confirmations.map((row) => ({
      id: "confirmed-" + row.id, finding: row.bug.securityFinding, date: row.updatedAt, action: "Confirmed a finding",
      actor: row.agent?.name ?? row.onBehalfOf.name, kind: row.agent ? "Agent" : "Person",
    })),
    ...assignments.map((row) => ({
      id: "assigned-" + row.id, finding: row.bug.securityFinding, date: row.createdAt, action: "Changed the assignment",
      actor: row.actor.name, kind: "Person",
    })),
    ...verifications.map((row) => ({
      id: "verified-" + row.id, finding: row.finding, date: row.createdAt,
      action: row.passed ? "Verified a fix" : row.reopened ? "Failed verification and reopened the issue" : "Recorded a failed verification",
      actor: row.reviewer?.name ?? "Former member", kind: "Person",
    })),
    ...disclosures.flatMap((row) => row.disclosedAt ? [{
      id: "disclosed-" + row.id, finding: row, date: row.disclosedAt, action: "Disclosed a finding",
      actor: row.disclosedById ? names.get(row.disclosedById) ?? "Former member" : "Ziki",
      kind: row.disclosedById ? "Person" : "System",
    }] : []),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id)).slice(0, LIMIT);
}
