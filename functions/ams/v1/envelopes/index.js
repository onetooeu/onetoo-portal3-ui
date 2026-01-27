import { json, badRequest, methodNotAllowed, unauthorized, readJson, requireWriteAuth, maybeSign } from "../_util.js";
import { createEnvelope, listEnvelopes } from "../_store.js";

function parseIntSafe(v, d) {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "GET") {
    const limit = Math.min(parseIntSafe(url.searchParams.get("limit"), 50), 200);
    const cursor = url.searchParams.get("cursor");
    const dir = (url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const to = url.searchParams.get("to");
    const from = url.searchParams.get("from");
    const thread = url.searchParams.get("thread");
    const status = url.searchParams.get("status");

    const res = await listEnvelopes(env, { limit, cursor, direction: dir, to, from, thread, status });
    return json({ ok: true, ...res });
  }

  if (request.method === "POST") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    let body;
    try {
      body = await readJson(request, 512 * 1024);
    } catch (e) {
      return badRequest(String(e && e.message ? e.message : e));
    }

    // Minimal validation: needs type + to/from or thread
    if (!body || typeof body !== "object") return badRequest("body must be json object");
    if (!body.type) return badRequest("missing body.type");

    const envl = {
      id: body.id,
      type: String(body.type),
      from: body.from ? String(body.from) : null,
      to: body.to ? String(body.to) : null,
      thread: body.thread ? String(body.thread) : null,
      status: body.status ? String(body.status) : "queued",
      payload: body.payload ?? body.body ?? {},
      meta: body.meta ?? {},
      created_at: body.created_at,
    };

    // Optional proof (server-side)
    const proof = await maybeSign(env, envl);
    if (proof) {
      envl.proofs = Array.isArray(body.proofs) ? body.proofs.concat([proof]) : [proof];
    } else if (Array.isArray(body.proofs)) {
      envl.proofs = body.proofs;
    }

    const created = await createEnvelope(env, envl);
    return json({ ok: true, envelope: created }, { status: 201 });
  }

  return methodNotAllowed(request.method, "GET, POST, OPTIONS");
}
