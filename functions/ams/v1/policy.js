import { json, methodNotAllowed } from "./_util.js";

const DEFAULT_POLICY_URL = "/.well-known/ams-policy.json";

export async function onRequest({ request }) {
  if (request.method !== "GET") return methodNotAllowed(request.method, "GET, OPTIONS");

  // Read local policy via fetch against same origin.
  const url = new URL(request.url);
  const policyUrl = new URL(DEFAULT_POLICY_URL, url.origin).toString();
  try {
    const r = await fetch(policyUrl, { cf: { cacheTtl: 0 } });
    const j = r.ok ? await r.json() : null;
    return json({ ok: true, policy: j, source: policyUrl, http_status: r.status });
  } catch (e) {
    return json({ ok: false, error: "policy_fetch_failed", message: String(e && e.message ? e.message : e) }, { status: 500 });
  }
}
