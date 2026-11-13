import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { IssueApiError, agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { leaseCredential } from "@/lib/marketing/credentials";
import { leaseCredentialSchema } from "@/lib/validations/marketing-vault";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/marketing/credentials/{id}/lease
 *
 * Returns a leased marketing credential secret to the working agent that
 * holds an active claim on `bugId`, provided an owner/admin granted access.
 * Never cached (`Cache-Control: no-store`).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return agentIssueRequest(request, "marketing.credential.lease", "working", id, async (agent) => {
    const body = await issueJson(request);
    const parsed = leaseCredentialSchema.safeParse(body);
    if (!parsed.success) {
      throw new IssueApiError(400, parsed.error.issues[0]?.message ?? "Invalid lease request.", {
        details: parsed.error.issues,
      });
    }

    const lease = await leaseCredential({
      agent: { agentId: agent.agentId, organisationId: agent.organisationId },
      bugId: parsed.data.bugId,
      credentialId: id,
    });

    return NextResponse.json(lease, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export const OPTIONS = createOptions(["POST", "OPTIONS"]);
export const GET = createMethodNotAllowed(["POST", "OPTIONS"]);
export const PUT = createMethodNotAllowed(["POST", "OPTIONS"]);
export const PATCH = createMethodNotAllowed(["POST", "OPTIONS"]);
export const DELETE = createMethodNotAllowed(["POST", "OPTIONS"]);
