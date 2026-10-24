// goals.js — goals bar with notes and numbered prize lists
//
// This used to be stored purely in localStorage, which never synced to
// Firebase or across devices/browsers — and could get silently wiped
// (e.g. Safari clearing storage after inactivity). Now backed by Firebase
// at hq/prizeGoals, loaded once into _goalsCache at boot via
// loadGoalsFromFirebase(), with a one-time migration that pushes up
// whatever's still sitting in this device's localStorage (if Firebase
// has nothing yet) so any not-yet-lost local data gets rescued.
var CAT_GOALS_KEY = 'prize_goals';
var _goalsCache = { targets:{}, notes:{}, lists:{} };

async function loadGoalsFromFirebase() {
  try {
    var remote = await dbGet('hq/prizeGoals');
    var cache = {
      targets: (remote && remote.targets) || {},
      notes:   (remote && remote.notes)   || {},
      lists:   (remote && remote.lists)   || {}
    };

    // Per-field rescue: even if Firebase already has *some* data (e.g. just
    // the auto-computed BINGO target from a different device), still pull
    // in anything this specific device still has locally that Firebase's
    // copy is missing — rather than skipping the whole check just because
    // Firebase wasn't completely empty.
    var localTargets = JSON.parse(localStorage.getItem(CAT_GOALS_KEY)||'{}');
    var changed = false;
    Object.keys(localTargets).forEach(function(cat){
      if (cache.targets[cat] === undefined) { cache.targets[cat] = localTargets[cat]; changed = true; }
    });
    ['BINGO','Raffle','Medium','Small'].forEach(function(cat){
      var n = localStorage.getItem('goal_notes_'+cat);
      if (n && !cache.notes[cat]) { cache.notes[cat] = n; changed = true; }
      var l = localStorage.getItem('goal_prize_list_'+cat);
      if (l) {
        try {
          var parsed = JSON.parse(l);
          if (parsed.length && (!cache.lists[cat] || !cache.lists[cat].length)) {
            cache.lists[cat] = parsed; changed = true;
          }
        } catch(e){}
      }
    });

    _goalsCache = cache;
    if (changed) {
      await dbSet('hq/prizeGoals', _goalsCache);
      showToast('Recovered goal lists from this device \u2014 now synced');
    }
  } catch(e) { console.error('loadGoalsFromFirebase error:', e); }
}
function persistGoalsCache() {
  dbSet('hq/prizeGoals', _goalsCache).catch(function(){});
}
// Lighter refresh for the periodic sync poll — no migration logic, just
// pulls whatever's currently in Firebase so edits from another
// device/browser show up here too.
async function refreshGoalsCache() {
  try {
    var remote = await dbGet('hq/prizeGoals');
    if (remote) {
      _goalsCache = { targets: remote.targets||{}, notes: remote.notes||{}, lists: remote.lists||{} };
    }
  } catch(e) {}
}

function getGoals() {
  return Object.assign({BINGO:185, Raffle:7, Medium:10, Small:10}, _goalsCache.targets);
}
function saveGoal(cat, val) {
  _goalsCache.targets[cat] = +val;
  persistGoalsCache();
}
function promptGoal(cat) {
  var cur = +getGoals()[cat] || 0;
  var input = prompt('Set the '+cat+' goal:', String(cur));
  if (input === null) return;
  var n = parseInt(input, 10);
  if (isNaN(n) || n < 0) { showToast('Please enter a valid number', 'error'); return; }
  saveGoal(cat, n);
  renderGoals();
}
async function loadBINGOGoal() {
  try {
    var att = await dbGet('hq/attendance');
    if (att && att.total) {
      _goalsCache.targets.BINGO = (+att.total||175) + 10;
      persistGoalsCache();
    }
  } catch(e) {}
}
function getGoalNotes(cat) {
  return _goalsCache.notes[cat] || '';
}
function getGoalPrizeList(cat) {
  return _goalsCache.lists[cat] || [];
}
function saveGoalPrizeList(cat, items) {
  _goalsCache.lists[cat] = items;
  persistGoalsCache();
  saveGoal(cat, items.length);
}

