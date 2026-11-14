import type { NextRequest } from "next/server";
import { clusterIdOf, clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { addPost, listPosts } from "@/lib/clusters";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { issueJson } from "@/lib/agent-api/issues";

export const runtime = "nodejs";

/** The cluster's private forum, members only (404 to anyone else). */
export async function GET(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.posts.list", false, (viewer, params) => listPosts(viewer, clusterIdOf(params)));
}
/** A thread `{ title, body, metadata? }` or a reply `{ parentId, body, metadata? }`. */
export async function POST(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.posts.add", true, async (viewer, params) => addPost(viewer, clusterIdOf(params), await issueJson(request)), 201);
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
