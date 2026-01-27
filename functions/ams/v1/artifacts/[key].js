import { json, methodNotAllowed, notFound, unauthorized, requireWriteAuth } from "../_util.js";
import { getArtifact, readArtifactPayload, upsertArtifact } from "../_store.js";

export async function onRequest({ request, env, params }) {
  const key = params && params.key ? String(params.key) : "";
  if (!key) return notFound("missing key");

  if (request.method === "GET") {
    const art = await getArtifact(env, key);
    if (!art) return notFound("artifact not found");
    const withPayload = (new URL(request.url)).searchParams.get("payload") === "1";
    if (!withPayload) return json({ ok: true, artifact: art });

    const payload = await readArtifactPayload(env, art);
    return json({ ok: true, artifact: art, payload });
  }

  if (request.method === "PUT") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    const ct = request.headers.get("content-type") || "application/octet-stream";
    const buf = await request.arrayBuffer();
    const txt = new TextDecoder("utf-8").decode(buf);
    const rec = await upsertArtifact(env, key, txt, { content_type: ct });
    return json({ ok: true, artifact: rec });
  }

  return methodNotAllowed(request.method, "GET, PUT, OPTIONS");
}
