import {
  json,
  badRequest,
  methodNotAllowed,
  unauthorized,
  requireWriteAuth,
  nowIso,
  randId,
  stableStringify,
  sha256Hex,
  maybeSign,
} from "../_util.js";
import { createEnvelope } from "../_store.js";

// HGPEdu "chem submit" -> ALWAYS becomes an AMS envelope.
// - Accepts text/plain (JSON string) to minimize CORS preflight.
// - Also accepts application/json.
// - OPEN mode is controlled by env.AMS_PUBLIC_WRITE=1.

async function readAnyJson(request, maxBytes = 128 * 1024) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error("payload too large");
  const txt = new TextDecoder("utf-8").decode(buf);
  if (!txt || !txt.trim()) throw new Error("empty body");
  return JSON.parse(txt);
}

function normalizeSubmit(body) {
  // Accept flexible shapes; keep original under payload.original.
  const url = body?.url || body?.link || body?.href || body?.source_url;
  const title = body?.title || body?.name || body?.label;
  const note = body?.note || body?.description || body?.comment || "";
  const lang = body?.lang || body?.language || null;
  const tags = Array.isArray(body?.tags) ? body.tags : (typeof body?.tags === "string" ? body.tags.split(/[,\s]+/).filter(Boolean) : []);

  return {
    url: url ? String(url) : null,
    title: title ? String(title) : null,
    note: note ? String(note) : "",
    lang: lang ? String(lang) : null,
    tags: tags.map((t) => String(t)).slice(0, 50),
    original: body,
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(request.method, "POST, OPTIONS");
  }

  const auth = requireWriteAuth(request, env);
  if (!auth.ok) return unauthorized(auth.why);

  let body;
  try {
    body = await readAnyJson(request, 256 * 1024);
  } catch (e) {
    return badRequest(String(e && e.message ? e.message : e));
  }

  if (!body || typeof body !== "object") return badRequest("body must be json object");

  const norm = normalizeSubmit(body);
  if (!norm.url) return badRequest("missing url");
  if (!norm.title) return badRequest("missing title");

  // Canonical payload for hashing + future pipeline ingestion.
  const payload = {
    kind: "contrib",
    action: "submit",
    url: norm.url,
    title: norm.title,
    note: norm.note,
    lang: norm.lang,
    tags: norm.tags,
    source: "hgpedu",
    submitted_at: nowIso(),
  };

  const canonical = stableStringify(payload);
  const payload_sha256 = await sha256Hex(new TextEncoder().encode(canonical));

  const envl = {
    id: randId("env"),
    type: "contrib.submit",
    from: "hgpedu",
    to: "prod-open",
    thread: "t_contrib_submit",
    status: "queued",
    payload,
    meta: {
      source: "hgpedu",
      payload_sha256,
      canonical_len: canonical.length,
      content_type: request.headers.get("content-type") || "",
      user_agent: request.headers.get("user-agent") || "",
      received_at: nowIso(),
    },
  };

  // Optional server-side proof (Ed25519 / HMAC) if configured.
  const proof = await maybeSign(env, envl);
  if (proof) envl.proofs = [proof];

  const created = await createEnvelope(env, envl);

  return json(
    {
      ok: true,
      mode: String(env?.AMS_PUBLIC_WRITE || "") === "1" ? "open" : "token",
      envelope_id: created?.id || envl.id,
      payload_sha256,
      thread: envl.thread,
      status: created?.status || envl.status,
    },
    { status: 202 }
  );
}
