import "server-only";
import { prisma } from "@/lib/prisma";
import type { ProjectContext } from "@/lib/project-route";
import { deliveryFiles, type LibraryItem, type LibraryDeliveryStatus } from "@/components/marketing/library/model";
import { categoryForTaskType } from "@/lib/marketing/categories";

/** The caller must resolve access with requireProject; every read remains organisation/project scoped. */
export async function readLibrary({ project, organisationId }: ProjectContext): Promise<LibraryItem[]> {
  const tasks = await prisma.bug.findMany({
    where: { projectId: project.id, organisationId, isDeleted: false, track: "marketing", status: "resolved", substatus: "published" },
    orderBy: [{ number: "desc" }, { id: "asc" }],
    select: {
      id: true, number: true, title: true,
      beneficiaryUserId: true,
      assigneeId: true,
      type: { select: { name: true } },
      claims: {
        where: { status: "released", releaseReason: "accepted" },
        take: 1,
        select: { agentId: true, beneficiaryUserId: true },
      },
      deliveries: {
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          agentId: true,
          beneficiaryUserId: true,
          summary: true,
          deliverableText: true,
          deliverableUrls: true,
          publishedUrls: true,
          deliveryStatus: true,
          currentSequence: true,
          verificationEvidence: true,
          implementedAt: true,
          implementedBy: { select: { name: true } },
          agent: { select: { name: true } },
          attachments: {
            select: { id: true, filename: true, contentType: true, size: true, deliverySequence: true },
          },
        },
      },
      // A manager's accepting review is the publication event (M-API-5).
      mergeReviews: { where: { verdict: "accept" }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1, select: { updatedAt: true } },
      // Legacy fallback: attachments linked directly to bug without deliveryId
      attachments: { select: { id: true, filename: true, contentType: true, size: true, deliverySequence: true } },
    },
  });
  return tasks.flatMap((task) => {
    const acceptedClaim = task.claims?.[0];
    const delivery =
      (acceptedClaim?.agentId ? task.deliveries.find((d) => d.agentId === acceptedClaim.agentId) : null) ??
      task.deliveries.find((d) => ["live_published", "implemented"].includes(d.deliveryStatus)) ??
      (acceptedClaim?.beneficiaryUserId ? task.deliveries.find((d) => d.beneficiaryUserId === acceptedClaim.beneficiaryUserId && d.deliveryStatus !== "in_review") : null) ??
      task.deliveries.find((d) => ["live_published", "ready_to_use", "implemented"].includes(d.deliveryStatus)) ??
      task.deliveries[0];
    if (!delivery) return [];

    // Filter attachments that belong to the active delivery sequence
    const deliveryAttachments = delivery.attachments ?? [];
    const activeDeliveryAttachments = deliveryAttachments.filter(
      (att) => att.deliverySequence === delivery.currentSequence,
    );

    // If active delivery has direct attachments, use them. Otherwise fallback to matching task attachments that are explicitly referenced in deliverableUrls.
    const taskAttachments = task.attachments ?? [];
    const relevantAttachments =
      activeDeliveryAttachments.length > 0
        ? activeDeliveryAttachments
        : taskAttachments.filter((att) => delivery.deliverableUrls.some((url) => url.includes(att.id)));

    const files = deliveryFiles(delivery.deliverableUrls, relevantAttachments, delivery.deliverableText);
    const category = categoryForTaskType(task.type?.name);
    const deliveryStatus = (delivery.deliveryStatus as LibraryDeliveryStatus) || "ready_to_use";

    return [{
      id: task.id,
      number: task.number,
      title: task.title,
      summary: delivery.summary,
      agent: delivery.agent.name,
      publishedAt: task.mergeReviews[0]?.updatedAt.toISOString() ?? null,
      files,
      deliveryId: delivery.id,
      category,
      taskType: task.type?.name ?? null,
      deliveryStatus,
      publishedUrls: delivery.publishedUrls ?? [],
      verificationEvidence: delivery.verificationEvidence,
      implementedAt: delivery.implementedAt?.toISOString() ?? null,
      implementedByName: delivery.implementedBy?.name ?? null,
    }];
  });
}
