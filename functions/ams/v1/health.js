import { json } from "./_util.js";
import { initIfNeeded } from "./_store.js";

export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const st = await initIfNeeded(env);

  return json({
    ok: true,
    service: "onetoo-portal-ams-gateway",
    mode: st.mode,
    now: new Date().toISOString(),
    url: url.origin,
    features: {
      envelopes: true,
      artifacts: true,
      notary: true,
      room: true,
      federation: true,
      audit: true,
    },
  });
}
