// ------------------ 設定 ------------------
const JSON_PATH = './list.json'; // 既存のバックアップパス
let CURRENT_DATA_PATH = 'list.json';
let CURRENT_TAB_TYPE = 'weapons';
const MAX_RESULTS = 20;
const PRIORITY_KEYS = ['gallery','ja','en-gb'];
const DEFAULT_CHECKED = ['gallery','ja','en-gb'];
const ALL_KEYS = ['de','en-gb','es','fr','ja','ko','pt-br','ru-mo','tr','zh','zh-cht'];
const EXTRA_KEYS = ['Index'];

// タブ設定：拡張可能な構造
const TAB_CONFIG = {
  weapons: {
    path: 'list.json',
    type: 'weapons',
    showFilters: true
  },
  cabindex: {
    path: 'cab_index.json',
    type: 'cabindex',
    showFilters: false
  }
};

// ------------------ DOM ------------------
const qEl = document.getElementById('q');
const resultsEl = document.getElementById('results');
const chkAll = document.getElementById('chk-all');
const langListEl = document.getElementById('langList');
const filtersContainer = document.getElementById('filters-container');

// トースト要素はページによっては存在しない場合があるため、安全に扱うヘルパーを追加
let toastEl = document.getElementById('toast');
function ensureToast(){
  if(!toastEl){
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.className = 'toast';
    toastEl.setAttribute('aria-hidden','true');
    document.body.appendChild(toastEl);
  }
  return toastEl;
}

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

// トースト表示を行う。トースト要素が無ければ生成し、clipboard の成功/失敗に応じてメッセージを表示する
function showToast(msg = 'コピーしました'){
  const t = ensureToast();
  t.textContent = msg;
  t.classList.add('show');
  t.setAttribute('aria-hidden','false');
  clearTimeout(t._t);
  t._t = setTimeout(()=>{ t.classList.remove('show'); t.setAttribute('aria-hidden','true'); }, 1400);
}

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
  return loadDataFrom(CURRENT_DATA_PATH, CURRENT_TAB_TYPE);
}

async function loadDataFrom(path, tabType){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error(path + ' の読み込みに失敗');
    const json = await r.json();
    
    if(tabType === 'cabindex'){
      // CABIndex は辞書形式 {key: value, ...}
      DATA = Object.entries(json).map(([key, value]) => ({key, value}));
    }else{
      // Weapons等は配列形式
      DATA = Array.isArray(json) ? json : [];
    }
    buildIndex(tabType);
    return true;
  }catch(err){
    resultsEl.innerHTML = '<div class="empty">' + escapeHtml(String(path)) + ' の読み込みに失敗したぞ: ' + escapeHtml(String(err)) + '</div>';
    DATA = [];
    INDEX = [];
    return false;
  }
}

