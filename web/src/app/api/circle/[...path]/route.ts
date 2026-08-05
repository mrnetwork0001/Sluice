import { NextRequest } from "next/server";

/**
 * Server-side proxy for Circle's Stablecoin Service API.
 *
 * Swap Kit calls https://api.circle.com/v1/stablecoinKits/* directly, but the
 * browser is blocked by CORS (the SDK sends an `x-user-*` header the service
 * doesn't allow cross-origin). Requests are forwarded from the server instead,
 * where CORS does not apply. Only Circle's routing/quote/status calls travel
 * this path — swap transactions are still signed and broadcast by the user's
 * wallet in the browser.
 */

const CIRCLE_API = "https://api.circle.com";

// Header allowlist: everything the SDK needs, nothing that would confuse the
// upstream (Host, Origin, Referer, cookies are deliberately dropped).
const FORWARD_HEADERS = ["content-type", "accept", "authorization", "x-request-id"];

function forwardedHeaders(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  // Preserve the SDK's own telemetry headers (x-user-agent etc.) — harmless
  // upstream, and they are the reason the browser call is blocked.
  request.headers.forEach((value, name) => {
    if (name.startsWith("x-") && !headers[name]) headers[name] = value;
  });
  return headers;
}

async function proxy(request: NextRequest, path: string[]) {
  const search = request.nextUrl.search;
  const url = `${CIRCLE_API}/${path.join("/")}${search}`;
  const method = request.method;

  const response = await fetch(url, {
    method,
    headers: forwardedHeaders(request),
    body: method === "GET" || method === "HEAD" ? undefined : await request.text(),
    cache: "no-store",
  });

  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, path);
}
