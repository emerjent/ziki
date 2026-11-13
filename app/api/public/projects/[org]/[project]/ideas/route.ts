import { NextResponse, type NextRequest } from "next/server";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "@/lib/attachment-body";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import {
  createPublicIdea,
  findPublicIdeaMatches,
  PUBLIC_IDEA_BODY_BYTES,
  type PublicIdeaScreenshot,
} from "@/lib/public-idea-intake";

type Context = { params: Promise<{ org: string; project: string }> };

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const publicHost = forwardedHost || request.headers.get("host");
    return Boolean(publicHost && new URL(origin).host.toLowerCase() === publicHost.toLowerCase());
  } catch {
    return false;
  }
}

function response(result: Awaited<ReturnType<typeof createPublicIdea>> | Awaited<ReturnType<typeof findPublicIdeaMatches>>) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (result.status === 429) headers.set("Retry-After", String(result.retryAfterSeconds));
  return NextResponse.json(result, { status: result.status, headers });
}

async function readJson(request: NextRequest): Promise<unknown | null | "too-large"> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes > PUBLIC_IDEA_BODY_BYTES) return "too-large";
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > PUBLIC_IDEA_BODY_BYTES) return "too-large";
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readSubmission(request: NextRequest): Promise<
  | { ok: true; body: unknown; screenshot: PublicIdeaScreenshot | null }
  | { ok: false; status: 400; error: "invalid_request"; message: string }
  | { ok: false; status: 413; error: "too_large"; message: string }
> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const maxBytes = MAX_ATTACHMENT_BYTES + PUBLIC_IDEA_BODY_BYTES + MULTIPART_OVERHEAD_BYTES;
    const multipart = await readLimitedMultipart(request, maxBytes);
    if (!multipart.ok) {
      return multipart.reason === "too-large"
        ? { ok: false, status: 413, error: "too_large", message: "The report or screenshot is too large." }
        : { ok: false, status: 400, error: "invalid_request", message: "Send a valid multipart form report." };
    }
    const { form } = multipart;
    const textField = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : undefined;
    };
    const body: Record<string, unknown> = {
      prompt: textField("prompt"),
      title: textField("title"),
      summary: textField("summary"),
      description: textField("description"),
      stepsToReproduce: textField("stepsToReproduce"),
      expectedBehavior: textField("expectedBehavior"),
      actualBehavior: textField("actualBehavior"),
      website: textField("website"),
      acknowledgeSimilar: textField("acknowledgeSimilar") === "true",
      trackingToken: textField("trackingToken"),
    };
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }
    const file = form.get("screenshot");
    let screenshot: PublicIdeaScreenshot | null = null;
    if (file instanceof File && (file.size > 0 || file.name)) {
      screenshot = {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name || "screenshot",
      };
    }
    return { ok: true, body, screenshot };
  }

  const body = await readJson(request);
  if (body === "too-large") {
    return { ok: false, status: 413, error: "too_large", message: "The report is too large." };
  }
  if (body === null) {
    return { ok: false, status: 400, error: "invalid_request", message: "Send a valid JSON report." };
  }
  return { ok: true, body, screenshot: null };
}

/** Public duplicate suggestions expose only allowlisted work-item fields. */
export async function GET(request: NextRequest, context: Context) {
  const { org, project } = await context.params;
  return response(await findPublicIdeaMatches(
    { orgSlug: org, projectSlug: project },
    request.nextUrl.searchParams.get("q") ?? "",
    request.headers,
  ));
}

/** Signed-out intake creates an idea only; it never confirms, assigns or starts work. */
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { status: 403, error: "forbidden", message: "Submit reports from the public project page." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const submission = await readSubmission(request);
  if (!submission.ok) {
    return submission.status === 413
      ? response({ status: 413, error: "too_large", message: submission.message })
      : response({ status: 400, error: "invalid_request", message: submission.message });
  }
  const { org, project } = await context.params;
  return response(await createPublicIdea(
    { orgSlug: org, projectSlug: project },
    submission.body,
    request.headers,
    { screenshot: submission.screenshot },
  ));
}
