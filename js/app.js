// app.js — Prize Manager shell

let _activeTab = 'prizes';

async function boot() {
  // Force new Firebase URL
  const newUrl = 'https://soiree-prizes-2027-default-rtdb.firebaseio.com';
  localStorage.setItem('soiree_firebase_url', newUrl);
  window.FIREBASE_DB_URL = newUrl;

  const restored = await restoreSession();
  if (!restored) {
    renderLogin();
    return;
  }
  await startApp();
}

function renderLogin() {
  document.getElementById('root').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;gap:18px;text-align:center">
      <div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:500">Bookish Summer Soirée</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">Prize Manager — who's this?</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:280px">
        <button class="btn primary" onclick="doLogin('nicole')">Nicole (Admin)</button>
        <button class="btn" onclick="doLogin('coordinator')">Prize Coordinator</button>
      </div>
      <div id="login-error" style="font-size:12px;color:var(--red)"></div>
    </div>`;
}

async function doLogin(username) {
  const res = await login(username);
  if (!res.ok) {
    const el = document.getElementById('login-error');
    if (el) el.textContent = res.error || 'Login failed';
    return;
  }
  await startApp();
}

function doSignOut() {
  stopSync();
  signOut();
  renderLogin();
}

function restoreScroll() {
  let y = 0;
  try { y = +sessionStorage.getItem('pm_scroll') || 0; } catch(e) {}
  if (!y) return;
  // content grows as data loads, so retry briefly until the page is tall enough
  let tries = 0;
  const go = () => { window.scrollTo(0,y); document.body.scrollTop=y; document.documentElement.scrollTop=y;
    if (++tries < 12 && Math.abs((window.scrollY||document.body.scrollTop||document.documentElement.scrollTop)-y) > 4) setTimeout(go,150); };
  requestAnimationFrame(go);
}

async function startApp() {
  renderShell();
  // Refresh returns you to the tab (and scroll spot) you were on.
  let _savedTab='prizes', _savedY=0;
  try { _savedTab=sessionStorage.getItem('pm_tab')||'prizes'; _savedY=+sessionStorage.getItem('pm_scroll')||0; } catch(e) {}
  if (!['prizes','tags','settings'].includes(_savedTab)) _savedTab='prizes';
  showTab(_savedTab);
  setTimeout(() => updateSyncStatus('syncing'), 50);
  // Show the last-known list instantly from this device's saved copy, then refresh from the server.
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
    if (b && b.prizes && Object.keys(b.prizes).length && !Object.keys(_prizes).length) {
      _prizes = b.prizes; if (b.meta) _meta = {..._meta, ...b.meta};
      renderGoals(); renderPrizes();
      restoreScroll();
    }
  } catch(e) {}
  // Prizes, authors and goals load at the same time instead of one after another.
  await Promise.all([
    loadAll(),
    (async () => { await loadGoalsFromFirebase(); await loadBINGOGoal(); })()
  ]);
  renderGoals();
  renderPrizes();
  restoreScroll();
  // Lightweight refresh on each poll tick — avoids rebuilding the search
  // input / category pills out from under someone mid-keystroke.
  startSync(() => { refreshGoalsCache().then(renderGoals); updatePrizeListAndCounts(); });
}

function renderShell() {
  try { if (new URLSearchParams(location.search).has('embed')) document.body.classList.add('embed'); } catch(e) {}
  const user  = currentUser();
  const admin = isAdmin();
  document.getElementById('root').innerHTML = `
    <div class="shell">
      <div id="pm-head" style="padding:12px 14px 8px;display:flex;align-items:center;justify-content:space-between">
        <div id="pm-title">
          <div style="font-family:Georgia,serif;font-size:17px;font-weight:500">Bookish Summer Soirée</div>
          <div style="font-size:11px;color:var(--text2)">Prize Manager</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div id="sync-status" style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:3px"></div>
          <div id="user-badge" style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px">
            ${escHtml(user ? user.displayName : '')}
            <button onclick="doSignOut()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0;line-height:1" title="Sign out"><i class="ti ti-logout"></i></button>
          </div>
        </div>
      </div>

      <div id="budget-bar" style="padding:0 12px"></div>

      <div id="goals-wrap" style="padding:0 12px 8px">
        <div class="goals-row" id="goals-bar"></div>
      </div>

      <div id="tab-prizes"   style="padding:0 12px"><div id="prizes-content"></div></div>
      <div id="tab-tags"     style="display:none;padding:0 12px"></div>
      <div id="tab-settings" style="display:none;padding:0 12px"></div>
    </div>

    <nav class="tab-bar">
      <button class="tab-btn active" onclick="showTab('prizes')"><i class="ti ti-gift"></i>Prizes</button>
      <button class="tab-btn" onclick="showTab('tags')"><i class="ti ti-tag"></i>Tags</button>
      ${admin ? '<button class="tab-btn" onclick="showTab(\'settings\')"><i class="ti ti-settings"></i>Settings</button>' : ''}
    </nav>
    <div id="modal-container"></div>
    <div id="toast" class="toast"></div>`;
}

function showTab(t) {
  // Prize Coordinator role: Prizes and Tags only — no Settings.
  if (!isAdmin() && t === 'settings') t = 'prizes';
  _activeTab = t;
  try { sessionStorage.setItem('pm_tab', t); } catch(e) {}
  ['prizes','tags','settings'].forEach(x => {
    const el = document.getElementById('tab-'+x);
    if (el) el.style.display = x===t?'block':'none';
  });
  document.querySelectorAll('.tab-btn').forEach((b,i) =>
    b.classList.toggle('active', ['prizes','tags','settings'][i]===t));
  // The budget bars and count boxes only matter on the Prizes screen; they just clutter Tags.
  ['budget-bar','goals-wrap'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.style.display = (t==='tags') ? 'none' : '';
  });
  if (t==='prizes')   renderPrizes();
  if (t==='tags')     renderTags();
  if (t==='settings') renderPMSettings();
}

function renderTags() {
  const el = document.getElementById('tab-tags');
  if (!el) return;
  // SWAG donations never get a tag, even if an old record still says needTag.
  const prizes = getPrizes().filter(p => p.needTag && !p.bundledInto && p.cat !== 'SWAG Bag');
  const stages = [
    {key:'tagMade',    label:'1. Tag made',    color:'var(--amber)'},
    {key:'tagPrinted', label:'2. Tag printed',  color:'var(--purple)'},
    {key:'tagAttached',label:'3. Tag attached', color:'var(--blue,#3B82F6)'},
    {key:'onTote',     label:'4. On tote',      color:'var(--green)'},
  ];
  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">${prizes.length} prizes need tags</div>
    ${stages.map(s => {
      const inStage = prizes.filter(p => p[s.key]);
      const pct = prizes.length > 0 ? Math.round(inStage.length/prizes.length*100) : 0;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="font-weight:500;color:${s.color}">${s.label}</span>
          <span style="color:var(--text2)">${inStage.length}/${prizes.length} (${pct}%)</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;background:${s.color};width:${pct}%;border-radius:3px;transition:width .3s"></div>
        </div>
      </div>`;
    }).join('')}
    <div style="font-size:13px;font-weight:600;margin:16px 0 8px">Print preview</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      <a href="bookmark-print.html?db=${encodeURIComponent(window.FIREBASE_DB_URL||'')}&type=book" target="_blank" class="btn" style="text-decoration:none"><i class="ti ti-bookmark"></i> Bookmarks</a>
      <a href="bookmark-print.html?db=${encodeURIComponent(window.FIREBASE_DB_URL||'')}&type=clothing" target="_blank" class="btn" style="text-decoration:none"><i class="ti ti-shirt"></i> Clothing tags</a>
      <a href="bookmark-print.html?db=${encodeURIComponent(window.FIREBASE_DB_URL||'')}&type=item" target="_blank" class="btn" style="text-decoration:none"><i class="ti ti-tag"></i> Misc Items</a>
    </div>
    <div style="font-size:13px;font-weight:600;margin:16px 0 8px">Prizes needing tags</div>
    ${prizes.filter(p=>!p.onTote).map(p => `
      <div style="padding:8px 10px;background:var(--bg);border:.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:4px;cursor:pointer" onclick="openEditPrize(${p.id})">
        <div style="font-size:13px;font-weight:500">${escHtml(p.name||'Unnamed')}</div>
        <div style="font-size:11px;color:var(--text2)">${escHtml(p.cat||'')} · ${escHtml(p.donor||'No donor')}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
          ${['tagMade','tagPrinted','tagAttached','onTote'].map((k,i)=>
            `<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:${p[k]?'var(--green-bg)':'var(--bg2)'};color:${p[k]?'var(--green-text)':'var(--text3)'}">${['Made','Printed','Attached','On tote'][i]}</span>`
          ).join('')}
        </div>
      </div>`).join('')}
    <div style="height:300px"></div>`;
}

