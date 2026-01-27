import { json, badRequest, methodNotAllowed, unauthorized, readJson, requireWriteAuth } from "../../ams/v1/_util.js";
import { federationStoreHandshake, listFederationHandshakes } from "../../ams/v1/_store.js";

function isHttpsUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:";
  } catch { return false; }
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const items = await listFederationHandshakes(env, { limit });
    return json({ ok: true, items });
  }

  if (request.method === "POST") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    let body;
    try { body = await readJson(request, 512 * 1024); } catch (e) { return badRequest(String(e && e.message ? e.message : e)); }
    const targets = Array.isArray(body.targets) ? body.targets.map(String) : [];
    if (!targets.length) return badRequest("missing body.targets[]");
    if (targets.length > 20) return badRequest("too many targets (max 20)");

    const allowlist = env && env.FED_ALLOWLIST ? String(env.FED_ALLOWLIST).split(/\s*,\s*/).filter(Boolean) : null;
    const out = [];

    for (const t of targets) {
      if (!isHttpsUrl(t)) {
        out.push({ target: t, ok: false, error: "target must be https url" });
        continue;
      }
      if (allowlist && allowlist.length) {
        const host = (new URL(t)).host;
        if (!allowlist.includes(host)) {
          out.push({ target: t, ok: false, error: "host not in FED_ALLOWLIST", host });
          continue;
        }
      }

      try {
        const ai = await fetch(new URL("/.well-known/ai-ams.json", t).toString(), { cf: { cacheTtl: 0 } });
        const aiJson = ai.ok ? await ai.json() : null;

        const spec = await fetch(new URL("/.well-known/ams-gateway-spec.json", t).toString(), { cf: { cacheTtl: 0 } });
        const specJson = spec.ok ? await spec.json() : null;

        const snapshot = {
          remote: t,
          fetched_at: new Date().toISOString(),
          ai_ams: aiJson,
          gateway_spec: specJson,
          http: {
            ai_ams_status: ai.status,
            spec_status: spec.status,
          },
        };

        const stored = await federationStoreHandshake(env, { remote: t, snapshot });
        out.push({ target: t, ok: true, stored_id: stored.id, snapshot });
      } catch (e) {
        out.push({ target: t, ok: false, error: String(e && e.message ? e.message : e) });
      }
    }

    return json({ ok: true, results: out });
  }

  return methodNotAllowed(request.method, "GET, POST, OPTIONS");
}
