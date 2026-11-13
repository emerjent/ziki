import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { securityJobRequest } from "@/lib/security-checks/agent-api";
import { listAgentJobs } from "@/lib/security-checks/engine";

export const runtime = "nodejs";

/**
 * GET /api/v1/security-checks/jobs — the security-check jobs this on-call
 * agent holds (#security-checks). Asking also hands it waiting work, if it has
 * room. Each job says what to check and when it must be reported by.
 */
export async function GET(request: NextRequest) {
  return securityJobRequest(request, "read", async (agent) => {
    const jobs = await listAgentJobs(prisma, agent.agentId);
    return NextResponse.json({ jobs });
  });
}

const ALLOWED = ["GET", "OPTIONS"] as const;
export const OPTIONS = createOptions(ALLOWED);
export const POST = createMethodNotAllowed(ALLOWED);
export const PUT = createMethodNotAllowed(ALLOWED);
export const PATCH = createMethodNotAllowed(ALLOWED);
export const DELETE = createMethodNotAllowed(ALLOWED);