function buildIndex(tabType){
  if(tabType === 'cabindex'){
    // CABIndex の場合は簡易インデックス
    INDEX = DATA.map(item => {
      const norm = {
        key: normalizeForSearch(item.key || ''),
        value: normalizeForSearch(item.value || '')
      };
      return {record: item, norm, extras: {}};
    });
  }else{
    // Weapons等の場合は従来通り
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
}

// ------------------ 検索 ------------------
function search(query){
  const q = normalizeForSearch(query);
  if(!q) return [];
  const results = [];
  
  if(CURRENT_TAB_TYPE === 'cabindex'){
    return searchCABIndex(q);
  }else{
    return searchWeapons(q);
  }
}

function searchCABIndex(q){
  const results = [];
  for(const ent of INDEX){
    const rec = ent.record; // {key, value}
    const matches = [];
    // キーの前方一致（例: ユーザーが 'w_8' を入力した場合）
    if(ent.norm.key.startsWith(q)){
      // 表示/コピーする value としてキーを返す
      matches.push({key: 'Key', value: rec.key, raw: rec.value});
    }
    // 値（CAB-xxxx 形式）の「CAB-」以降の前方一致（例: 'c0141...'）
    const valueNormalized = (ent.norm.value || '').replace(/^cab-/, ''); // 「cab-」プレフィックスを除去
    if(valueNormalized.startsWith(q)){
      // 値でヒットした場合も、ユーザーが期待する "キー" を返す仕様にする
      matches.push({key: 'Value', value: rec.key, raw: rec.value});
    }
    if(matches.length) results.push({record: rec, matches});
  }
  return results.slice(0, MAX_RESULTS);
}

function searchWeapons(q){
  const results = [];
  // build enabled keys set
  enabledKeys = new Set(); document.querySelectorAll('.chk').forEach(cb => { if(cb.checked) enabledKeys.add(cb.dataset.key); });
  // always include Index if checked via separate element
  if(document.getElementById('chk-index') && document.getElementById('chk-index').checked) enabledKeys.add('Index');
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
  if(!results.length){ resultsEl.innerHTML = '<div class="empty">該当なし</div>'; return; }
  
  if(CURRENT_TAB_TYPE === 'cabindex'){
    renderCABIndex(results, query);
  }else{
    renderWeapons(results, query);
  }
}

function renderCABIndex(results, query){
  const rows = results.map(r => {
    const rec = r.record; // {key, value}
    const primary = r.matches[0] || {};
    // primary.value は検索で格納したキー（例: w_8）
    const displayKey = primary.value || rec.key || '';
    const cabValue = rec.value || '';
    return `<div class="result-row">
      <div class="result-key">${escapeHtml(primary.key || 'Value')}</div>
      <div class="result-name">${highlightMatch(String(cabValue), query)}</div>
      <div class="result-id" data-id="${escapeHtml(displayKey)}" title="クリックでキーをコピー">${escapeHtml(displayKey)}</div>
    </div>`;
  }).join('');
  resultsEl.innerHTML = rows;
  // attach copy handlers (キーをコピー)
  document.querySelectorAll('.result-id').forEach(el => el.addEventListener('click', onIdClick));
}

function renderWeapons(results, query){
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
  document.querySelectorAll('.result-id').forEach(el => el.addEventListener('click', onIdClick));
}

function onIdClick(e){
  const id = e.currentTarget.dataset.id || '';
  if(!id) return;
  // まず navigator.clipboard を試し、失敗したらフォールバックで textarea を使ってコピーする
  if(navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
    navigator.clipboard.writeText(id).then(()=>{ showToast(id + ' をコピーしたぞ'); }, ()=>{
      // フォールバック
      try{
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if(ok) showToast(id + ' をコピーしたぞ'); else showToast('コピーに失敗したぞ');
      }catch(err){ showToast('コピーに失敗したぞ'); }
    });
  }else{
    // フォールバック経路
    try{
      const ta = document.createElement('textarea');
      ta.value = id;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if(ok) showToast(id + ' をコピーしたぞ'); else showToast('コピーに失敗したぞ');
    }catch(err){ showToast('コピーに失敗したぞ'); }
  }
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
  // 縦タブ初期化
  document.querySelectorAll('.tab-vertical').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      document.querySelectorAll('.tab-vertical').forEach(b => b.setAttribute('aria-selected','false'));
      btn.setAttribute('aria-selected','true');
      const tabId = btn.dataset.tabId;
      const config = TAB_CONFIG[tabId];
      if(!config) return;
      
      CURRENT_DATA_PATH = config.path;
      CURRENT_TAB_TYPE = config.type;
      
      // フィルター表示/非表示切り替え
      if(config.showFilters){
        filtersContainer.style.display = 'block';
      }else{
        filtersContainer.style.display = 'none';
      }
      
      await loadDataFrom(CURRENT_DATA_PATH, CURRENT_TAB_TYPE);
      qEl.value = '';
      onInput();
    });
  });
  
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