function renderPMSettings() {
  if (!isAdmin()) { showTab('prizes'); return; }
  const el = document.getElementById('tab-settings');
  if (!el) return;
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Backups</div>
      <div id="pm-bk-last" style="font-size:13px;color:var(--text2);margin-bottom:8px">Loading…</div>
      <button class="btn primary" onclick="doBackup()"><i class="ti ti-device-floppy"></i> Back up now</button>
      <button class="btn" id="pm-bk-toggle" style="margin-top:10px;font-size:12px;padding:5px 10px" onclick="toggleBackupList()">Show the last backups</button>
      <div id="pm-bk-list" style="margin-top:6px;display:none"></div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.5">
        A backup is a saved copy of all your prizes at that moment. They're taken automatically (at most every 4 hours), and the newest ${SNAP_KEEP} are kept, all listed above, newest first.<br>
        <b>See what's different from now</b> shows which prizes are in that backup but not in the app anymore, so you can pick the ones to bring back. Nothing else changes.<br>
        <b>Go back to this backup</b> replaces ALL your current prizes with that copy (anything added or changed since is lost).</div>
    </div>
    <div class="card">
      <div class="card-title">Recently deleted</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Deleted prizes are kept for ${TRASH_DAYS} days so you can bring them back.</div>
      <div id="pm-trash-list">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Firebase connection</div>
      <div class="field"><label>Database URL</label>
        <input type="text" id="pm-firebase" value="${escHtml(window.FIREBASE_DB_URL||'')}"
          placeholder="https://soiree-prizes-default-rtdb.firebaseio.com"
          style="width:100%;font-family:monospace;font-size:11px">
      </div>
      <button class="btn primary" onclick="savePMSettings()"><i class="ti ti-check"></i> Save</button>
    </div>
    <div style="height:300px"></div>`;
  fillPMBackups();
  fillPMTrash();
}

function bkCount(s){ return s.units ? s.units+' prizes ('+s.count+' entries)' : s.count+' entries'; }

function toggleBackupList(){ window._bkOpen = !window._bkOpen; fillPMBackups(); }

async function fillPMBackups() {
  const snaps = await listSnapshots();
  const last = document.getElementById('pm-bk-last'); const list = document.getElementById('pm-bk-list');
  if (!last || !list) return;
  last.innerHTML = snaps.length
    ? 'Last backup: <b>'+escHtml(fmtWhen(snaps[0].ts))+'</b> · '+bkCount(snaps[0])
    : '<b>No backups yet.</b> Tap “Back up now”.';
  const tg = document.getElementById('pm-bk-toggle');
  if (tg) { tg.textContent = (window._bkOpen?'Hide':'Show')+' the last '+snaps.length+' backup'+(snaps.length===1?'':'s'); }
  list.style.display = window._bkOpen ? 'block' : 'none';
  list.innerHTML = snaps.map(function(s){
    return '<div style="border-top:1px solid var(--border);padding:5px 0">'+
      '<div style="font-size:11px"><b>'+escHtml(fmtWhen(s.ts))+'</b> · '+bkCount(s)+(s.label&&s.label!=='automatic'?' · '+escHtml(s.label):'')+'</div>'+
      '<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">'+
        '<button class="btn primary" style="font-size:11px;padding:4px 9px" onclick="showSnapshotDiff(\''+s.key+'\')">See what\'s different from now</button>'+
        '<button class="btn danger" style="font-size:11px;padding:4px 9px" onclick="restoreAllFromSnapshot(\''+s.key+'\')">Go back to this backup</button>'+
      '</div></div>';
  }).join('');
}

async function showSnapshotDiff(key){
  const d = await snapshotMissing(key);
  if (!d) { showToast('Backup not found','error'); return; }
  window._diffKey = key;
  const rows = d.missing.length ? d.missing.map(function(p){
    return '<label style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--border);font-size:13px">'+
      '<input type="checkbox" class="pm-diff-cb" value="'+escHtml(String(p.id))+'" checked style="margin-top:3px">'+
      '<span><b>'+escHtml(p.name||'(no name)')+'</b>'+(p.qty>1?' × '+p.qty:'')+(p.donor?' · '+escHtml(p.donor):'')+(p.cat?' · '+escHtml(catLabelOf(p.cat)):'')+'</span></label>';
  }).join('') : '<div style="font-size:13px;color:var(--text2);padding:6px 0">Nothing is missing. Every prize in this backup is still in the app.</div>';
  pmSubOpen('<h3>Backup from '+escHtml(fmtWhen(d.snap.ts))+'</h3>'+
    '<p style="font-size:12px;color:var(--text2);margin:0 0 8px">'+(d.missing.length
      ? d.missing.length+' prize'+(d.missing.length===1?'':'s')+' in this backup '+(d.missing.length===1?'is':'are')+' no longer in the app (deleted since then). Untick any you don\'t want back.'
      : '')+(d.added?' '+d.added+' prize'+(d.added===1?'':'s')+' were added after this backup.':'')+'</p>'+
    '<div style="max-height:45vh;overflow:auto">'+rows+'</div>'+
    '<div style="display:flex;gap:8px;margin-top:12px">'+
      (d.missing.length?'<button class="btn primary" onclick="applySnapshotDiff()">Bring back selected</button>':'')+
      '<button class="btn" onclick="pmSubClose()">Close</button></div>');
}
async function applySnapshotDiff(){
  const ids = Array.prototype.map.call(document.querySelectorAll('.pm-diff-cb:checked'), function(c){ return c.value; });
  if (!ids.length) { showToast('Tick at least one prize','error'); return; }
  pmSubClose();
  await restoreSelectedFromSnapshot(window._diffKey, ids);
}

async function fillPMTrash() {
  const items = await listTrash();
  const el = document.getElementById('pm-trash-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div style="font-size:13px;color:var(--text3)">Nothing deleted recently.</div>'; return; }
  // Identical items (same name + donor) show as one line with a total quantity
  const groups = {}, order = [];
  items.forEach(function(t){
    const p = t.prize;
    const g = (p.name||'')+'\u0001'+(p.donor||'');
    if (!groups[g]) { groups[g] = {keys:[], qty:0, name:p.name, donor:p.donor, cats:{}, at:t.deletedAt}; order.push(g); }
    groups[g].keys.push(t.key);
    groups[g].qty += Math.max(1, parseInt(p.qty,10) || 1);
    groups[g].cats[p.cat||''] = 1;
    groups[g].at = Math.max(groups[g].at||0, t.deletedAt||0);
  });
  window._trashGroups = order.map(function(g){ return groups[g]; });
  el.innerHTML = window._trashGroups.map(function(g, i){
    const cats = Object.keys(g.cats).filter(Boolean);
    return '<div style="border-top:1px solid var(--border);padding:8px 0">'+
      '<div style="font-size:13px"><b>'+escHtml(g.name||'(no name)')+'</b>'+(g.qty>1?' × '+g.qty:'')+(g.donor?' · '+escHtml(g.donor):'')+(cats.length?' · '+escHtml(cats.length>1?'Mixed categories':catLabelOf(cats[0])):'')+'</div>'+
      '<div style="font-size:11px;color:var(--text3)">Deleted '+escHtml(fmtWhen(g.at))+'</div>'+
      '<div style="display:flex;gap:6px;margin-top:6px"><button class="btn primary" onclick="restoreTrashUI('+i+')">Restore</button>'+
      '<button class="btn" onclick="purgeTrashUI('+i+')">Delete forever</button></div></div>';
  }).join('');
}

function askRestoreChoice(N, name){
  return new Promise(function(resolve){
    _pmSubResolve = resolve;
    pmSubOpen('<h3>Restore '+escHtml(name||'this prize')+'?</h3>'+
      '<p style="font-size:13px;color:var(--text2);margin:0 0 12px">There are '+N+' of these in Recently deleted. Restore:</p>'+
      '<div style="display:flex;flex-direction:column;gap:8px">'+
        '<button class="btn primary" onclick="pmSubDone('+N+')">All '+N+' of them</button>'+
        '<button class="btn" onclick="document.getElementById(\'pm-rst-row\').style.display=\'flex\';document.getElementById(\'pm-rst-n\').focus()">Some of them</button>'+
        '<div id="pm-rst-row" style="display:none;align-items:center;gap:8px"><input type="number" id="pm-rst-n" min="1" max="'+(N-1)+'" style="width:90px" placeholder="how many"> <span>/ '+N+'</span> <button class="btn primary" onclick="pmRstApply('+N+')">Restore</button></div>'+
        '<button class="btn" onclick="pmSubDone(null)">Cancel</button>'+
      '</div>');
  });
}
function pmRstApply(N){
  var n=parseInt(document.getElementById('pm-rst-n')?.value);
  if(!n||n<1||n>N){ showToast('Enter a number from 1 to '+N,'error'); return; }
  pmSubDone(n);
}
async function restoreTrashUI(i){
  const g = (window._trashGroups||[])[i]; if(!g) return;
  let k = g.qty;
  if (g.qty > 1) { k = await askRestoreChoice(g.qty, g.name); if (!k) return; }
  await restoreTrashGroup(g.keys, k);
}
async function purgeTrashUI(i){
  const g = (window._trashGroups||[])[i]; if(!g) return;
  if (!confirm('Permanently delete '+(g.qty>1?'all '+g.qty+' of these':'this')+'? It cannot be restored after this.')) return;
  for (const k of g.keys) await dbDelete('trash/'+k);
  renderPMSettings();
}

function savePMSettings() {
  window.FIREBASE_DB_URL = document.getElementById('pm-firebase')?.value?.trim()||'';
  localStorage.setItem('soiree_firebase_url', window.FIREBASE_DB_URL);
  showToast('Settings saved. Reloading…');
  setTimeout(() => location.reload(), 1000);
}

boot();

// Remember scroll position so a refresh puts you back where you were.
(function(){
  let tm=null;
  const save=()=>{ try { sessionStorage.setItem('pm_scroll', String(window.scrollY||document.body.scrollTop||document.documentElement.scrollTop||0)); } catch(e) {} };
  const onScroll=()=>{ clearTimeout(tm); tm=setTimeout(save,150); };
  window.addEventListener('scroll', onScroll, {passive:true});
  document.addEventListener('scroll', onScroll, {passive:true, capture:true});
  window.addEventListener('pagehide', save);
})();