// Notes modal for Raffle
function openGoalNotes(cat) {
  var current = getGoalNotes(cat);
  var mc = document.getElementById('modal-container');
  mc.innerHTML = '';
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modal-bg';
  // Clicking outside the modal no longer closes it — must use X or Cancel/Save.
  var box = document.createElement('div'); box.className = 'modal';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '<i class="ti ti-x"></i>';
  closeBtn.onclick = closeModal;
  var h3 = document.createElement('h3'); h3.textContent = cat+' notes';
  var label = document.createElement('label');
  label.style.cssText = 'font-size:11px;color:var(--text2);display:block;margin-bottom:4px';
  label.textContent = 'Notes for '+cat+' prizes';
  var ta = document.createElement('textarea');
  ta.id = 'gn-notes'; ta.rows = 4; ta.style.width = '100%';
  ta.placeholder = 'e.g. Farthest traveled, Book bingo winner\u2026';
  ta.value = current;
  var actions = document.createElement('div'); actions.className = 'm-actions';
  var cancelBtn = document.createElement('button'); cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel'; cancelBtn.onclick = closeModal;
  var saveBtn = document.createElement('button'); saveBtn.className = 'btn primary';
  saveBtn.innerHTML = '<i class="ti ti-check"></i> Save';
  saveBtn.onclick = function(){ _goalsCache.notes[cat] = ta.value.trim(); persistGoalsCache(); closeModal(); showToast('Notes saved'); renderGoals(); };
  actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
  box.appendChild(closeBtn); box.appendChild(h3); box.appendChild(label); box.appendChild(ta); box.appendChild(actions);
  overlay.appendChild(box); mc.appendChild(overlay);
  setTimeout(function(){ ta.focus(); }, 50);
}

// Numbered prize list modal for Medium and Small
function openGoalPrizeList(cat) {
  var items = getGoalPrizeList(cat);

  function render() {
    var mc = document.getElementById('modal-container');
    mc.innerHTML = '';
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'modal-bg';
    // Clicking outside the modal no longer closes it — must use X or Done.
    var box = document.createElement('div'); box.className = 'modal';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close'; closeBtn.innerHTML = '<i class="ti ti-x"></i>'; closeBtn.onclick = closeModal;
    var h3 = document.createElement('h3'); h3.textContent = cat+' prizes ('+items.length+')';
    var sub = document.createElement('p');
    sub.style.cssText = 'font-size:11px;color:var(--text2);margin-bottom:10px';
    sub.textContent = 'Each line = one prize slot. The count sets your goal.';
    var listDiv = document.createElement('div');
    listDiv.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:320px;overflow-y:auto';

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text3);font-size:13px;text-align:center;padding:20px';
      empty.textContent = 'No prizes yet. Tap "+ Add prize slot" below.';
      listDiv.appendChild(empty);
    }

    items.forEach(function(item, i) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg2);border-radius:var(--radius-sm);border:.5px solid var(--border)';
      var num = document.createElement('span');
      num.style.cssText = 'font-size:12px;color:var(--text3);font-weight:600;min-width:24px;flex-shrink:0';
      num.textContent = (i+1)+'.';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.value = item;
      inp.placeholder = 'Prize description\u2026';
      inp.style.cssText = 'flex:1;font-size:13px;border:none;background:transparent;color:var(--text);font-family:inherit;padding:0;outline:none';
      inp.onblur = (function(idx){ return function(){ items[idx] = this.value; saveGoalPrizeList(cat, items); renderGoals(); }; })(i);
      inp.onkeydown = function(e){ if(e.key==='Enter') this.blur(); };
      var del = document.createElement('button');
      del.innerHTML = '<i class="ti ti-trash" style="font-size:13px"></i>';
      del.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text3);padding:2px;flex-shrink:0';
      del.title = 'Delete';
      del.onclick = function(){ items.splice(i,1); saveGoalPrizeList(cat,items); renderGoals(); render(); };
      row.appendChild(num); row.appendChild(inp); row.appendChild(del);
      listDiv.appendChild(row);
    });

    var addBtn = document.createElement('button');
    addBtn.className = 'btn primary';
    addBtn.style.cssText = 'width:100%;justify-content:center;margin-bottom:4px';
    addBtn.innerHTML = '<i class="ti ti-plus"></i> Add prize slot';
    addBtn.onclick = function(){ items.push(''); saveGoalPrizeList(cat,items); renderGoals(); render(); setTimeout(function(){ var inputs = listDiv.querySelectorAll('input'); if(inputs.length) inputs[inputs.length-1].focus(); }, 100); };

    var actions = document.createElement('div'); actions.className = 'm-actions';
    var doneBtn = document.createElement('button'); doneBtn.className = 'btn primary'; doneBtn.textContent = 'Done';
    doneBtn.onclick = function(){ saveGoalPrizeList(cat,items); renderGoals(); closeModal(); };
    actions.appendChild(doneBtn);

    box.appendChild(closeBtn); box.appendChild(h3); box.appendChild(sub);
    box.appendChild(listDiv); box.appendChild(addBtn); box.appendChild(actions);
    overlay.appendChild(box); mc.appendChild(overlay);
  }
  render();
}

