import { getAcceptedSet } from "./api.js";
import { norm } from "./config.js";
import { esc, pill, stableSort } from "./ui.js";
import { scoreItem } from "./score.js";

const elQ=document.getElementById("q");
const elRun=document.getElementById("run");
const elMeta=document.getElementById("meta");
const elOut=document.getElementById("out");

function breakdown(it, q){
  const parts=[];
  if (norm(it?.title).includes(q)) parts.push("title:+5");
  if (norm(it?.description).includes(q)) parts.push("description:+3");
  if (Array.isArray(it?.topics) && it.topics.map(norm).includes(q)) parts.push("topics:+4");
  if (Array.isArray(it?.languages) && it.languages.map(norm).includes(q)) parts.push("languages:+1");
  if (norm(it?.url).includes(q)) parts.push("url:+1");
  return parts;
}

async function run(){
  const qRaw=(elQ.value||"").trim();
  const q=norm(qRaw);
  if(!q){ elMeta.innerHTML=`<div class="card">Enter a query.</div>`; elOut.innerHTML=""; return; }
  const acc=await getAcceptedSet({force:false});
  const items=Array.isArray(acc.items)?acc.items:[];
  let rows = items.map(it=>({it, score: scoreItem(it,q), why: breakdown(it,q)})).filter(r=>r.score>0);
  rows = stableSort(rows,(a,b)=>(b.score-a.score)||String(a.it?.title||"").localeCompare(String(b.it?.title||"")));
  elMeta.innerHTML = `<div><b>Query:</b> <code>${esc(qRaw)}</code> | <b>matches:</b> ${rows.length}</div>`;
  elOut.innerHTML = rows.slice(0,50).map(r=>{
    const it=r.it;
    return `
      <div class="item">
        <div class="itemTop">
          <div class="title">${esc(it?.title||"(untitled)")}</div>
          <div class="right"><span class="score">score ${r.score}</span></div>
        </div>
        <div class="desc">${esc(it?.description||"")}</div>
        <div class="metaRow"><span class="pill">why ${esc(r.why.join(", "))}</span></div>
        <div class="tags">
          ${(Array.isArray(it?.topics)?it.topics:[]).slice(0,8).map(pill).join("")}
          ${(Array.isArray(it?.languages)?it.languages:[]).slice(0,8).map(pill).join("")}
        </div>
      </div>
    `;
  }).join("") || `<div class="card">No matches.</div>`;
}
elRun.addEventListener("click", run);
elQ.addEventListener("keydown",(e)=>{ if(e.key==="Enter") run(); });
