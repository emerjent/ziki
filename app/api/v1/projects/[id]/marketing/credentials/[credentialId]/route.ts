import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { revokeCredential } from "@/lib/marketing/credentials";
import { withMarketingCredentialAdmin } from "@/lib/marketing/credentials-routes";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; credentialId: string }> };

/**
 * DELETE /api/v1/projects/{id}/marketing/credentials/{credentialId}
 * Revokes a credential, wipes its sealed payload, and expires all grants.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id, credentialId } = await context.params;
  return withMarketingCredentialAdmin(request, id, "change", async (actor) => {
    await revokeCredential(actor.organisationId, actor.projectId, credentialId, actor.userId);
    return NextResponse.json({ ok: true });
  });
}

const ALLOWED = ["DELETE", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const GET = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