function renderGoals() {
  var el = document.getElementById('goals-bar');
  if (!el) return;
  var prizes = getPrizes().filter(function(p){ return !p.bundledInto; });
  var goals = getGoals();
  var budgetEl = document.getElementById('budget-bar');
  if (budgetEl) renderBudgetBar(prizes, budgetEl);

  // Simple count-only card (no goal/needed comparison) — used for
  // Unassigned and SWAG, which don't have a target to hit. Just the label
  // and a bare number, nothing else.
  function simpleCountCard(label, count) {
    return '<div class="goal-card"><div style="font-size:10px;color:var(--text2);text-align:center">'+label+'</div>'+
      '<div style="font-size:15px;font-weight:700;text-align:center;margin-top:2px">'+count+'</div></div>';
  }

  function goalCardHtml(cat) {
    // For Medium/Small, goal = number of items in prize list — fully
    // derived, not something to edit directly on the card at all.
    var isList = (cat==='Medium' || cat==='Small');
    var isAuto = (cat==='BINGO');
    var listItems = isList ? getGoalPrizeList(cat) : null;
    var goal = listItems ? listItems.length : (goals[cat] || 0);
    var have = prizes.filter(function(p){ return p.cat===cat; }).reduce(function(s,p){ return s+(+p.qty||1); }, 0);
    var need = Math.max(0, goal-have);
    var cls  = have>=goal ? 'green' : need<=5 ? 'amber' : 'red';
    // Plain oval, just the number — no steppers (too small to tap, and the
    // extra width was forcing "needed" onto two lines). Medium/Small are
    // purely derived from the Edit list count, so the oval isn't tappable
    // there. Raffle's isn't list-derived, so tapping it prompts for a new
    // number directly.
    var goalDisplay = '<span style="display:inline-block;border:1px solid var(--border2);border-radius:8px;padding:0 6px;font-size:12px;font-weight:600;vertical-align:middle'+
        (isAuto||isList?'':';cursor:pointer')+'"'+
        (isAuto||isList?'':' onclick="event.stopPropagation();promptGoal(\''+cat+'\')"')+
      '>'+goal+'</span>';
    // Only Medium/Small get an inline edit-list pencil, sitting right next
    // to "needed" — matches the reference exactly (Raffle has none).
    var pencil = isList
      ? '<button onclick="event.stopPropagation();openGoalPrizeList(\''+cat+'\')" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0;margin-left:3px;flex-shrink:0" title="Edit list"><i class="ti ti-pencil" style="font-size:11px"></i></button>'
      : '';
    return '<div class="goal-card" style="border-color:var(--'+cls+')">'+
      '<div style="font-size:11px;color:var(--text2);text-align:center">'+cat+'</div>'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:3px">'+
        '<span style="font-size:12px;color:var(--text2);white-space:nowrap">'+have+'/ '+goalDisplay+'</span>'+
        '<span style="display:flex;align-items:center">'+
          '<span style="font-size:13px;font-weight:700;color:var(--'+cls+');white-space:nowrap">'+(need>0?need+' needed':'\u2713 Done')+'</span>'+
          pencil+
        '</span>'+
      '</div>'+
    '</div>';
  }

  var uncatCount = prizes.filter(function(p){ return p.cat==='Uncategorized'; }).reduce(function(s,p){ return s+(+p.qty||1); }, 0);
  var swagCount  = prizes.filter(function(p){ return p.cat==='SWAG Bag'; }).reduce(function(s,p){ return s+(+p.qty||1); }, 0);

  // Row 1: Prizes, Raffle, Unassigned · Row 2: Medium, Small, SWAG
  var html =
    goalCardHtml('BINGO') +
    goalCardHtml('Raffle') +
    simpleCountCard('Unassigned', uncatCount) +
    goalCardHtml('Medium') +
    goalCardHtml('Small') +
    simpleCountCard('SWAG', swagCount);

  el.innerHTML = html;
}

