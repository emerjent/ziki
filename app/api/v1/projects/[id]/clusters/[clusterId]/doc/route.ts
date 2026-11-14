import type { NextRequest } from "next/server";
import { clusterIdOf, clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { readDoc, saveDoc } from "@/lib/clusters";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { issueJson } from "@/lib/agent-api/issues";

export const runtime = "nodejs";

/** The shared doc every member edits, with its version and latest revisions. Members only. */
export async function GET(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.doc.read", false, (viewer, params) => readDoc(viewer, clusterIdOf(params)));
}
/** Save `{ body, expectedVersion, reason? }`. A save against an old version is a 409. */
export async function PUT(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.doc.save", true, async (viewer, params) => saveDoc(viewer, clusterIdOf(params), await issueJson(request)));
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "PUT", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "PUT", "HEAD", "OPTIONS"]);
