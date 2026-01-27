import { json, badRequest, methodNotAllowed, unauthorized, readJson, requireWriteAuth } from "../_util.js";
import { listArtifacts, upsertArtifact } from "../_store.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
    const items = await listArtifacts(env, { limit });
    return json({ ok: true, items });
  }

  if (request.method === "POST") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    let body;
    try { body = await readJson(request, 2 * 1024 * 1024); } catch (e) { return badRequest(String(e && e.message ? e.message : e)); }
    if (!body || typeof body !== "object") return badRequest("body must be json object");
    const key = body.key ? String(body.key) : null;
    if (!key) return badRequest("missing body.key");
    const payload = body.payload ?? body.data ?? body.text ?? "";
    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
    const rec = await upsertArtifact(env, key, payload, meta);
    return json({ ok: true, artifact: rec }, { status: 201 });
  }

  return methodNotAllowed(request.method, "GET, POST, OPTIONS");
}
