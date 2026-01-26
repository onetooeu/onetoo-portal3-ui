import { getAcceptedSet } from "./api.js";
import { norm } from "./config.js";
import { esc, pill, stableSort, haystack, fmtTs } from "./ui.js";
import { scoreItem } from "./score.js";

const els = {
  q: document.getElementById("q"),
  type: document.getElementById("type"),
  topic: document.getElementById("topic"),
  lang: document.getElementById("lang"),
  sort: document.getElementById("sort"),
  refresh: document.getElementById("refresh"),
  meta: document.getElementById("meta"),
  list: document.getElementById("list"),
};

function uniq(arr){return Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>a.localeCompare(b));}
function entityId(it){
  const base=`${it?.url||""}|${it?.title||""}|${it?.repo||""}`;
  let h=0; for(let i=0;i<base.length;i++) h=((h<<5)-h)+base.charCodeAt(i), h|=0;
  return "e"+Math.abs(h);
}

function render(items, meta){
  const q = norm(els.q.value);
  const typ = els.type.value;
  const topic = els.topic.value;
  const lang = els.lang.value;

  let rows = items.map(it => ({ it, id: it.id || entityId(it), score: q?scoreItem(it,q):0, hay: haystack(it) }));

  if (q) rows = rows.filter(r => r.hay.includes(q));
  if (typ) rows = rows.filter(r => norm(r.it?.kind)===norm(typ) || norm(r.it?.type)===norm(typ));
  if (topic) rows = rows.filter(r => Array.isArray(r.it?.topics) && r.it.topics.map(norm).includes(norm(topic)));
  if (lang) rows = rows.filter(r => Array.isArray(r.it?.languages) && r.it.languages.map(norm).includes(norm(lang)));

  const mode = els.sort.value;
  rows = stableSort(rows, (a,b) => {
    if (mode==="score_desc"){
      const ds=b.score-a.score; if(ds) return ds;
      return String(a.it?.title||"").localeCompare(String(b.it?.title||""));
    }
    if (mode==="newest"){
      const ta=Date.parse(a.it?.timestamp||"")||0;
      const tb=Date.parse(b.it?.timestamp||"")||0;
      const dt=tb-ta; if(dt) return dt;
      return String(a.it?.title||"").localeCompare(String(b.it?.title||""));
    }
    return String(a.it?.title||"").localeCompare(String(b.it?.title||""));
  });

  els.list.innerHTML = rows.map(r=>{
    const it=r.it;
    const topics=(Array.isArray(it?.topics)?it.topics:[]).slice(0,8).map(pill).join("");
    const langs=(Array.isArray(it?.languages)?it.languages:[]).slice(0,8).map(pill).join("");
    const kind=it?.kind||it?.type||"entity";
    const scoreBadge=q?`<span class="score">score ${r.score}</span>`:"";
    const href=`./entity.html?id=${encodeURIComponent(r.id)}`;
    return `
      <div class="item">
        <div class="itemTop">
          <a class="title" href="${href}">${esc(it?.title||"(untitled)")}</a>
          <div class="right">${scoreBadge}</div>
        </div>
        <div class="desc">${esc(it?.description||"")}</div>
        <div class="metaRow">
          <span class="pill">${esc(kind)}</span>
          ${it?.timestamp?`<span class="pill">ts ${esc(fmtTs(it.timestamp))}</span>`:""}
          ${it?.url?`<a class="link" href="${esc(it.url)}" target="_blank" rel="noreferrer">site</a>`:""}
          ${it?.repo?`<a class="link" href="${esc(it.repo)}" target="_blank" rel="noreferrer">repo</a>`:""}
          ${it?.wellKnown?`<a class="link" href="${esc(it.wellKnown)}" target="_blank" rel="noreferrer">.well-known</a>`:""}
        </div>
        <div class="tags">${topics}${langs}</div>
      </div>
    `;
  }).join("") || `<div class="card">No matches.</div>`;

  els.meta.innerHTML = `<div><b>Source:</b> <code>${esc(meta.source)}</code></div><div><b>Items:</b> ${items.length} | <b>Matches:</b> ${rows.length}</div>`;
}

async function init(force=false){
  const acc = await getAcceptedSet({ force });
  const items = Array.isArray(acc.items) ? acc.items : [];
  const types = uniq(items.map(it=>it?.kind||it?.type));
  const topics = uniq(items.flatMap(it=>Array.isArray(it?.topics)?it.topics:[]));
  const langs = uniq(items.flatMap(it=>Array.isArray(it?.languages)?it.languages:[]));

  els.type.innerHTML = `<option value="">All types</option>` + types.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  els.topic.innerHTML = `<option value="">All topics</option>` + topics.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  els.lang.innerHTML = `<option value="">All languages</option>` + langs.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");

  render(items, { source: acc.source });
}

["input","change"].forEach(ev=>{
  els.q.addEventListener(ev, ()=>init(false));
  els.type.addEventListener(ev, ()=>init(false));
  els.topic.addEventListener(ev, ()=>init(false));
  els.lang.addEventListener(ev, ()=>init(false));
  els.sort.addEventListener(ev, ()=>init(false));
});
els.refresh.addEventListener("click", ()=>init(true));
init(false);
