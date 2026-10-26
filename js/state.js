// state.js — prize data, Firebase sync, local cache
let _prizes = {};
let _meta   = { nextId:1, itemTypes:['Book','Bookish item','Clothing','Jewelry','Misc'] };
let _authors = [];

// Firebase stores prizes at prizes/p_{id}, so dbGet('prizes') returns an
// object keyed by "p_5" etc. Every local lookup (getPrize, updatePrize, ...)
// expects _prizes to be keyed by the raw numeric id. Always run raw Firebase
// prize data through this before assigning to _prizes.
function normalizePrizes(raw) {
  const normalized = {};
  if (!raw || typeof raw !== 'object') return normalized;
  const items = Array.isArray(raw) ? raw : Object.values(raw);
  items.forEach(p => { if (p && p.id !== undefined) normalized[p.id] = p; });
  return normalized;
}

// ── Load ───────────────────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [prizes, meta, authors] = await Promise.all([
      dbGet('prizes'),
      dbGet('meta'),
      loadAuthorsFromHQ()
    ]);
    if (prizes && typeof prizes === 'object') {
      const normalized = normalizePrizes(prizes);
      if (Object.keys(normalized).length > 0) {
        _prizes = normalized;
      }
    }
    if (meta && typeof meta === 'object') _meta = {..._meta, ...meta};
    if (authors && authors.length > 0) _authors = authors;
    saveBackup();
    updateSyncStatus('connected');
  } catch(e) {
    updateSyncStatus('error');
    console.error('loadAll failed:', e);
  }
}

// Load full photos for a single prize (called when viewing)
var _fullPhotoCache = {};   // prize id -> array of full-size photos (survives list refreshes)
async function loadFullPhotos(id) {
  try {
    var fulls = _fullPhotoCache[id];
    if (!fulls) {
      fulls = await dbGet('photos/p_'+id);
      if (fulls) _fullPhotoCache[id] = fulls;
    }
    if (fulls && _prizes[id]) {
      _prizes[id].photos = fulls.map((full, i) => ({
        full,
        thumb: (_prizes[id].photos[i]?.thumb) || full
      }));
    }
  } catch(e) {}
}

// How many "real" prizes there are. A bundle counts as ONE prize and the items
// inside it aren't counted again; Unassigned, Small add-ons and SWAG are
// tallied separately (they're not main prizes).
function prizeTally(list) {
  var t = {prizes:0, unassigned:0, addons:0, swag:0, bundles:0, inBundles:0};
  (list || getPrizes()).forEach(function(p){
    if (!p) return;
    if (p.bundledInto && !p.isBundle) { t.inBundles += (+p.qty||1); return; }
    var q = p.isBundle ? 1 : (+p.qty||1);
    if (p.isBundle) t.bundles++;
    if (p.cat === 'Uncategorized') t.unassigned += q;
    else if (p.cat === 'Small add-on') t.addons += q;
    else if (p.cat === 'SWAG Bag') t.swag += q;
    else t.prizes += q;
  });
  return t;
}

// ── Getters ────────────────────────────────────────────────────────────────
function getPrizes()  { return Object.values(_prizes); }
function getPrize(id) { return _prizes[id] || null; }
function getAuthors() { return _authors; }
function getItemTypes() {
  return _meta.itemTypes || ['Book','Bookish item','Clothing','Jewelry','Misc'];
}

