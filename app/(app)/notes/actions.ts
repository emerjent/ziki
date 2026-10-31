"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { humanNotesActor, saveProjectNotes, restoreProjectNotes, addNoteComment } from "@/lib/project-notes";
import { IssueApiError } from "@/lib/agent-api/errors";
import { logger } from "@/lib/logger";

export type NotesActionResult = { error?: string; version?: number };
export type AddNoteCommentResult = { error: string; comment?: never } | {
  error?: never; comment: { id: string; body: string; authorName: string; createdAt: string; agentId: string | null; upvotes: number };
};

export async function addNoteCommentAction(projectId: string, body: string): Promise<AddNoteCommentResult> {
  const user = await requireUser();
  try {
    const tenantId = await currentTenantIdFor(user.id);
    if (!tenantId) return { error: "Select a workspace first." };
    const actor = await humanNotesActor(user, tenantId, projectId);
    const { comment } = await addNoteComment(actor, { body });
    revalidatePath("/notes");
    return { comment: { id: comment.id, body: comment.body, authorName: comment.authorName,
      createdAt: comment.createdAt.toISOString(), agentId: comment.agentId, upvotes: 0 } };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Enter a note of at most 10,000 characters." };
    logger.error("[project-notes] comment failed", error);
    return { error: "Could not add your note. Your draft is still available; try again." };
  }
}
export async function saveNotesAction(projectId: string, input: unknown): Promise<NotesActionResult> {
  const user = await requireUser();
  try {
    const tenantId = await currentTenantIdFor(user.id);
    if (!tenantId) return { error: "Select a workspace first." };
    const actor = await humanNotesActor(user, tenantId, projectId);
    const result = await saveProjectNotes(actor, input);
    revalidatePath("/notes");
    return { version: result.version };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Enter notes and a change summary within the allowed limits." };
    logger.error("[project-notes] save failed", error);
    return { error: "Could not save notes. Your draft is still available; try again." };
  }
}

export async function restoreNotesAction(projectId: string, revisionId: string, input: unknown): Promise<NotesActionResult> {
  const user = await requireUser();
  try {
    const tenantId = await currentTenantIdFor(user.id);
    if (!tenantId) return { error: "Select a workspace first." };
    const actor = await humanNotesActor(user, tenantId, projectId);
    const result = await restoreProjectNotes(actor, revisionId, input);
    revalidatePath("/notes");
    return { version: result.version };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Enter a change summary before restoring." };
    logger.error("[project-notes] restore failed", error);
    return { error: "Could not restore this revision. Try again." };
  }
}
