import { qs, safeJson, downloadText } from "./app.js";
import { sha256Bytes, makeReceipt, renderJson, hashFile } from "./mozart-tools.js";

let lastFileReceipt = null;
let lastTextReceipt = null;

qs("#hashFileBtn")?.addEventListener("click", async ()=>{
  const f = qs("#fileIn")?.files?.[0];
  if (!f) return alert("Select a file first.");
  const h = await hashFile(f);
  lastFileReceipt = makeReceipt({ subject: { kind:"file", name:h.name, type:h.type, size:h.size }, hash: { sha256:h.sha256 } });
  renderJson(qs("#fileOut"), lastFileReceipt);
  qs("#dlReceiptBtn").disabled = false;
});

qs("#hashTextBtn")?.addEventListener("click", async ()=>{
  const txt = qs("#textIn").value;
  const buf = new TextEncoder().encode(txt);
  const hex = await sha256Bytes(buf.buffer);
  lastTextReceipt = makeReceipt({ subject: { kind:"text", size: buf.length }, hash: { sha256: hex }, meta: { preview: txt.slice(0,160) } });
  renderJson(qs("#textOut"), lastTextReceipt);
  qs("#dlTextReceiptBtn").disabled = false;
});

qs("#dlReceiptBtn")?.addEventListener("click", ()=>{
  if (!lastFileReceipt) return;
  downloadText("tfws-receipt-file.json", JSON.stringify(lastFileReceipt, null, 2));
});

qs("#dlTextReceiptBtn")?.addEventListener("click", ()=>{
  if (!lastTextReceipt) return;
  downloadText("tfws-receipt-text.json", JSON.stringify(lastTextReceipt, null, 2));
});

qs("#receiptIn")?.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  const txt = await f.text();
  const obj = safeJson(txt, null);
  if (!obj){ qs("#verifyOut").textContent = "Invalid JSON"; return; }
  const ok = (obj.type === "tfws.receipt.v1" && obj.hash && obj.hash.sha256);
  qs("#verifyOut").textContent = JSON.stringify({ ok, receipt: obj }, null, 2);
});


// ============================
// Online notary ledger (experimental)
// ============================
const GW_TOKEN_KEY = "onetoo_ams_gateway_write_token_v1";

function getSavedToken(){
  try { return localStorage.getItem(GW_TOKEN_KEY) || ""; } catch { return ""; }
}
function setSavedToken(t){
  try { if (t) localStorage.setItem(GW_TOKEN_KEY, t); } catch {}
}
function v(sel){ return (qs(sel)?.value || "").trim(); }
function setV(sel, val){ if (qs(sel)) qs(sel).value = val; }

(async function initOnlineNotary(){
  if (!qs("#notaryToken")) return;
  const t = getSavedToken();
  if (t) setV("#notaryToken", t);

  // If user already generated a receipt, prefill sha/subject quickly
  // (best effort, no hard coupling)
  try{
    if (lastFileReceipt?.hash?.sha256) setV("#notarySha", lastFileReceipt.hash.sha256);
    if (lastFileReceipt?.subject?.name) setV("#notarySubject", "file:" + lastFileReceipt.subject.name);
  }catch{}
})();

async function fetchJson(url, opts){
  const r = await fetch(url, opts);
  const txt = await r.text();
  const obj = safeJson(txt, null);
  if (!r.ok) throw new Error((obj && (obj.message || obj.error)) ? `${r.status}: ${obj.message || obj.error}` : `${r.status}: ${txt.slice(0,200)}`);
  return obj || { raw: txt };
}

qs("#notaryListBtn")?.addEventListener("click", async ()=>{
  try{
    const res = await fetchJson("/notary/v1/records?limit=200", { cache:"no-store" });
    qs("#notaryOnlineOut").textContent = JSON.stringify(res, null, 2);
  }catch(e){
    alert(String(e.message||e));
  }
});

qs("#notaryPublishBtn")?.addEventListener("click", async ()=>{
  try{
    const token = v("#notaryToken");
    if (token) setSavedToken(token);

    const kind = v("#notaryKind") || "artifact";
    const subject = v("#notarySubject") || "";
    const sha256 = v("#notarySha") || "";
    if (!sha256) return alert("Missing sha256");

    const headers = { "content-type":"application/json" };
    if (token) headers["authorization"] = "Bearer " + token;

    const res = await fetchJson("/notary/v1/records", {
      method:"POST",
      headers,
      body: JSON.stringify({ kind, subject, sha256, meta:{ source:"portal-notary-ui" } })
    });

    qs("#notaryOnlineOut").textContent = JSON.stringify(res, null, 2);
    alert("Published ✅");
  }catch(e){
    alert(String(e.message||e));
  }
});