// ── Prize CRUD ────────────────────────────────────────────────────────────
async function addPrize(fields) {
  const id = _meta.nextId || 1;
  // Separate full photos from prize record — store only thumbs in prize
  const photos = fields.photos || [];
  const thumbsOnly = photos.map(p => ({thumb: p.thumb}));
  const prize = {
    id,
    name:        '',
    cat:         '',
    itemType:    'Misc',
    value:       0,
    paid:        0,
    qty:         '',
    loc:         '',
    notes:       '',
    donorType:   'none',
    donor:       '',
    donorWebsite:'',
    donorQRType: 'website',
    donorPronoun:'their',
    donorLogo:   '',
    photos:      thumbsOnly,  // thumbs only in main record
    needTag:     false,
    tagMade:     false,
    tagPrinted:  false,
    tagAttached: false,
    onTote:      false,
    tagGenerated:false,
    _created:    Date.now(),
    _mod:        Date.now(),
    ...fields,
    photos:      thumbsOnly,  // always override with thumbs only
  };
  _prizes[id] = {...prize, photos}; // keep full photos in local memory
  _meta.nextId = id+1;
  try {
    // Use string key "p_1" to prevent Firebase array conversion
    await dbSet('prizes/p_'+id, prize);
    if (photos.length > 0) {
      await dbSet('photos/p_'+id, photos.map(p => p.full));
    }
    await dbSet('meta/nextId', id+1);
    updateSyncStatus('connected');
    saveBackup();
    showToast('Prize saved ✓');
  } catch(e) {
    updateSyncStatus('error');
    showToast('Firebase error — check Settings.', 'error');
    console.error('addPrize error:', e);
  }
  return _prizes[id];
}

async function updatePrize(id, fields) {
  if (!_prizes[id]) return;
  const photos = fields.photos || _prizes[id].photos || [];
  const thumbsOnly = photos.map(p => ({thumb: p.thumb || p}));
  _prizes[id] = {..._prizes[id], ...fields, photos, _mod: Date.now()};
  const toSave  = {..._prizes[id], photos: thumbsOnly};
  try {
    // Save with p_ key (migrates old integer-keyed prizes to new format)
    await dbSet('prizes/p_'+id, toSave);
    // Delete old integer key if it existed
    try { await dbDelete('prizes/'+id); } catch(e) {}
    if (photos.some(p => p.full)) {
      await dbSet('photos/p_'+id, photos.map(p => p.full || p));
    }
    updateSyncStatus('connected');
  } catch(e) {
    updateSyncStatus('error');
    showToast('Firebase error — change stored locally only.', 'error');
  }
  return _prizes[id];
}

async function deletePrize(id, skipTrash) {
  // Safety net: copy the whole prize (and its full photos) to "Recently deleted" first.
  // (skipTrash is only for housekeeping, e.g. merging records that were just copied.)
  if (!skipTrash) await trashPrize(id);
  delete _prizes[id];
  // Try both key formats (old prizes used integer keys, new ones use p_ prefix)
  try { await dbDelete('prizes/p_'+id); } catch(e) {}
  try { await dbDelete('prizes/'+id); } catch(e) {}
  // Also clean up photos
  try { await dbDelete('photos/p_'+id); } catch(e) {}
  try { await dbDelete('photos/'+id); } catch(e) {}
}

async function addItemType(name) {
  if (!_meta.itemTypes) _meta.itemTypes = ['Book','Bookish item','Clothing','Jewelry','Misc'];
  if (!_meta.itemTypes.includes(name)) {
    _meta.itemTypes.push(name);
    await dbSet('meta/itemTypes', _meta.itemTypes);
  }
}

// ── Sync poll ────────────────────────────────────────────────────────────
let _pollInterval = null;
// ── Backups (dated history) + Recently deleted ───────────────────
const BACKUP_KEY = 'soiree_prize_backup';
const SNAP_KEEP = 7;                       // how many dated backups to keep
const SNAP_MIN_GAP = 4*60*60*1000;         // automatic backup at most every 4 hours
const TRASH_DAYS = 30;                     // how long deleted prizes can be restored
let _snapBusy = false;

async function dbKeys(path) {
  try {
    const res = await fetch(`${window.FIREBASE_DB_URL}/${path}.json?shallow=true`);
    if (!res.ok) return [];
    const o = await res.json();
    return o ? Object.keys(o) : [];
  } catch(e) { return []; }
}

