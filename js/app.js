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

async function startApp() {
  renderShell();
  showTab('prizes');
  setTimeout(() => updateSyncStatus('syncing'), 50);
  await loadAll();
  await loadGoalsFromFirebase();
  await loadBINGOGoal();
  renderGoals();
  renderPrizes();
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

      <div style="padding:0 12px 8px">
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
  ['prizes','tags','settings'].forEach(x => {
    const el = document.getElementById('tab-'+x);
    if (el) el.style.display = x===t?'block':'none';
  });
  document.querySelectorAll('.tab-btn').forEach((b,i) =>
    b.classList.toggle('active', ['prizes','tags','settings'][i]===t));
  if (t==='prizes')   renderPrizes();
  if (t==='tags')     renderTags();
  if (t==='settings') renderPMSettings();
}

function renderTags() {
  const el = document.getElementById('tab-tags');
  if (!el) return;
  const prizes = getPrizes().filter(p => p.needTag && !p.bundledInto);
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
      <div class="card-title">Firebase connection</div>
      <div class="field"><label>Database URL</label>
        <input type="text" id="pm-firebase" value="${escHtml(window.FIREBASE_DB_URL||'')}"
          placeholder="https://soiree-prizes-default-rtdb.firebaseio.com"
          style="width:100%;font-family:monospace;font-size:11px">
      </div>
      <button class="btn primary" onclick="savePMSettings()"><i class="ti ti-check"></i> Save</button>
    </div>
    <div style="height:300px"></div>`;
}

function savePMSettings() {
  window.FIREBASE_DB_URL = document.getElementById('pm-firebase')?.value?.trim()||'';
  localStorage.setItem('soiree_firebase_url', window.FIREBASE_DB_URL);
  showToast('Settings saved. Reloading…');
  setTimeout(() => location.reload(), 1000);
}

boot();
