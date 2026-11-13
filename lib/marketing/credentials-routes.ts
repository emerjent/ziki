import { NextResponse, type NextRequest } from "next/server";
import { IssueApiError, issueJson } from "@/lib/agent-api/issues";
import { assertMarketingSettingsAccess } from "@/lib/marketing/settings";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import { resolveSessionUserId } from "@/lib/session-user";

export type CredentialAdminActor = {
  organisationId: string;
  projectId: string;
  userId: string;
};

/**
 * Authenticates a human workspace owner/admin session and resolves the target
 * project by id or slug. Agent bearer keys are intentionally not accepted on
 * owner credential-management routes.
 */
export async function withMarketingCredentialAdmin(
  request: NextRequest,
  projectIdOrSlug: string,
  mode: "view" | "change",
  run: (actor: CredentialAdminActor) => Promise<Response>,
): Promise<Response> {
  if (request.headers.has("authorization")) {
    return NextResponse.json(
      { error: "forbidden", message: "Only human workspace owners and admins can manage marketing credentials." },
      { status: 403 },
    );
  }

  const session = await resolveSessionUserId();
  if ("error" in session) {
    return NextResponse.json({ error: "unauthorized", message: "Authentication required." }, { status: 401 });
  }

  const organisationId = await currentOrganisationIdFor(session.userId);
  if (!organisationId) {
    return NextResponse.json({ error: "no_organisation", message: NO_ORGANISATION_MESSAGE }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true },
  });
  if (!user) {
    return NextResponse.json({ error: "unauthorized", message: "User not found." }, { status: 401 });
  }

  try {
    await assertMarketingSettingsAccess(user, organisationId, mode);
    const project = await prisma.project.findFirst({
      where: {
        organisationId,
        OR: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }],
      },
      select: { id: true },
    });
    if (!project) {
      throw new IssueApiError(404, "Project not found.");
    }

    return await run({ organisationId, projectId: project.id, userId: user.id });
  } catch (error) {
    if (error instanceof IssueApiError) {
      return NextResponse.json(
        { error: error.message, ...(error.body ? { details: error.body } : {}) },
        { status: error.status },
      );
    }
    throw error;
  }
}

export async function parseCredentialJson(request: NextRequest) {
  return issueJson(request);
}
