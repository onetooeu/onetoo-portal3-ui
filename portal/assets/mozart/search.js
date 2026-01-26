import { searchV1 } from "./api.js";
import { esc, pill } from "./ui.js";

const elQ=document.getElementById("q");
const elLimit=document.getElementById("limit");
const elGo=document.getElementById("go");
const elCopy=document.getElementById("copy");
const elMeta=document.getElementById("meta");
const elRes=document.getElementById("results");

function render(r){
  if(!r || !r.ok || !r.data){ elMeta.innerHTML=`<div class="card">Search error (status ${esc(String(r?.status??""))})</div>`; return; }
  const results=Array.isArray(r.data.results)?r.data.results:[];
  elMeta.innerHTML = `<div><b>API:</b> <code>${esc(r.url)}</code></div><div><b>Hits:</b> ${results.length}</div>`;
  elRes.innerHTML = results.map(it=>{
    const topics=(Array.isArray(it?.topics)?it.topics:[]).slice(0,8).map(pill).join("");
    const langs=(Array.isArray(it?.languages)?it.languages:[]).slice(0,8).map(pill).join("");
    return `
      <div class="item">
        <div class="itemTop">
          <a class="title" href="${esc(it?.url||"#")}" target="_blank" rel="noreferrer">${esc(it?.title||"(untitled)")}</a>
          <div class="right"><span class="score">score ${esc(String(it?.score??0))}</span></div>
        </div>
        <div class="desc">${esc(it?.description||"")}</div>
        <div class="metaRow">
          ${it?.repo?`<a class="link" href="${esc(it.repo)}" target="_blank" rel="noreferrer">repo</a>`:""}
          ${it?.wellKnown?`<a class="link" href="${esc(it.wellKnown)}" target="_blank" rel="noreferrer">.well-known</a>`:""}
        </div>
        <div class="tags">${topics}${langs}</div>
      </div>
    `;
  }).join("") || `<div class="card">No results.</div>`;
}

async function run(){
  const q=(elQ.value||"").trim();
  const limit=Math.max(1,Math.min(50,parseInt(elLimit.value||"10",10)||10));
  render(await searchV1(q,limit));
}
elGo.addEventListener("click", run);
elQ.addEventListener("keydown",(e)=>{ if(e.key==="Enter") run(); });
elCopy.addEventListener("click", async ()=>{
  const q=(elQ.value||"").trim();
  const limit=Math.max(1,Math.min(50,parseInt(elLimit.value||"10",10)||10));
  const r=await searchV1(q,limit);
  try{ await navigator.clipboard.writeText(r.url); }catch{}
  elMeta.innerHTML = `<div class="card">API URL: <code>${esc(r.url)}</code></div>` + elMeta.innerHTML;
});
run();