function fmtWhen(ts) {
  if (!ts) return 'unknown date';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) + ' at ' +
         d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

// Called after every load/save. Keeps a quick local copy, and takes a dated
// Firebase backup if the newest one is older than SNAP_MIN_GAP.
function saveBackup() {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify({prizes:_prizes, meta:_meta, ts:Date.now()})); } catch(e) {}
  maybeSnapshot();
}

async function maybeSnapshot() {
  try {
    if (_snapBusy || !window.FIREBASE_DB_URL) return;
    if (!Object.keys(_prizes).length) return;
    const idx = await dbGet('snapshotIndex');
    const latest = idx ? Math.max.apply(null, Object.values(idx).map(function(v){ return v.ts||0; })) : 0;
    if (Date.now() - latest < SNAP_MIN_GAP) return;
    await takeSnapshot('automatic');
  } catch(e) {}
}

async function takeSnapshot(label) {
  _snapBusy = true;
  try {
    const ts = Date.now();
    const key = 's_'+ts;
    const prizes = {};
    Object.values(_prizes).forEach(function(p){
      prizes['p_'+p.id] = {...p, photos:(p.photos||[]).map(function(x){ return {thumb:x.thumb}; })};
    });
    const count = Object.keys(prizes).length;
    const units = prizeTally(Object.values(_prizes)).prizes;
    await dbSet('snapshots/'+key, {ts:ts, count:count, units:units, label:label||'automatic', prizes:prizes, meta:_meta});
    await dbSet('snapshotIndex/'+key, {ts:ts, count:count, units:units, label:label||'automatic'});
    // keep only the newest SNAP_KEEP
    const idx = await dbGet('snapshotIndex') || {};
    const keys = Object.keys(idx).sort(function(x,y){ return (idx[y].ts||0)-(idx[x].ts||0); });
    for (let i=SNAP_KEEP; i<keys.length; i++) {
      await dbDelete('snapshots/'+keys[i]);
      await dbDelete('snapshotIndex/'+keys[i]);
    }
    return true;
  } catch(e) { return false; }
  finally { _snapBusy = false; }
}

async function listSnapshots() {
  const idx = await dbGet('snapshotIndex') || {};
  return Object.keys(idx).map(function(k){ return {key:k, ts:idx[k].ts, count:idx[k].count, units:idx[k].units, label:idx[k].label}; })
    .sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
}

async function doBackup() {
  const ok = await takeSnapshot('manual');
  showToast(ok ? 'Backed up '+Object.keys(_prizes).length+' prizes ✓' : 'Backup failed', ok?'success':'error');
  renderPMSettings();
}

// Prizes that are in a backup but not in the app now (deleted or lost since then).
async function snapshotMissing(key) {
  const snap = await dbGet('snapshots/'+key);
  if (!snap || !snap.prizes) return null;
  const all = Object.values(snap.prizes).filter(function(p){ return p && p.id!==undefined; });
  const missing = all.filter(function(p){ return !_prizes[p.id]; });
  const added = getPrizes().filter(function(p){ return !all.some(function(q){ return q.id===p.id; }); }).length;
  return {snap:snap, missing:missing, added:added};
}

// Brings back only the chosen prizes (ids) from a backup; nothing else changes.
async function restoreSelectedFromSnapshot(key, ids) {
  try {
    const snap = await dbGet('snapshots/'+key);
    if (!snap || !snap.prizes) { showToast('Backup not found','error'); return; }
    const pick = Object.values(snap.prizes).filter(function(p){ return p && ids.indexOf(String(p.id))!==-1 && !_prizes[p.id]; });
    if (!pick.length) { showToast('Nothing to restore'); return; }
    let maxId = 0;
    for (const p of pick) {
      await dbSet('prizes/p_'+p.id, p);
      _prizes[p.id] = {...p, photos:p.photos||[]};
      maxId = Math.max(maxId, +p.id||0);
    }
    if ((_meta.nextId||1) <= maxId) { _meta.nextId = maxId+1; try { await dbSet('meta/nextId', _meta.nextId); } catch(e) {} }
    showToast('Brought back '+pick.length+' prize'+(pick.length===1?'':'s')+' ✓');
    if (typeof renderGoals==='function') renderGoals();
    if (typeof renderPrizes==='function') renderPrizes();
    renderPMSettings();
  } catch(e) { showToast('Restore failed: '+e.message,'error'); }
}

