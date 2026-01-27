// Global middleware for Cloudflare Pages Functions
// - CORS (configurable)
// - Security headers
// - Request id
//
// Configure via environment variables / Pages bindings:
//   AMS_CORS_ORIGIN   (default: "*")
//
// NOTE: The UI is offline-first; write endpoints require auth.

function corsHeaders(reqOrigin, allowOrigin) {
  const origin = allowOrigin || "*";
  // If a specific origin is configured, reflect it only when it matches.
  // If origin == "*" then we allow any origin.
  const outOrigin =
    origin === "*" ? "*" : reqOrigin && reqOrigin === origin ? reqOrigin : origin;

  return {
    "Access-Control-Allow-Origin": outOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type,authorization,x-ams-token,x-request-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  };
}

function newRequestId() {
  // Fast request id (not cryptographically strong)
  return (
    "req_" +
    Math.random().toString(16).slice(2) +
    "_" +
    Date.now().toString(16)
  );
}

export async function onRequest(context) {
  const req = context.request;
  const origin = req.headers.get("Origin") || "";
  const allowOrigin =
    context.env && context.env.AMS_CORS_ORIGIN
      ? String(context.env.AMS_CORS_ORIGIN)
      : "*";

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: { ...corsHeaders(origin, allowOrigin), ...securityHeaders() },
    });
  }

  const rid = req.headers.get("x-request-id") || newRequestId();
  const res = await context.next();

  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, allowOrigin))) h.set(k, v);
  for (const [k, v] of Object.entries(securityHeaders())) h.set(k, v);
  h.set("x-request-id", rid);

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}
