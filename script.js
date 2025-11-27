// ------------------ 設定 ------------------
const JSON_PATH = './list.json';
const MAX_RESULTS = 20;
const PRIORITY_KEYS = ['gallery','ja','en-gb'];
const DEFAULT_CHECKED = ['gallery','ja','en-gb'];
const ALL_KEYS = ['de','en-gb','es','fr','ja','ko','pt-br','ru-mo','tr','zh','zh-cht'];
const EXTRA_KEYS = ['Index'];

// ------------------ DOM ------------------
const qEl = document.getElementById('q');
const resultsEl = document.getElementById('results');
const chkAll = document.getElementById('chk-all');
const langListEl = document.getElementById('langList');
const toast = document.getElementById('toast');

// ------------------ データ格納 ------------------
let DATA = [];
let INDEX = []; // {record, norm, extras}
let enabledKeys = new Set(DEFAULT_CHECKED.concat(ALL_KEYS));

// ------------------ ユーティリティ ------------------
function normalizeForSearch(s){
  if(s == null) return '';
  s = String(s).normalize('NFKC');
  s = s.toLowerCase();
  s = s.replace(/\u30A1-\u30F6/g, match => match); // placeholder
  // convert katakana to hiragana
  s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  s = s.replace(/\s+/g,' ');
  return s;
}

function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }
function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function highlightMatch(original, query){
  if(!query) return escapeHtml(original || '');
  try{
    const normOrig = normalizeForSearch(original || '');
    const normQ = normalizeForSearch(query);
    const idx = normOrig.indexOf(normQ);
    if(idx === -1) return escapeHtml(original || '');
    // build a regex from query safely
    const r = new RegExp(escapeRegExp(query), 'i');
    return escapeHtml(original || '').replace(r, '<span class="mark">$&</span>');
  }catch(e){ return escapeHtml(original || ''); }
}

function showToast(msg = 'コピーしました'){ toast.textContent = msg; toast.classList.add('show'); toast.setAttribute('aria-hidden','false'); clearTimeout(toast._t); toast._t = setTimeout(()=>{ toast.classList.remove('show'); toast.setAttribute('aria-hidden','true'); }, 1400); }

// ------------------ 初期化 UI 設定 ------------------
function buildLangCheckboxes(){
  // insert language checkboxes (except ja and en-gb which already shown)
  ALL_KEYS.forEach(k => {
    if(k === 'ja' || k === 'en-gb') return;
    const div = document.createElement('div'); div.className = 'check-row';
    const lbl = document.createElement('label');
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.className = 'chk'; chk.dataset.key = k; chk.checked = true; // default on
    lbl.appendChild(chk);
    lbl.append(' ' + k);
    div.appendChild(lbl);
    langListEl.appendChild(div);
  });
}

function setDefaultChecks(){
  // ensure gallery, ja, en-gb checked default
  document.querySelectorAll('.chk').forEach(cb => {
    const k = cb.dataset.key;
    if(DEFAULT_CHECKED.includes(k)) cb.checked = true;
    else cb.checked = false;
  });
}

// ------------------ データ処理 ------------------
async function loadData(){
  try{
    const r = await fetch(JSON_PATH);
    if(!r.ok) throw new Error('list.json の読み込みに失敗');
    const json = await r.json();
    DATA = Array.isArray(json) ? json : [];
    buildIndex();
  }catch(err){
    resultsEl.innerHTML = '<div class="empty">list.json の読み込みに失敗したぞ: ' + escapeHtml(String(err)) + '</div>';
  }
}

function buildIndex(){
  INDEX = DATA.map(item => {
    const norm = {};
    norm.gallery = normalizeForSearch(item.gallery||'');
    norm.Index = normalizeForSearch(item.Index||'');
    norm.id = normalizeForSearch(item.id||'');
    ALL_KEYS.forEach(k => { norm[k] = normalizeForSearch(item[k] || ''); });
    const extras = {};
    for(const k of Object.keys(item)){
      if(!['id','gallery','Index',...ALL_KEYS].includes(k)) extras[k] = normalizeForSearch(item[k]);
    }
    return {record:item, norm, extras};
  });
}

