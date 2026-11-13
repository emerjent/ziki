export type PublicProjectRef = { orgSlug: string; projectSlug: string };

export function publicProjectPath(ref: PublicProjectRef): string {
  return `/${encodeURIComponent(ref.orgSlug)}/${encodeURIComponent(ref.projectSlug)}`;
}

export function publicReportPath(ref: PublicProjectRef): string {
  return `${publicProjectPath(ref)}/report`;
}

export function publicContributePath(ref: PublicProjectRef): string {
  return `${publicProjectPath(ref)}/contribute`;
}

export function publicTrackingPath(ref: PublicProjectRef, token: string): string {
  return `${publicProjectPath(ref)}/track/${encodeURIComponent(token)}`;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Guest-only intake pages nested below the existing public project overview. */
export function publicIntakeSegments(
  path: string,
): (PublicProjectRef & { kind: "report" | "contribute" | "track" }) | null {
  const match = /^\/([^/]+)\/([^/]+)\/(report|contribute|track\/[^/]+)\/?$/.exec(path);
  if (!match) return null;
  const orgSlug = decodeSegment(match[1] ?? "");
  const projectSlug = decodeSegment(match[2] ?? "");
  if (!orgSlug || !projectSlug) return null;
  const tail = match[3];
  return {
    orgSlug,
    projectSlug,
    kind: tail === "report" ? "report" : tail === "contribute" ? "contribute" : "track",
  };
}
