import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { createCredential, listCredentials } from "@/lib/marketing/credentials";
import { parseCredentialJson, withMarketingCredentialAdmin } from "@/lib/marketing/credentials-routes";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/projects/{id}/marketing/credentials
 * Lists credential metadata (never secrets) for workspace owners/admins.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return withMarketingCredentialAdmin(request, id, "view", async (actor) => {
    const credentials = await listCredentials(actor.organisationId, actor.projectId);
    return NextResponse.json({ projectId: actor.projectId, credentials });
  });
}

/**
 * POST /api/v1/projects/{id}/marketing/credentials
 * Stores a sealed marketing credential for workspace owners/admins.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return withMarketingCredentialAdmin(request, id, "change", async (actor) => {
    const body = await parseCredentialJson(request);
    const credential = await createCredential(actor.organisationId, actor.projectId, actor.userId, body);
    return NextResponse.json({ credential }, { status: 201 });
  });
}

const ALLOWED = ["GET", "HEAD", "POST", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
