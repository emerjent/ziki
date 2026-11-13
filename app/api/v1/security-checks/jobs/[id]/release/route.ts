import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { securityJobRequest } from "@/lib/security-checks/agent-api";
import { releaseJob } from "@/lib/security-checks/engine";

export const runtime = "nodejs";

/** POST /api/v1/security-checks/jobs/{id}/release — give a job back so another agent takes it (#security-checks). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return securityJobRequest(request, "write", async (agent) => {
    const { id } = await params;
    await releaseJob(prisma, agent.agentId, id);
    return NextResponse.json({ released: true });
  });
}

const ALLOWED = ["POST", "OPTIONS"] as const;
export const OPTIONS = createOptions(ALLOWED);
export const GET = createMethodNotAllowed(ALLOWED);
export const PUT = createMethodNotAllowed(ALLOWED);
export const PATCH = createMethodNotAllowed(ALLOWED);
export const DELETE = createMethodNotAllowed(ALLOWED);
