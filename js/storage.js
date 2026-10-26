// storage.js — Firebase + helpers
window.FIREBASE_DB_URL = localStorage.getItem('soiree_firebase_url') || 'https://soiree-prizes-2027-default-rtdb.firebaseio.com';

async function dbGet(path) {
  if (!window.FIREBASE_DB_URL) return null;
  try {
    const res = await fetch(`${window.FIREBASE_DB_URL}/${path}.json`);
    return res.ok ? res.json() : null;
  } catch(e) { return null; }
}
// Conditional read for polling: asks Firebase for an ETag and sends it back next time,
// so when nothing changed the answer is a tiny "304 not modified" instead of the whole
// prize list (with every photo thumbnail). Falls back to a normal read if the browser or
// server doesn't cooperate.
const _etags = {};
let _etagBroken = false;
async function dbGetIfChanged(path) {
  if (!window.FIREBASE_DB_URL) return {changed:false, data:null};
  if (!_etagBroken) {
    try {
      const headers = {'X-Firebase-ETag':'true'};
      if (_etags[path]) headers['If-None-Match'] = _etags[path];
      const res = await fetch(`${window.FIREBASE_DB_URL}/${path}.json`, {headers, cache:'no-store'});
      if (res.status === 304) return {changed:false, data:null};
      if (res.ok) {
        const tag = res.headers.get('ETag');
        if (tag) { _etags[path] = tag; return {changed:true, data:await res.json()}; }
        _etagBroken = true;   // header not readable here: stop trying
        return {changed:true, data:await res.json()};
      }
      return {changed:false, data:null};
    } catch(e) { _etagBroken = true; }
  }
  const data = await dbGet(path);
  return {changed:data !== null, data};
}
async function dbSet(path, data) {
  if (!window.FIREBASE_DB_URL) {
    throw new Error('No Firebase URL configured');
  }
  const res = await fetch(`${window.FIREBASE_DB_URL}/${path}.json`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
  if (!res.ok) {
    throw new Error('Firebase write failed: ' + res.status);
  }
  return res;
}
async function dbDelete(path) {
  if (!window.FIREBASE_DB_URL) return;
  try {
    await fetch(`${window.FIREBASE_DB_URL}/${path}.json`, {method:'DELETE'});
  } catch(e) {}
}

// ── Image compression ────────────────────────────────────────────────────────
function compressImage(file, maxWidth=1000, quality=0.65) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h*maxWidth/w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function makeThumbnail(dataUrl, maxWidth=150, quality=0.5) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h*maxWidth/w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmt$(n) {
  return '$'+(+(n||0)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function showToast(msg, type='success') {
  let t = document.getElementById('toast');
  if (!t) { t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = type==='error' ? '#D94040' : '#1D9E75';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function showModal(html) {
  const mc = document.getElementById('modal-container');
  if (!mc) return;
  mc.innerHTML = `<div class="modal-overlay" id="modal-bg" onclick="closeModalOutside(event)">
    <div class="modal">
      <button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>
      ${html}
    </div>
  </div>`;
}
function closeModal() {
  // If a "remove from bundle" flow is mid-way (e.g. someone tapped the X or
  // clicked outside instead of the flow's own Cancel button), route through
  // its cancel handler first so an in-progress Edit Bundle rename/category
  // change gets restored instead of silently discarded.
  if (typeof _removeFlow !== 'undefined' && _removeFlow && typeof cancelRemoveFlow === 'function') {
    cancelRemoveFlow();
    return;
  }
  const mc = document.getElementById('modal-container');
  if (mc) mc.innerHTML = '';
  // Always reset prize edit state when modal closes
  if (typeof _editMode !== 'undefined')       _editMode = false;
  if (typeof _currentPrizeId !== 'undefined') _currentPrizeId = 0;
  resetZoom();
}
// Safety net alongside the 16px input font-size fix (which stops iOS from
// auto-zooming in the first place): if someone manually pinch-zoomed while
// filling out a form, snap back to normal zoom once that form closes.
// Briefly toggling maximum-scale forces Safari to reset the current scale.
function resetZoom() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute('content');
  meta.setAttribute('content', original + ', maximum-scale=1.0');
  setTimeout(() => meta.setAttribute('content', original), 50);
}
function closeModalOutside(e) { /* no-op: clicking outside a modal no longer closes it — use the X or Cancel/Save buttons */ }

async function loadAuthorsFromHQ() {
  try {
    const data = await dbGet('authors');
    if (data) {
      return Object.values(data)
        .filter(a => a && a.name && (a.status==='Confirmed'||a.status==='Asked'))
        .map(a => a.name).sort();
    }
  } catch(e) {}
  return [];
}
