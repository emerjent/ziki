import { NextResponse, type NextRequest } from "next/server";
import { IssueApiError } from "@/lib/agent-api/errors";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { readProjectBrief, saveProjectBrief } from "@/lib/marketing/brief";
import { parseCredentialJson, withMarketingCredentialAdmin } from "@/lib/marketing/credentials-routes";
import { projectBriefSchema } from "@/lib/validations/marketing";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/projects/{id}/marketing/brief
 * Reads the project's Marketing Note (ProjectBrief) directly for the main
 * Marketing page without requiring navigation to /marketing/settings.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return withMarketingCredentialAdmin(request, id, "view", async (actor) => {
    const brief = await readProjectBrief(actor.projectId);
    return NextResponse.json({ projectId: actor.projectId, brief });
  });
}

/**
 * PUT /api/v1/projects/{id}/marketing/brief
 * Updates the project's Marketing Note (ProjectBrief) directly from the
 * Marketing page/chat, enforcing push protection against pasted secrets.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return withMarketingCredentialAdmin(request, id, "change", async (actor) => {
    const body = await parseCredentialJson(request);
    const parsed = projectBriefSchema.safeParse(body);
    if (!parsed.success) {
      throw new IssueApiError(400, parsed.error.issues[0]?.message ?? "Invalid marketing brief.", {
        details: parsed.error.issues,
      });
    }

    await saveProjectBrief(actor.organisationId, actor.projectId, actor.userId, body);
    const brief = await readProjectBrief(actor.projectId);
    return NextResponse.json({ projectId: actor.projectId, brief });
  });
}

const ALLOWED = ["GET", "HEAD", "PUT", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const POST = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
