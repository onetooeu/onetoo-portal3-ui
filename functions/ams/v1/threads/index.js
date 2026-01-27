import { json, methodNotAllowed } from "../_util.js";
import { listEnvelopes } from "../_store.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method !== "GET") return methodNotAllowed(request.method, "GET, OPTIONS");

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

  // We approximate threads by scanning recent envelopes.
  const scan = await listEnvelopes(env, { limit: Math.max(limit * 20, 200), direction: "desc" });
  const map = new Map();

  for (const e of scan.items) {
    const t = e.thread || e.thread_id || null;
    if (!t) continue;
    if (!map.has(t)) {
      map.set(t, {
        thread: t,
        updated_at: e.updated_at,
        created_at: e.created_at,
        count: 0,
        last_type: e.type,
        last_from: e.from,
        last_to: e.to,
        statuses: {},
      });
    }
    const it = map.get(t);
    it.count++;
    it.updated_at = it.updated_at < e.updated_at ? e.updated_at : it.updated_at;
    it.statuses[e.status || "unknown"] = (it.statuses[e.status || "unknown"] || 0) + 1;
  }

  const items = Array.from(map.values()).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, limit);
  return json({ ok: true, items });
}
