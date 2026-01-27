import { json, badRequest, methodNotAllowed, notFound, unauthorized, readJson, requireWriteAuth, maybeSign } from "../_util.js";
import { getEnvelope, updateEnvelopeStatus } from "../_store.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params && params.id ? String(params.id) : "";
  if (!id) return notFound("missing id");

  if (request.method === "GET") {
    const envl = await getEnvelope(env, id);
    if (!envl) return notFound("envelope not found");
    return json({ ok: true, envelope: envl });
  }

  if (request.method === "PATCH") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    let body;
    try { body = await readJson(request, 256 * 1024); } catch (e) { return badRequest(String(e && e.message ? e.message : e)); }
    if (!body || typeof body !== "object") return badRequest("body must be json object");

    const status = body.status ? String(body.status) : null;
    if (!status) return badRequest("missing body.status");
    const extra = body.extra && typeof body.extra === "object" ? body.extra : {};

    const updated = await updateEnvelopeStatus(env, id, status, extra);
    if (!updated) return notFound("envelope not found");

    // Optional proof for update record
    const proof = await maybeSign(env, updated);
    if (proof) {
      updated.proofs = Array.isArray(updated.proofs) ? updated.proofs.concat([proof]) : [proof];
    }

    return json({ ok: true, envelope: updated });
  }

  return methodNotAllowed(request.method, "GET, PATCH, OPTIONS");
}