function budgetRow(label, budget, spent) {
  var left = budget - spent;
  var pct = budget > 0 ? Math.min(100, Math.round(spent/budget*100)) : 0;
  var color = left >= 0 ? 'var(--green)' : 'var(--red)';
  return '<div style="background:var(--bg);border:.5px solid var(--border);border-radius:var(--radius-md);padding:8px 12px;margin-bottom:6px">'+
    '<div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:6px">'+
      '<div style="height:100%;background:'+color+';width:'+pct+'%;border-radius:3px"></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;font-size:12px;flex-wrap:wrap;align-items:center">'+
      '<span style="font-weight:600;min-width:50px">'+label+':</span>'+
      '<span>Spent: <strong style="color:var(--amber)">'+fmt$(spent)+'</strong></span>'+
      '<span style="color:var(--text3)">\u00b7</span>'+
      '<span>Budget: <strong>'+fmt$(budget)+'</strong></span>'+
      '<span style="color:var(--text3)">\u00b7</span>'+
      '<span>Left: <strong style="color:'+color+'">'+fmt$(left)+'</strong></span>'+
    '</div>'+
  '</div>';
}

async function renderBudgetBar(prizes, el) {
  try {
    var expenses = await dbGet('hq/expenses');
    if (!expenses) { el.innerHTML=''; return; }
    var arr = typeof expenses==='object' ? Object.values(expenses) : [];
    var prizeLine  = arr.find(function(e){ return e && e.id==='prizes_budget'; });
    var raffleLine = arr.find(function(e){ return e && e.id==='raffle'; });
    var prizeBudget  = +(prizeLine?.fixedAmt||0);
    var raffleBudget = +(raffleLine?.fixedAmt||0);
    // "Prizes" total = BINGO + Medium + Small + Small add-on + Unassigned; Raffle and SWAG excluded.
    // Raffle and SWAG Bag are tracked separately and excluded here.
    var PRIZE_BUDGET_CATS = ['BINGO','Medium','Small','Small add-on','Uncategorized'];
    var prizeSpent  = prizes.filter(function(p){ return PRIZE_BUDGET_CATS.indexOf(p.cat)!==-1; }).reduce(function(s,p){ return s+(+p.paid||0); }, 0);
    var raffleSpent = prizes.filter(function(p){ return p.cat==='Raffle'; }).reduce(function(s,p){ return s+(+p.paid||0); }, 0);
    var html = '';
    if (prizeBudget  > 0) html += budgetRow('Bingo and small prizes',  prizeBudget,  prizeSpent);
    if (raffleBudget > 0) html += budgetRow('Raffle',  raffleBudget, raffleSpent);
    el.innerHTML = html;
  } catch(e) { el.innerHTML=''; }
}
