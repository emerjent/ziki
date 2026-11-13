"use server";

import { requireProject, type ProjectContext } from "@/lib/project-route";
import type { ProjectRef } from "@/lib/project-paths";
import type { LibraryResult, LibraryDeliveryStatus } from "@/components/marketing/library/model";
import { readLibrary } from "./data";
import { prisma } from "@/lib/prisma";
import { verifyPublishedUrls } from "@/lib/marketing/verify-url";
import { Prisma } from "@prisma/client";

function canReadProjectDeliveries(context: ProjectContext): boolean {
  if (context.user.role === "super_admin" || context.isOrgAdmin) return true;
  if (context.isProjectMember) return true;
  if (context.project.visibility === "public") return true;
  return false;
}

function canModifyProjectDeliveries(context: ProjectContext): boolean {
  if (context.user.role === "super_admin" || context.isOrgAdmin) return true;
  if (context.isProjectMember) return true;
  if (context.project.visibility === "public" && context.isOrgMember) return true;
  return false;
}

export async function refreshLibrary(slug: ProjectRef): Promise<LibraryResult> {
  // Access failures must remain redirects/404s, never be disguised as an empty collection.
  const [org, project] = slug.split("/");
  const context = await requireProject(org, project);
  if (!canReadProjectDeliveries(context)) {
    return { ok: false };
  }
  try {
    return { ok: true, items: await readLibrary(context) };
  } catch (error) {
    console.error("[library] Failed to read published marketing deliveries", error);
    return { ok: false };
  }
}

export type ToggleImplementationResult =
  | {
      ok: true;
      deliveryStatus: LibraryDeliveryStatus;
      implementedAt: string | null;
      implementedByName: string | null;
    }
  | { ok: false; error: string };

export async function toggleDeliveryImplementedAction(
  slug: ProjectRef,
  deliveryId: string,
  implemented: boolean,
): Promise<ToggleImplementationResult> {
  const [org, project] = slug.split("/");
  const context = await requireProject(org, project);

  if (!canModifyProjectDeliveries(context)) {
    return { ok: false, error: "Only project members or organisation administrators can update implementation status in a private project." };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Row lock on Delivery
      await tx.$queryRaw`SELECT "id" FROM "Delivery" WHERE "id" = ${deliveryId} FOR UPDATE`;

      const delivery = await tx.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          bug: {
            select: { id: true, projectId: true, organisationId: true, track: true },
          },
        },
      });

      if (!delivery || delivery.bug.projectId !== context.project.id || delivery.bug.organisationId !== context.organisationId) {
        throw new Error("Delivery not found in this project.");
      }

      if (delivery.bug.track !== "marketing") {
        throw new Error("Implementation tracking is only supported for marketing deliveries.");
      }

      if (implemented) {
        const previousStatus = delivery.deliveryStatus === "implemented" ? delivery.previousStatus : delivery.deliveryStatus;
        const now = new Date();
        const res = await tx.delivery.update({
          where: { id: deliveryId },
          data: {
            deliveryStatus: "implemented",
            previousStatus: previousStatus ?? "ready_to_use",
            implementedAt: now,
            implementedById: context.user.id,
          },
          select: {
            id: true,
            deliveryStatus: true,
            implementedAt: true,
          },
        });

        await tx.bugActivity.create({
          data: {
            bugId: delivery.bug.id,
            actorId: context.user.id,
            type: "status_changed",
            summary: `Marketing deliverable marked as implemented by ${context.user.name || context.user.email || "team member"}`,
            metadata: {
              field: "deliveryStatus",
              from: delivery.deliveryStatus,
              to: "implemented",
              deliveryId: delivery.id,
            },
          },
        });

        return {
          deliveryStatus: res.deliveryStatus as LibraryDeliveryStatus,
          implementedAt: res.implementedAt?.toISOString() ?? null,
          implementedByName: context.user.name || context.user.email || "Team member",
        };
      } else {
        const restoredStatus = delivery.previousStatus ?? "ready_to_use";
        const res = await tx.delivery.update({
          where: { id: deliveryId },
          data: {
            deliveryStatus: restoredStatus,
            previousStatus: null,
            implementedAt: null,
            implementedById: null,
          },
          select: {
            id: true,
            deliveryStatus: true,
          },
        });

        await tx.bugActivity.create({
          data: {
            bugId: delivery.bug.id,
            actorId: context.user.id,
            type: "status_changed",
            summary: `Marketing deliverable implementation status reverted by ${context.user.name || context.user.email || "team member"}`,
            metadata: {
              field: "deliveryStatus",
              from: "implemented",
              to: restoredStatus,
              deliveryId: delivery.id,
            },
          },
        });

        return {
          deliveryStatus: res.deliveryStatus as LibraryDeliveryStatus,
          implementedAt: null,
          implementedByName: null,
        };
      }
    });

    return { ok: true, ...updated };
  } catch (err) {
    console.error("[library] toggleDeliveryImplementedAction error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update implementation status." };
  }
}

