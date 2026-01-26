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