// Replaces EVERYTHING with the backup. Takes a safety backup first.
async function restoreAllFromSnapshot(key) {
  try {
    const snap = await dbGet('snapshots/'+key);
    if (!snap || !snap.prizes) { showToast('Backup not found','error'); return; }
    const n = Object.keys(snap.prizes).length;
    if (!confirm('REPLACE all '+Object.keys(_prizes).length+' current prizes with the '+n+' from the '+fmtWhen(snap.ts)+' backup?\n\nAnything added or changed since then will be lost (a safety backup of right now is taken first).')) return;
    await takeSnapshot('before restore');
    _prizes = normalizePrizes(snap.prizes);
    if (snap.meta) _meta = {..._meta, ...snap.meta};
    await dbSet('prizes', snap.prizes);
    showToast('Restored '+n+' prizes ✓');
    if (typeof renderGoals==='function') renderGoals();
    if (typeof renderPrizes==='function') renderPrizes();
    renderPMSettings();
  } catch(e) { showToast('Restore failed: '+e.message,'error'); }
}

// ── Recently deleted ────────────────────────────────────────────
async function trashPrize(id) {
  try {
    const p = _prizes[id];
    if (!p || !window.FIREBASE_DB_URL) return;
    let fulls = null;
    try { fulls = await dbGet('photos/p_'+id); } catch(e) {}
    if (!fulls) fulls = (p.photos||[]).map(function(x){ return x.full; }).filter(Boolean);
    const rec = {...p, photos:(p.photos||[]).map(function(x){ return {thumb:x.thumb}; })};
    await dbSet('trash/p_'+id, {prize:rec, photos:fulls||[], deletedAt:Date.now()});
  } catch(e) { try { showToast('Could not save to Recently deleted','error'); } catch(_) {} }
}

// Used when only SOME of a multi-quantity prize is deleted: keep a copy of the deleted part.
async function trashCopy(p, qty) {
  try {
    if (!p || !window.FIREBASE_DB_URL) return;
    const rec = {...p, qty:qty, photos:(p.photos||[]).map(function(x){ return {thumb:x.thumb}; })};
    await dbSet('trash/p_'+p.id+'_part'+Date.now(), {prize:rec, photos:[], deletedAt:Date.now()});
  } catch(e) {}
}

async function listTrash() {
  const o = await dbGet('trash') || {};
  const cutoff = Date.now() - TRASH_DAYS*86400000;
  const out = [];
  for (const k of Object.keys(o)) {
    const t = o[k];
    if (!t || !t.prize) continue;
    if ((t.deletedAt||0) < cutoff) { dbDelete('trash/'+k); continue; }   // older than 30 days: clean up
    out.push({key:k, deletedAt:t.deletedAt, prize:t.prize});
  }
  return out.sort(function(a,b){ return (b.deletedAt||0)-(a.deletedAt||0); });
}