export async function retryUrlVerificationAction(
  slug: ProjectRef,
  deliveryId: string,
): Promise<{ ok: boolean; evidence?: unknown; error?: string }> {
  const [org, project] = slug.split("/");
  const context = await requireProject(org, project);

  if (!canModifyProjectDeliveries(context)) {
    return { ok: false, error: "Only project members or organisation administrators can reverify URLs in a private project." };
  }

  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      currentSequence: true,
      publishedUrls: true,
      bug: { select: { id: true, projectId: true, organisationId: true } },
    },
  });

  if (!delivery || delivery.bug.projectId !== context.project.id || delivery.bug.organisationId !== context.organisationId) {
    return { ok: false, error: "Delivery not found." };
  }

  if (!delivery.publishedUrls || delivery.publishedUrls.length === 0) {
    return { ok: false, error: "No published URLs associated with this deliverable." };
  }

  // Capture starting sequence and URLs to prevent race conditions and stale overwrites
  const startingSequence = delivery.currentSequence;
  const startingUrls = [...delivery.publishedUrls];

  const batchResult = await verifyPublishedUrls(startingUrls);

  const result = await prisma.$transaction(async (tx) => {
    // Acquire row lock to ensure sequence atomicity
    await tx.$queryRaw`SELECT "id" FROM "Delivery" WHERE "id" = ${deliveryId} FOR UPDATE`;

    const current = await tx.delivery.findUnique({
      where: { id: deliveryId },
      select: { currentSequence: true, publishedUrls: true },
    });

    const urlsMatch =
      current &&
      current.publishedUrls.length === startingUrls.length &&
      current.publishedUrls.every((u, i) => u === startingUrls[i]);

    if (!current || current.currentSequence !== startingSequence || !urlsMatch) {
      await tx.bugActivity.create({
        data: {
          bugId: delivery.bug.id,
          actorId: context.user.id,
          type: "status_changed",
          summary: `Marketing deliverable URL verification discarded: newer submission sequence or URL change detected (checked sequence ${startingSequence}, current is ${current?.currentSequence ?? "unknown"})`,
          metadata: {
            field: "verificationEvidence",
            action: "retry_verification",
            stale: true,
            startingSequence,
            currentSequence: current?.currentSequence ?? null,
            deliveryId,
          },
        },
      });

      return {
        ok: false as const,
        error: "Stale verification result: deliverable was updated while verification was in progress.",
      };
    }

    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        verificationEvidence: batchResult as unknown as Prisma.InputJsonValue,
      },
    });

    const failedCount = batchResult.results.filter((r) => !r.ok).length;
    const summary = batchResult.allOk
      ? `Marketing deliverable URL verification passed (${startingUrls.length} URL${startingUrls.length === 1 ? "" : "s"} verified)`
      : `Marketing deliverable URL verification failed (${failedCount} of ${startingUrls.length} unreachable)`;

    await tx.bugActivity.create({
      data: {
        bugId: delivery.bug.id,
        actorId: context.user.id,
        type: "status_changed",
        summary,
        metadata: {
          field: "verificationEvidence",
          action: "retry_verification",
          deliveryId,
          sequence: startingSequence,
          allOk: batchResult.allOk,
          totalUrls: startingUrls.length,
          failedCount,
          results: batchResult.results.map((r) => ({
            url: r.url,
            ok: r.ok,
            status: r.status,
            error: r.error,
          })),
        },
      },
    });

    return { ok: true as const, evidence: batchResult };
  });

  return result;
}
