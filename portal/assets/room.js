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
