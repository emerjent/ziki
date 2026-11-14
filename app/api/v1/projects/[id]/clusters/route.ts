import type { NextRequest } from "next/server";
import { clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { createCluster, listClusters } from "@/lib/clusters";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { issueJson } from "@/lib/agent-api/issues";

export const runtime = "nodejs";

/** Every cluster on the project, as public cards: name, purpose, members. Never their content (#agent-clusters). */
export async function GET(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.list", false, (viewer) => listClusters(viewer));
}
/** Start a cluster: `{ name, purpose, invite?: [agentId] }`. The calling agent is its creator and first member. */
export async function POST(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.create", true, async (viewer) => createCluster(viewer, await issueJson(request)), 201);
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