// ------------------ 検索 ------------------
function search(query){
  const q = normalizeForSearch(query);
  if(!q) return [];
  const results = [];
  // build enabled keys set
  enabledKeys = new Set(); document.querySelectorAll('.chk').forEach(cb => { if(cb.checked) enabledKeys.add(cb.dataset.key); });
  // always include Index if checked via separate element
  if(document.getElementById('chk-index').checked) enabledKeys.add('Index');
  // iterate
  for(const ent of INDEX){
    const rec = ent.record; const matches = [];
    // check in priority order first
    for(const key of PRIORITY_KEYS){ if(enabledKeys.has(key)){ const val = ent.norm[key] || ''; if(val.includes(q)) matches.push({key, value: rec[key]}); } }
    // then extras languages
    for(const key of ALL_KEYS){ if(!PRIORITY_KEYS.includes(key) && enabledKeys.has(key)){ const val = ent.norm[key] || ''; if(val.includes(q)) matches.push({key, value: rec[key]}); } }
    // then other extra keys
    if(enabledKeys.has('Index')){ if(ent.norm.Index.includes(q)) matches.push({key:'Index', value: rec.Index}); }
    // any other enabled custom keys? check record keys
    if(matches.length) results.push({record:rec, matches});
  }

  // sort by priority score and position
  results.sort((a,b) => compareResults(a,b,q));
  return results.slice(0, MAX_RESULTS);
}

function priorityScore(item){
  const keys = item.matches.map(m=>m.key);
  if(keys.includes('gallery')) return 100;
  if(keys.includes('ja')) return 80;
  if(keys.includes('en-gb')) return 60;
  if(keys.includes('Index')) return 40;
  return 10;
}

function firstMatchPosition(item,q){
  let best = Infinity;
  for(const m of item.matches){
    const key = m.key;
    const ent = INDEX.find(e=>e.record===item.record);
    let nv = '';
    if(ent){ nv = ent.norm[key] || ent.extras[key] || ''; }
    const p = nv.indexOf(normalizeForSearch(q));
    if(p>=0 && p<best) best = p;
  }
  return best===Infinity?9999:best;
}

function compareResults(a,b,q){
  const as = priorityScore(a); const bs = priorityScore(b);
  if(as !== bs) return bs - as;
  const ap = firstMatchPosition(a,q); const bp = firstMatchPosition(b,q);
  if(ap !== bp) return ap - bp;
  return (a.record.id||'').localeCompare(b.record.id||'');
}

// ------------------ レンダリング ------------------
function render(results, query){
  if(!results.length){ resultsEl.innerHTML = '<div class="empty">該当なしじゃ。</div>'; return; }
  const rows = results.map(r => {
    const rec = r.record;
    let primary = r.matches.find(m=>m.key==='gallery') || r.matches.find(m=>m.key==='ja') || r.matches.find(m=>m.key==='en-gb') || r.matches[0];
    const key = primary.key; const val = primary.value;
    const idDigits = (String(rec.id||'').match(/\d+/) || [''])[0] || '';
    return `<div class="result-row">
      <div class="result-key">${escapeHtml(key)}</div>
      <div class="result-name">${highlightMatch(String(val||''), query)}</div>
      <div class="result-id" data-id="${escapeHtml(idDigits)}" title="クリックでIDをコピー">${escapeHtml(idDigits)}</div>
    </div>`;
  }).join('');
  resultsEl.innerHTML = rows;
  // attach copy handlers
  document.querySelectorAll('.result-id').forEach(el => el.addEventListener('click', onIdClick));
}

function onIdClick(e){
  const id = e.currentTarget.dataset.id || '';
  if(!id) return;
  navigator.clipboard.writeText(id).then(()=>{ showToast(id + ' をコピーしたぞ'); }, ()=>{ showToast('コピーに失敗したぞ'); });
}

// ------------------ イベント ------------------
let debounceTimer = null;
function onInput(){
  const q = qEl.value;
  if(debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(()=>{ const res = search(q); render(res, q); }, 90);
}

function onCheckChange(){
  // keep chk-all in sync
  const chks = Array.from(document.querySelectorAll('.chk'));
  const allOn = chks.every(c=>c.checked);
  chkAll.checked = allOn;
  onInput();
}

function toggleAll(val){ document.querySelectorAll('.chk').forEach(c=>c.checked = val); onInput(); }

// ------------------ 初期化 ------------------
function init(){
  buildLangCheckboxes();
  setDefaultChecks();
  // ensure default state: only gallery, ja, en-gb ON if desired
  document.querySelectorAll('.chk').forEach(cb => {
    const k = cb.dataset.key;
    cb.checked = DEFAULT_CHECKED.includes(k);
    cb.addEventListener('change', onCheckChange);
  });
  // special: gallery and en-gb inputs already present? ensure
  const galleryEl = document.querySelector('input[data-key="gallery"]');
  // event listeners
  qEl.addEventListener('input', onInput);
  document.getElementById('clear').addEventListener('click', ()=>{ qEl.value=''; onInput(); });
  chkAll.addEventListener('change', ()=>toggleAll(chkAll.checked));
  // load data
  loadData();
}

init();