// Restores one trash entry. qty (optional) = restore only that many units of it.
async function restoreFromTrash(key, qty, silent) {
  try {
    const t = await dbGet('trash/'+key);
    if (!t || !t.prize) { if(!silent) showToast('Not found','error'); return false; }
    const p = {...t.prize};
    const have = Math.max(1, parseInt(p.qty,10) || 1);
    const take = (qty && qty < have) ? qty : have;
    if (_prizes[p.id]) { p.id = _meta.nextId || 1; }   // partial deletes reuse an existing id: give it a fresh one
    p.qty = take;
    if (p.bundledInto && !getPrizes().some(function(q){ return q.isBundle && q.name===p.bundledInto; })) p.bundledInto = null;
    await dbSet('prizes/p_'+p.id, p);
    const fulls = t.photos || [];
    if (fulls.length) await dbSet('photos/p_'+p.id, fulls);
    _prizes[p.id] = {...p, photos:(p.photos||[]).map(function(x,i){ return {thumb:x.thumb, full:fulls[i]||x.thumb}; })};
    if ((_meta.nextId||1) <= +p.id) { _meta.nextId = (+p.id)+1; try { await dbSet('meta/nextId', _meta.nextId); } catch(e) {} }
    if (take < have) {
      // some units stay in Recently deleted
      await dbSet('trash/'+key+'/prize/qty', have - take);
    } else {
      await dbDelete('trash/'+key);
    }
    if (!silent) {
      showToast('Restored “'+(p.name||'prize')+'”'+(take>1?' × '+take:'')+' ✓');
      if (typeof renderGoals==='function') renderGoals();
      if (typeof renderPrizes==='function') renderPrizes();
      renderPMSettings();
    }
    return true;
  } catch(e) { if(!silent) showToast('Restore failed: '+e.message,'error'); return false; }
}

// Restores k units out of a group of identical trash entries (same name + donor).
async function restoreTrashGroup(keys, k) {
  let left = k, done = 0;
  for (const key of keys) {
    if (left <= 0) break;
    const t = await dbGet('trash/'+key);
    if (!t || !t.prize) continue;
    const q = Math.max(1, parseInt(t.prize.qty,10) || 1);
    const take = Math.min(q, left);
    if (await restoreFromTrash(key, take, true)) { left -= take; done += take; }
  }
  if (typeof renderGoals==='function') renderGoals();
  if (typeof renderPrizes==='function') renderPrizes();
  showToast(done ? 'Restored '+done+' ✓' : 'Nothing restored', done?'success':'error');
  renderPMSettings();
}

async function purgeTrashItem(key) {
  if (!confirm('Permanently delete this? It cannot be restored after this.')) return;
  await dbDelete('trash/'+key);
  renderPMSettings();
}

function updateSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (status === 'connected') {
    el.innerHTML = '<i class="ti ti-cloud-check" style="font-size:13px"></i> Synced';
    el.style.color = 'var(--green)';
  } else if (status === 'error') {
    el.innerHTML = '<i class="ti ti-cloud-off" style="font-size:13px"></i> Sync error';
    el.style.color = 'var(--red)';
  } else {
    el.innerHTML = '<i class="ti ti-refresh" style="font-size:13px;animation:spin 1s linear infinite"></i> Syncing…';
    el.style.color = 'var(--text3)';
  }
}

function startSync(onChange) {
  if (_pollInterval) clearInterval(_pollInterval);
  let tick = 0, busy = false;
  _pollInterval = setInterval(async () => {
    // Skip while the app is in a background tab or a previous check is still running.
    if (document.hidden || busy) return;
    busy = true;
    try {
      tick++;
      const r = await dbGetIfChanged('prizes');
      let changed = false;
      // Only overwrite local prizes if Firebase actually has data
      // This prevents a failed write from being overwritten by empty Firebase
      if (r.changed && r.data && Object.keys(r.data).length > 0) {
        _prizes = normalizePrizes(r.data);
        changed = true;
      }
      // The author list almost never changes, so check it only every 5th time.
      if (tick % 5 === 0) {
        const authors = await loadAuthorsFromHQ();
        if (authors && authors.length > 0) { _authors = authors; changed = true; }
      }
      if (changed) onChange();
    } catch(e) {}
    busy = false;
  }, 20000);
}
function stopSync() {
  if (_pollInterval) clearInterval(_pollInterval);
}
