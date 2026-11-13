import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { grantCredential } from "@/lib/marketing/credentials";
import { parseCredentialJson, withMarketingCredentialAdmin } from "@/lib/marketing/credentials-routes";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; credentialId: string }> };

/**
 * POST /api/v1/projects/{id}/marketing/credentials/{credentialId}/grant
 * Grants the agent claiming a marketing task time-limited access to this credential.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id, credentialId } = await context.params;
  return withMarketingCredentialAdmin(request, id, "change", async (actor) => {
    const body = await parseCredentialJson(request);
    const grant = await grantCredential(actor.organisationId, actor.projectId, credentialId, actor.userId, body);
    return NextResponse.json(grant);
  });
}

const ALLOWED = ["POST", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
