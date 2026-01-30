import { text, methodNotAllowed, unauthorized, requireAdminAuth } from "../../ams/v1/_util.js";
import { listAudit } from "../../ams/v1/_store.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return methodNotAllowed(request.method, "GET, OPTIONS");

  const publicOk = env && String(env.AUDIT_PUBLIC || "") === "1";
  if (!publicOk) {
    const auth = requireAdminAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 2000);
  const items = await listAudit(env, limit);

  // NDJSON: 1 event = 1 line. If no events, return empty body (not "\n") to avoid misleading wc -l = 1.
  const lines = items.length
    ? items
        .slice()
        .reverse()
        .map((e) => JSON.stringify({ ...e, data: e.data }, null, 0))
        .join("\n") + "\n"
    : "";

  return text(lines, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
