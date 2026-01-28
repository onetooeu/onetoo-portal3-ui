// Global middleware for Cloudflare Pages Functions
// - CORS (configurable)
// - Security headers
// - Request id
// - Soft rate limiting (memory, per-IP, per-minute) for /.../v1/* API routes
//
// Configure via environment variables / Pages bindings:
//   AMS_CORS_ORIGIN        (default: "*")
//   AMS_RL_WRITE_PER_MIN   (default: 30)
//   AMS_RL_READ_PER_MIN    (default: 200)
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

// ---- Soft rate limit (memory) ----
// Keyed by: `${bucket}:${ip}:${minute}`
// bucket: "read" | "write"
const RL = new Map();

function getClientIp(req) {
  // Cloudflare usually provides cf-connecting-ip
  const cfip = req.headers.get("cf-connecting-ip");
  if (cfip) return cfip;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  return "unknown";
}

function isApiV1Path(pathname) {
  // limit only API routes (avoid static assets / HTML)
  return (
    pathname.startsWith("/ams/v1/") ||
    pathname.startsWith("/notary/v1/") ||
    pathname.startsWith("/room/v1/") ||
    pathname.startsWith("/federation/v1/") ||
    pathname.startsWith("/audit/v1/")
  );
}

function isWriteMethod(method) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function toInt(x, def) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function checkRateLimit({ req, env }) {
  const url = new URL(req.url);
  if (!isApiV1Path(url.pathname)) return { ok: true };

  // Optional: never rate-limit health checks
  if (url.pathname.endsWith("/health")) return { ok: true };

  const ip = getClientIp(req);
  const minute = Math.floor(Date.now() / 60000);

  const writeLimit = toInt(env?.AMS_RL_WRITE_PER_MIN, 30);
  const readLimit = toInt(env?.AMS_RL_READ_PER_MIN, 200);

  const bucket = isWriteMethod(req.method) ? "write" : "read";
  const limit = bucket === "write" ? writeLimit : readLimit;

  const key = `${bucket}:${ip}:${minute}`;
  const cnt = (RL.get(key) || 0) + 1;
  RL.set(key, cnt);

  // light cleanup: drop old minutes (best effort)
  // (keeps memory bounded enough in practice)
  if (RL.size > 5000) {
    for (const k of RL.keys()) {
      const parts = k.split(":");
      const m = Number(parts[2]);
      if (Number.isFinite(m) && m < minute - 2) RL.delete(k);
    }
  }

  if (cnt <= limit) return { ok: true };

  // retry at next minute boundary
  const nowMs = Date.now();
  const nextMinuteMs = (minute + 1) * 60000;
  const retryAfterSec = Math.max(1, Math.ceil((nextMinuteMs - nowMs) / 1000));

  return {
    ok: false,
    bucket,
    limit,
    retryAfterSec,
  };
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

  // Rate limit (soft, memory)
  const rl = checkRateLimit({ req, env: context.env });
  if (!rl.ok) {
    const body = JSON.stringify({
      ok: false,
      error: "rate_limited",
      bucket: rl.bucket,
      limit_per_min: rl.limit,
      retry_after_sec: rl.retryAfterSec,
      request_id: rid,
    });

    const h = new Headers();
    for (const [k, v] of Object.entries(corsHeaders(origin, allowOrigin))) h.set(k, v);
    for (const [k, v] of Object.entries(securityHeaders())) h.set(k, v);
    h.set("content-type", "application/json; charset=utf-8");
    h.set("cache-control", "no-store");
    h.set("retry-after", String(rl.retryAfterSec));
    h.set("x-request-id", rid);

    return new Response(body, { status: 429, headers: h });
  }

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
