import { json, badRequest, methodNotAllowed, unauthorized, readJson, requireWriteAuth, maybeSign } from "./_util.js";
import { createEnvelope, listEnvelopes } from "./_store.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return methodNotAllowed(request.method, "POST, OPTIONS");

  let body;
  try { body = await readJson(request, 1024 * 1024); } catch (e) { return badRequest(String(e && e.message ? e.message : e)); }
  if (!body || typeof body !== "object") return badRequest("body must be json object");

  const wantPull = body.pull !== false;
  const wantPush = Array.isArray(body.push) && body.push.length > 0;

  if (wantPush) {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);
  }

  const result = { ok: true, accepted: [], rejected: [], pulled: { items: [], nextCursor: null } };

  if (wantPush) {
    for (const raw of body.push) {
      try {
        const envl = {
          id: raw.id,
          type: String(raw.type || "unknown"),
          from: raw.from ? String(raw.from) : null,
          to: raw.to ? String(raw.to) : null,
          thread: raw.thread ? String(raw.thread) : null,
          status: raw.status ? String(raw.status) : "queued",
          payload: raw.payload ?? raw.body ?? {},
          meta: raw.meta ?? {},
          created_at: raw.created_at,
          proofs: Array.isArray(raw.proofs) ? raw.proofs : undefined,
        };
        const proof = await maybeSign(env, envl);
        if (proof) envl.proofs = Array.isArray(envl.proofs) ? envl.proofs.concat([proof]) : [proof];
        const created = await createEnvelope(env, envl);
        result.accepted.push({ id: created.id, sha256: created.sha256 });
      } catch (e) {
        result.rejected.push({ error: String(e && e.message ? e.message : e) });
      }
    }
  }

  if (wantPull) {
    const since = body.since ? String(body.since) : null;
    const limit = Math.min(parseInt(body.limit || "200", 10) || 200, 500);
    result.pulled = await listEnvelopes(env, { limit, cursor: since, direction: "asc" });
  }

  return json(result);
}
