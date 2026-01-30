import { qs, safeJson, humanBytes } from "./app.js";
import { roomLoad, roomSave, roomExport, roomImport } from "./mozart-tools.js";

async function refreshSize(){
  const txt = localStorage.getItem("onetoo_room_v1") || "{}";
  const bytes = new TextEncoder().encode(txt).length;
  qs("#roomSize").textContent = humanBytes(bytes);
}

(async ()=>{
  const data = await roomLoad();
  qs("#roomEditor").value = JSON.stringify(data, null, 2);
  await refreshSize();
})();

qs("#roomSaveBtn")?.addEventListener("click", async ()=>{
  try{
    const obj = safeJson(qs("#roomEditor").value, null);
    if (!obj) return alert("Invalid JSON");
    const bytes = await roomSave(obj);
    await refreshSize();
    alert("Saved ("+humanBytes(bytes)+")");
  }catch(e){
    alert(String(e.message||e));
  }
});

qs("#roomExportBtn")?.addEventListener("click", async ()=>{
  await roomExport();
});

qs("#roomImportIn")?.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  try{
    const obj = await roomImport(f);
    qs("#roomEditor").value = JSON.stringify(obj, null, 2);
    await refreshSize();
    alert("Imported");
  }catch(err){
    alert(String(err.message||err));
  }
});


// ============================
// Online room (experimental)
// ============================
const GW_TOKEN_KEY = "onetoo_ams_gateway_write_token_v1";
function getSavedToken(){
  try { return localStorage.getItem(GW_TOKEN_KEY) || ""; } catch { return ""; }
}
function setSavedToken(t){
  try { if (t) localStorage.setItem(GW_TOKEN_KEY, t); } catch {}
}

function val(sel){ return (qs(sel)?.value || "").trim(); }
function setVal(sel, v){ if (qs(sel)) qs(sel).value = v; }

(async function initOnlineRoom(){
  if (!qs("#onlineToken")) return;
  // seed token from AMS gateway token storage
  const t = getSavedToken();
  if (t) setVal("#onlineToken", t);
})();

async function roomFetchJson(url, opts){
  const r = await fetch(url, opts);
  const txt = await r.text();
  const obj = safeJson(txt, null);
  if (!r.ok) throw new Error((obj && (obj.message || obj.error)) ? `${r.status}: ${obj.message || obj.error}` : `${r.status}: ${txt.slice(0,200)}`);
  return obj || { raw: txt };
}

qs("#onlineLoadBtn")?.addEventListener("click", async ()=>{
  try{
    const room = val("#onlineRoom") || "lobby";
    const res = await roomFetchJson(`/room/v1/messages?room=${encodeURIComponent(room)}&limit=200`, { cache:"no-store" });
    qs("#onlineOut").textContent = JSON.stringify(res, null, 2);
  }catch(e){
    alert(String(e.message||e));
  }
});

qs("#onlinePostBtn")?.addEventListener("click", async ()=>{
  try{
    const room = val("#onlineRoom") || "lobby";
    const from = val("#onlineFrom") || "agent:you";
    const token = val("#onlineToken");
    if (token) setSavedToken(token);
    const body = val("#onlineMsg") || "hello";
    const headers = { "content-type": "application/json" };
    if (token) headers["authorization"] = "Bearer " + token;

    const res = await roomFetchJson(`/room/v1/messages?room=${encodeURIComponent(room)}`, {
      method:"POST",
      headers,
      body: JSON.stringify({ from, kind:"text", body })
    });
    qs("#onlineOut").textContent = JSON.stringify(res, null, 2);
    alert("Posted ✅");
  }catch(e){
    alert(String(e.message||e));
  }
});
