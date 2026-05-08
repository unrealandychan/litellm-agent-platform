import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all proxy: browser → /api/proxy/<x> → LITELLM_BASE_URL/<x>
 *
 * The whole point is to keep LITELLM_API_KEY off the client. The key lives in
 * the server-side env (no NEXT_PUBLIC_ prefix); this handler reads it on the
 * server and attaches the Authorization header on the outbound request, so a
 * user inspecting the page bundle / network panel never sees it.
 *
 * Streaming (e.g. /v1/managed_agents/sessions/{id}/events SSE) flows through
 * naturally because we hand `upstream.body` straight to NextResponse — no
 * buffering on this side.
 */

export const runtime = "nodejs";
// Don't try to cache anything — these are dynamic per-user reads/writes.
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function forward(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse | Response> {
  const base = process.env.LITELLM_BASE_URL;
  const key = process.env.LITELLM_API_KEY;
  if (!base || !key) {
    return NextResponse.json(
      {
        error:
          "Server is missing LITELLM_BASE_URL and/or LITELLM_API_KEY env vars.",
      },
      { status: 500 },
    );
  }

  const { path } = await ctx.params;
  // Strip any trailing slash from base to avoid the double-slash in joins.
  const trimmedBase = base.replace(/\/+$/, "");
  const target = `${trimmedBase}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === "authorization") continue; // we set our own
    headers.set(k, v);
  }
  headers.set("Authorization", `Bearer ${key}`);

  const init: RequestInit = {
    method: req.method,
    headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    // Node fetch requires this when streaming a request body.
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to reach upstream: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // Strip hop-by-hop headers from the response too.
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    respHeaders.set(k, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}
export async function OPTIONS(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}
