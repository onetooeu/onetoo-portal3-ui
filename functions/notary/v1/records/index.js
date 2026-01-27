import { json, badRequest, methodNotAllowed, unauthorized, readJson, requireWriteAuth } from "../../../ams/v1/_util.js";
import { listNotary, notarize } from "../../../ams/v1/_store.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);
    const items = await listNotary(env, { limit });
    return json({ ok: true, items });
  }

  if (request.method === "POST") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    let body;
    try { body = await readJson(request, 512 * 1024); } catch (e) { return badRequest(String(e && e.message ? e.message : e)); }
    if (!body || typeof body !== "object") return badRequest("body must be json object");
    if (!body.sha256) return badRequest("missing body.sha256");

    const rec = await notarize(env, {
      kind: body.kind || "artifact",
      subject: body.subject || body.key || "",
      sha256: String(body.sha256),
      meta: body.meta && typeof body.meta === "object" ? body.meta : {},
    });

    return json({ ok: true, record: rec }, { status: 201 });
  }

  return methodNotAllowed(request.method, "GET, POST, OPTIONS");
}
