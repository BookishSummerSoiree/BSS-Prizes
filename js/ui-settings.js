function renderSettings(){
  const el=document.getElementById('tab-settings');
  if(!el) return;
  el.innerHTML=`
    <div class="card">
      <div class="card-title">Firebase connection</div>
      <div class="sett-section">
        <div class="sf full" style="margin-bottom:8px"><label>Firebase Database URL</label>
          <input type="text" id="s-fb" value="${escHtml(window.FIREBASE_DB_URL||'')}"
            placeholder="https://your-project-default-rtdb.firebaseio.com"
            style="width:100%;font-family:monospace;font-size:12px">
        </div>
        <button class="btn primary" onclick="saveFirebaseUrl()"><i class="ti ti-check"></i> Save &amp; connect</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Account</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div class="avatar">${currentUser()?.avatar||'??'}</div>
        <div>
          <div style="font-weight:600">${escHtml(currentUser()?.displayName||'')}</div>
          <div style="font-size:12px;color:var(--text2)">${escHtml(currentUser()?.role||'')}</div>
        </div>
      </div>
      <button class="btn danger" onclick="doSignOut()"><i class="ti ti-logout"></i> Sign out</button>
    </div>
    <div class="danger-zone">
      <h3><i class="ti ti-alert-triangle"></i> Danger zone</h3>
      <p style="font-size:12px;color:var(--text2);margin-bottom:8px">These actions affect live data.</p>
      <button class="btn danger" onclick="confirmReset()"><i class="ti ti-refresh"></i> Reset all prize data</button>
    </div>`;
}
function saveFirebaseUrl(){
  const url=document.getElementById('s-fb')?.value?.trim()||'';
  window.FIREBASE_DB_URL=url;
  localStorage.setItem('soiree_firebase_url',url);
  showToast('Firebase URL saved');
  loadPrizes().then(()=>{renderPrizes();renderTags();renderBudget();});
}
function confirmReset(){
  if(!confirm('Delete ALL prize data from Firebase? This cannot be undone.')) return;
  if(!confirm('Are you absolutely sure? All prizes will be permanently deleted.')) return;
  dbSet('prizes',{}).then(()=>{
    _prizes={};renderPrizes();renderTags();renderBudget();
    showToast('All prize data cleared');
  });
}
