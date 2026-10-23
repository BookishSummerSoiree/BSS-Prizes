// prizes.js — prize list, add/edit modal, bundle system

// ── State ─────────────────────────────────────────────────────────────────────
var _filterCat     = '';
var _searchQ       = '';
var _prizeDebounce = null;
var _pendingPhotos = [];
var _bundleMode    = false;
var _bundleAnchor  = null;
var _bundleSelected = new Set();
var _bundleQty = {}; // prizeId -> how many of its qty go into the in-progress bundle
var _expandedStacks = new Set(); // names of stacks currently expanded on the main list
var _currentPrizeId = 0;
var _editMode       = false;
var _removeFlow      = null; // in-progress "remove from bundle" flow state
var _filterDonations = false; // "Donations" toggle — layers on top of category filter
var _filterItemType = ''; // '' = no filter; otherwise an exact itemType string
var _sortMode = null; // null | 'az' | 'category' | 'value' | 'donations'

const CATEGORIES = ['BINGO','Raffle','Medium','Small','SWAG Bag','Uncategorized'];
const CAT_LABELS = {'SWAG Bag':'SWAG', 'Uncategorized':'Unassigned'}; // display-only relabeling; underlying cat value is unchanged

function toggleDonationsFilter(){
  _filterDonations = !_filterDonations;
  renderPrizes();
}
function setItemTypeFilter(t){
  _filterItemType = t;
  closeModal();
  renderPrizes();
}
// How many prizes of each item type exist right now (counts by quantity,
// not just record count). Always includes every canonical type (Book,
// Bookish item, Clothing, Jewelry, Misc) even at 0, plus any custom types
// that have been added, so nothing silently disappears from the list just
// because it hasn't been used yet. Bundle wrapper records aren't a "type"
// a donor filled in, so they're excluded here.
function getItemTypeCounts(){
  var counts = {};
  getItemTypes().forEach(function(t){ counts[t] = 0; });
  getPrizes().forEach(function(p){
    if (p.isBundle) return;
    var t = p.itemType || 'Misc';
    counts[t] = (counts[t]||0) + (+p.qty||1);
  });
  return counts;
}
function setSortMode(mode){
  _sortMode = (_sortMode === mode) ? null : mode; // tap again to turn back off
  renderPrizes();
}
// Secondary sort applied within whatever grouping already exists (e.g.
// search-relevance tiers). With no sort mode active, this is a no-op and
// the list keeps its natural order.
// A bundle has no value of its own: it is worth its items added together.
function sortValueOf(p){
  if (p && p.isBundle) {
    var bName = p.name || String(p.id), bItems = p.bundleItems || [];
    return getPrizes().filter(function(x){
      return !x.isBundle && (x.bundledInto===bName || bItems.indexOf(x.id)>-1 || bItems.indexOf(String(x.id))>-1);
    }).reduce(function(s,x){ return s+(+x.value||0); }, 0);
  }
  return +(p && p.value) || 0;
}
function sortComparator(a, b){
  if (_sortMode === 'az') {
    return (a.name||'').localeCompare(b.name||'');
  }
  if (_sortMode === 'category') {
    var ai = CATEGORIES.indexOf(a.cat), bi = CATEGORIES.indexOf(b.cat);
    if (ai !== bi) return ai - bi;
    return (a.name||'').localeCompare(b.name||'');
  }
  if (_sortMode === 'value') {
    // Prizes with no value yet come first (so they're easy to find and fill
    // in), then everything else from lowest to highest value.
    var av = sortValueOf(a), bv = sortValueOf(b);
    if (!av !== !bv) return !av ? -1 : 1;
    if (av !== bv) return av - bv;
    return (a.name||'').localeCompare(b.name||'');
  }
  if (_sortMode === 'donations') {
    // Donated prizes first, grouped by who donated them (A-Z), then the rest.
    var ad = (a.donor||'').trim(), bd = (b.donor||'').trim();
    if (!ad !== !bd) return ad ? -1 : 1;
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.name||'').localeCompare(b.name||'');
  }
  return 0;
}

// ── Render prizes list ────────────────────────────────────────────────────────
function renderPrizes() {
  var el = document.getElementById('prizes-content');
  if (!el) return;

  var bundleBar = '';
  if (_bundleMode) {
    bundleBar = '<div style="background:var(--purple-bg);border:.5px solid var(--purple);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:10px">'+
      '<div style="font-size:13px;font-weight:600;color:var(--purple-text);margin-bottom:6px"><i class="ti ti-packages"></i> Building bundle — '+_bundleSelected.size+' items selected</div>'+
      '<div style="font-size:12px;color:var(--purple-text);margin-bottom:8px">Tap other '+(getPrize(_bundleAnchor)?.cat||'')+' prizes below to add them.</div>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="btn primary" onclick="finishBundle()" style="background:var(--purple);color:white;border-color:var(--purple)"><i class="ti ti-check"></i> Done — Name bundle</button>'+
        '<button class="btn" onclick="cancelBundle()">Cancel</button>'+
      '</div>'+
    '</div>';
  }

  el.innerHTML = bundleBar +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">'+
      '<div id="prize-counts" style="font-size:13px;color:var(--text2)"></div>'+
      '<button class="btn primary" onclick="openAddPrize()"><i class="ti ti-plus"></i> Add prize</button>'+
    '</div>'+
    '<div style="margin-bottom:8px">'+
      '<input type="text" id="prize-search" value="'+escHtml(_searchQ)+'" placeholder="Search prizes, donors, notes\u2026" style="width:100%;font-size:16px;padding:8px 12px" oninput="debouncePrizeSearch(this.value)">'+
    '</div>'+
    '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
      '<span style="font-size:11px;color:var(--text3)">Sort by:</span>'+
      '<button class="cat-btn'+(_sortMode==='az'?' active':'')+'" onclick="setSortMode(\'az\')">A-Z</button>'+
      '<button class="cat-btn'+(_sortMode==='category'?' active':'')+'" onclick="setSortMode(\'category\')">Category</button>'+
      '<button class="cat-btn'+(_sortMode==='value'?' active':'')+'" onclick="setSortMode(\'value\')">Value'+(function(){ var n=getPrizes().filter(function(p){ return p && !p.isBundle && !(+p.value); }).length; return n ? ' ('+n+' blank)' : ''; })()+'</button>'+
      '<button class="cat-btn'+(_sortMode==='donations'?' active':'')+'" onclick="setSortMode(\'donations\')">Donations</button>'+
    '</div>'+
    '<div style="border-top:1px solid var(--border2);margin-bottom:8px"></div>'+
    '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">'+
      (function(){
        var counts = getItemTypeCounts();
        return getItemTypes().map(function(t){
          return '<button class="cat-btn cat-btn-sm'+(_filterItemType===t?' active':'')+'" onclick="setItemTypeFilter(_filterItemType===\''+jsAttrEscape(t)+'\'?\'\':\''+jsAttrEscape(t)+'\')">'+escHtml(t)+' ('+(counts[t]||0)+')</button>';
        }).join('');
      })()+
    '</div>'+
    '<div style="border-top:1px solid var(--border2);margin-bottom:8px"></div>'+
    '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">'+
      '<button class="cat-btn cat-btn-sm'+ (!_filterCat?' active':'')+'" onclick="_filterCat=\'\';renderPrizes()">All</button>'+
      CATEGORIES.map(function(c){ return '<button class="cat-btn cat-btn-sm'+(_filterCat===c?' active':'')+'" onclick="_filterCat=\''+c+'\';renderPrizes()">'+(CAT_LABELS[c]||c)+'</button>'; }).join('')+
      '<button class="cat-btn cat-btn-sm'+(_filterDonations?' active':'')+'" onclick="toggleDonationsFilter()" style="margin-left:auto;border-color:var(--purple)'+(_filterDonations?';background:var(--purple);color:white':'')+'"><i class="ti ti-gift"></i> Donations</button>'+
    '</div>'+
    '<div id="prize-list-inner" style="display:flex;flex-direction:column;gap:8px"></div>'+
    '<div style="height:300px"></div>';

  updatePrizeListAndCounts();
}

// Rebuilds only the counts text and the prize list itself — does NOT touch
// the search input or category pills, so it's safe to call on every
// keystroke without stealing focus away from the search box.
function updatePrizeListAndCounts() {
  var allPrizes = getPrizes().filter(function(p){ return p && p.id !== undefined; });
  reconcileBundleMembership(allPrizes);
  var bundles   = allPrizes.filter(function(p){ return p.isBundle; });
  var individual = allPrizes.filter(function(p){ return !p.isBundle && !p.bundledInto; });
  var bundled    = allPrizes.filter(function(p){ return !p.isBundle && !!p.bundledInto; });

  var searchFilter = function(p){ return true; };
  var searchTier = function(p){ return 0; };
  if (_searchQ.trim()) {
    var q = _searchQ.toLowerCase();
    searchFilter = function(p){
      return (p.name||'').toLowerCase().includes(q) ||
             (p.notes||'').toLowerCase().includes(q);
    };
    // Tier 0 = matched in the prize name/description, tier 1 = matched only in notes
    searchTier = function(p){
      return (p.name||'').toLowerCase().includes(q) ? 0 : 1;
    };
  }
  var catFilter = function(p){
    if (_filterDonations && !p.donor) return false;
    if (_filterItemType && p.itemType !== _filterItemType) return false;
    return !_filterCat || p.cat === _filterCat;
  };

  var countsEl = document.getElementById('prize-counts');
  if (countsEl) countsEl.textContent = individual.length+' prizes · '+bundled.length+' bundled · '+bundles.length+' bundles';

  buildPrizeList(allPrizes, bundles, individual, bundled, searchFilter, catFilter, searchTier);
}

// A bundle's own bundleItems ID array is the source of truth used by the
// Edit Bundle modal to decide what's inside it. But the main list decides
// whether a prize shows as "bundled" purely from that prize's own
// bundledInto field. If a write gets interrupted (e.g. mid-creation) those
// two can drift apart — an item shows up correctly inside the bundle's own
// item list, but still renders as a free-standing individual card on the
// main list with no blue tint or "Bundled with" label. This reconciles
// that drift on every render: fixes it in memory immediately, and quietly
// persists the correction to Firebase so it doesn't keep recurring.
function reconcileBundleMembership(allPrizes) {
  var bundles = allPrizes.filter(function(p){ return p.isBundle; });
  bundles.forEach(function(b){
    var bItems = b.bundleItems || [];
    if (!bItems.length) return;
    bItems.forEach(function(rawId){
      var id = typeof rawId === 'string' ? parseInt(rawId,10) : rawId;
      var p = getPrize(id);
      if (p && !p.isBundle && p.bundledInto !== b.name) {
        p.bundledInto = b.name; // reflect correctly in this render immediately
        updatePrize(id, {bundledInto: b.name}).catch(function(){}); // persist the fix
      }
    });
  });
}

function toggleStackExpand(name) {
  if (_expandedStacks.has(name)) _expandedStacks.delete(name); else _expandedStacks.add(name);
  updatePrizeListAndCounts();
}
function jsAttrEscape(s){
  return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
}

function stackCard(grp) {
  var name = grp[0].name||'';
  var isExpanded = _expandedStacks.has(name);
  var totalQty = grp.reduce(function(s,p){ return s+(+p.qty||1); }, 0);
  var cat = grp[0].cat;
  var sameCat = grp.every(function(p){ return p.cat===cat; });
  var thumb = null;
  for (var i=0;i<grp.length;i++){ if (grp[i].photos && grp[i].photos[0]) { thumb = grp[i].photos[0].thumb; break; } }

  var thumbHtml = thumb
    ? '<img src="'+thumb+'" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0">'
    : '<div style="width:60px;height:60px;border-radius:6px;background:var(--bg2);border:.5px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center"><i class="ti ti-photo" style="font-size:20px;color:var(--text3)"></i></div>';

  // Two peeking "cards" behind the top one — now more visibly gray with a
  // soft shadow, so the stack itself reads clearly, not just the badge text.
  var header =
    '<div style="position:relative;margin-bottom:'+(isExpanded?'2px':'8px')+'">'+
      '<div style="position:absolute;top:8px;left:7px;right:-7px;bottom:-8px;background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--radius-md);box-shadow:0 2px 4px rgba(0,0,0,.08);z-index:0"></div>'+
      '<div style="position:absolute;top:4px;left:3px;right:-3px;bottom:-4px;background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--radius-md);box-shadow:0 2px 4px rgba(0,0,0,.06);z-index:1"></div>'+
      '<div class="prize-card" style="position:relative;z-index:2;cursor:pointer" onclick="toggleStackExpand(\''+jsAttrEscape(name)+'\')">'+
        '<div style="display:flex;gap:10px;align-items:flex-start">'+
          thumbHtml+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">'+
              (sameCat?'<span class="cat-pill cat-'+(cat||'').toLowerCase().replace(/ /g,'-')+'">'+escHtml(cat||'')+'</span>':'<span style="font-size:10px;color:var(--text3)">Mixed categories</span>')+
              '<span style="font-size:10px;background:var(--purple-bg);color:var(--purple-text);padding:1px 6px;border-radius:8px"><i class="ti ti-stack-2" style="font-size:9px"></i> Stack of '+totalQty+'</span>'+
            '</div>'+
            '<div style="font-size:14px;font-weight:600">'+escHtml(name||'Unnamed prize')+'</div>'+
            '<div style="font-size:11px;color:var(--text2);margin-top:2px">Total qty '+totalQty+' \u00b7 Tap to '+(isExpanded?'collapse':'expand')+'</div>'+
          '</div>'+
          '<div style="flex-shrink:0"><i class="ti ti-chevron-'+(isExpanded?'up':'down')+'" style="font-size:14px;color:var(--text3)"></i></div>'+
        '</div>'+
      '</div>'+
    '</div>';

  var itemsHtml = '';
  if (isExpanded) {
    var rows;
    if (grp.length === 1 && (+grp[0].qty||1) > 1) {
      // Still a single database record — nothing's been split off yet. The
      // collapsed card itself already represents unit #1, so expand only
      // needs to add the other (qty-1) boxes to reach the full count.
      var rec = grp[0];
      var n = +rec.qty || 1;
      rows = '';
      for (var u=1; u<n; u++) { rows += virtualUnitCard(rec, u, n); }
    } else {
      rows = grp.map(function(p){ return prizeCard(p); }).join('');
    }
    itemsHtml = '<div style="margin:0 0 10px 12px;padding-left:10px;border-left:2px solid var(--border2);display:flex;flex-direction:column;gap:6px">'+rows+'</div>';
  }

  return header + itemsHtml;
}

// One visual "box" representing a single unit of a still-unsplit multi-qty
// prize record. Not its own database entity — editing opens the shared
// record (fields apply to all units), but bundling this specific box
// splits off exactly 1 unit when the bundle is actually created.
function virtualUnitCard(p, idx, total) {
  var thumb = p.photos && p.photos[0] ? p.photos[0].thumb : null;
  var thumbHtml = thumb
    ? '<img src="'+thumb+'" style="width:50px;height:50px;object-fit:cover;border-radius:6px;flex-shrink:0">'
    : '<div style="width:50px;height:50px;border-radius:6px;background:var(--bg2);border:.5px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center"><i class="ti ti-photo" style="font-size:16px;color:var(--text3)"></i></div>';
  return '<div class="prize-card" style="cursor:default">'+
    '<div style="display:flex;gap:10px;align-items:flex-start">'+
      thumbHtml+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">'+
          '<span class="cat-pill cat-'+(p.cat||'').toLowerCase().replace(/ /g,'-')+'">'+escHtml(p.cat||'')+'</span>'+
          '<span style="font-size:9px;color:var(--text3)">Unit '+(idx+1)+' of '+total+'</span>'+
        '</div>'+
        '<div style="font-size:14px;font-weight:600">'+escHtml(p.name||'Unnamed prize')+'</div>'+
        (p.value?'<div style="font-size:11px;color:var(--text2);margin-top:2px">Value '+fmt$(p.value)+'</div>':(_sortMode==='value'?'<div style="font-size:11px;color:var(--amber);margin-top:2px">No value yet</div>':''))+
      '</div>'+
      '<div style="flex-shrink:0;padding:4px 2px 4px 8px;cursor:pointer" onclick="openEditPrize('+p.id+')"><i class="ti ti-chevron-right" style="font-size:14px;color:var(--text3)"></i></div>'+
    '</div>'+
    '<div style="text-align:right;margin-top:4px"><button onclick="event.stopPropagation();startBundleFromUnit('+p.id+')" style="font-size:10px;padding:2px 7px;border:.5px solid var(--border2);border-radius:8px;background:transparent;color:var(--text3);cursor:pointer;white-space:nowrap;font-family:inherit"><i class="ti ti-packages" style="font-size:10px"></i> Bundle this one</button></div>'+
  '</div>';
}

function buildPrizeList(allPrizes, bundles, individual, bundled, searchFilter, catFilter, searchTier) {
  var el = document.getElementById('prize-list-inner');
  if (!el) return;
  searchTier = searchTier || function(){ return 0; };
  var bFiltered  = bundles.filter(catFilter).sort(sortComparator);
  var iFiltered  = individual.filter(catFilter).filter(searchFilter).sort(function(a,b){ var t=searchTier(a)-searchTier(b); return t!==0?t:sortComparator(a,b); });
  var bndFiltered = bundled.filter(catFilter).filter(searchFilter).sort(function(a,b){ var t=searchTier(a)-searchTier(b); return t!==0?t:sortComparator(a,b); });

  // Group individual (non-bundled) prizes that share the exact same name into
  // stacks. This naturally re-forms on its own whenever a split-off piece
  // comes back out of a bundle, since it just re-matches by name — no extra
  // bookkeeping needed to "remember" that two records used to be one.
  var groups = {}; var groupOrder = [];
  iFiltered.forEach(function(p){
    var key = p.name||'';
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(p);
  });
  var individualHtml = groupOrder.map(function(key){
    var grp = groups[key];
    // A "stack" is triggered by either signal: multiple distinct records
    // sharing this name, OR a single record whose own qty is > 1. Both mean
    // there's more than one physical unit of this prize to track.
    var totalQty = grp.reduce(function(s,p){ return s+(+p.qty||1); }, 0);
    return (grp.length > 1 || totalQty > 1) ? stackCard(grp) : prizeCard(grp[0]);
  }).join('');

  var topHtml;
  if (_sortMode) {
    // Sorting on: a bundle sorts like any single prize (by its own category,
    // value, name or donor) instead of sitting in its own block at the top.
    var entries = [];
    bFiltered.forEach(function(b){ entries.push({rep:b, html:bundleCard(b)}); });
    groupOrder.forEach(function(key){
      var grp = groups[key];
      var tq = grp.reduce(function(s,p){ return s+(+p.qty||1); }, 0);
      entries.push({rep:grp[0], html:(grp.length > 1 || tq > 1) ? stackCard(grp) : prizeCard(grp[0])});
    });
    entries.forEach(function(e,i){ e.i = i; });
    entries.sort(function(x,y){ return sortComparator(x.rep, y.rep) || (x.i - y.i); });
    topHtml = entries.map(function(e){ return e.html; }).join('');
  } else {
    topHtml = bFiltered.map(function(b){ return bundleCard(b); }).join('') + individualHtml;
  }
  var html = topHtml +
             bndFiltered.map(function(p){ return prizeCard(p); }).join('');
  if (!html) html = '<div style="text-align:center;padding:3rem;color:var(--text3)">No prizes found.</div>';
  el.innerHTML = html;
}

function debouncePrizeSearch(val) {
  _searchQ = val;
  clearTimeout(_prizeDebounce);
  _prizeDebounce = setTimeout(updatePrizeListAndCounts, 150);
}

// ── Prize card ────────────────────────────────────────────────────────────────
function prizeCard(p) {
  var thumb    = p.photos && p.photos[0] ? p.photos[0].thumb : null;
  var tagStage = p.tagGenerated ? 'Tagged' : p.onTote ? '4. On tote' :
                 p.tagAttached ? '3. Attached' : p.tagPrinted ? '2. Printed' :
                 p.tagMade ? '1. Made' : '';
  var isBundled  = !!p.bundledInto;
  var isSelected = _bundleSelected.has(p.id);
  var isAnchor   = _bundleAnchor === p.id;
  // Prizes can only be bundled with others in the same category, so once
  // a bundle is in progress, anything with a different category than the
  // anchor is off-limits — Raffle can bundle, just only with other Raffle.
  var anchorPrize   = _bundleMode ? getPrize(_bundleAnchor) : null;
  var catMismatch   = _bundleMode && anchorPrize && p.cat !== anchorPrize.cat;

  // Bundle mode: tapping anywhere still selects for the bundle. Otherwise,
  // the card body itself does nothing — only the corner button opens edit,
  // so browsing/expanding a stack can't accidentally launch the edit modal.
  var clickFn = _bundleMode
    ? (isBundled || catMismatch ? '' : 'toggleBundleSelect('+p.id+')')
    : '';

  // In bundle mode: category-mismatched prizes can't be bundled with this
  // one — dim them to show they're unselectable. Prizes already in a
  // bundle get a light-blue tint (not dimmed) so they stay readable.
  var opacity = (catMismatch && !isBundled) ? 'opacity:0.45;' : '';
  var border  = (isSelected||isAnchor) ? 'border-color:var(--purple);' : (isBundled ? 'border-color:var(--blue,#3B82F6);' : '');
  var bg      = (isSelected||isAnchor) ? 'background:var(--purple-bg);' : (isBundled ? 'background:var(--blue-bg,#EAF3FF);' : 'background:var(--bg);');

  var checkbox = '';
  if (_bundleMode && !isBundled && !catMismatch) {
    var checked = isSelected || isAnchor;
    checkbox = '<div style="width:22px;height:22px;border-radius:50%;border:2px solid '+(checked?'var(--purple)':'var(--border2)')+';background:'+(checked?'var(--purple)':'transparent')+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(checked?'<i class="ti ti-check" style="font-size:12px;color:white"></i>':'')+'</div>';
  }
  if (_bundleMode && catMismatch && !isBundled) {
    checkbox = '<div style="font-size:9px;color:var(--text3);padding:2px 4px;text-align:center">Diff.<br>category</div>';
  }

  var bundleBtn = (!_bundleMode && !isBundled)
    ? '<button onclick="event.stopPropagation();startBundle('+p.id+')" style="font-size:10px;padding:2px 7px;border:.5px solid var(--border2);border-radius:8px;background:transparent;color:var(--text3);cursor:pointer;white-space:nowrap;font-family:inherit;margin-top:4px"><i class="ti ti-packages" style="font-size:10px"></i> Bundle</button>'
    : '';

  var bundleLabel = isBundled
    ? '<div style="text-align:right;font-size:10px;color:var(--text3);margin-top:4px;font-style:italic">Bundled with '+escHtml(p.bundledInto||'')+'</div>'
    : '';

  var thumbHtml = thumb
    ? '<img src="'+thumb+'" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;cursor:pointer" onclick="event.stopPropagation();viewPhoto('+p.id+',0)">'
    : '<div style="width:60px;height:60px;border-radius:6px;background:var(--bg2);border:.5px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center"><i class="ti ti-photo" style="font-size:20px;color:var(--text3)"></i></div>';

  var extraPhotos = '';
  if (p.photos && p.photos.length > 1) {
    extraPhotos = '<div style="display:flex;gap:4px;margin-top:8px;padding-left:70px;overflow-x:auto">';
    p.photos.slice(1,5).forEach(function(ph,i){
      extraPhotos += '<img src="'+ph.thumb+'" style="width:44px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;cursor:pointer" onclick="event.stopPropagation();viewPhoto('+p.id+','+(i+1)+')">';
    });
    if (p.photos.length > 5) extraPhotos += '<div style="width:44px;height:44px;border-radius:4px;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text2)">+'+(p.photos.length-5)+'</div>';
    extraPhotos += '</div>';
  }

  return '<div class="prize-card" style="'+opacity+border+bg+(_bundleMode?'':'cursor:default;')+'" onclick="'+clickFn+'">'+
    '<div style="display:flex;gap:10px;align-items:flex-start">'+
      checkbox+
      thumbHtml+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">'+
          '<span class="cat-pill cat-'+(p.cat||'').toLowerCase().replace(/ /g,'-')+'">'+escHtml(p.cat||'')+'</span>'+
          '<span style="font-size:10px;color:var(--text3)">'+escHtml(p.itemType||'')+'</span>'+
        '</div>'+
        '<div style="font-size:14px;font-weight:600">'+escHtml(p.name||'Unnamed prize')+'</div>'+
        (p.donor?'<div style="font-size:11px;color:var(--purple-text);margin-top:2px"><i class="ti ti-user" style="font-size:10px"></i> '+escHtml(p.donor)+'</div>':'')+
        '<div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">'+
          (p.value?'<span style="font-size:11px;color:var(--text2)">Value '+fmt$(p.value)+'</span>':(_sortMode==='value'?'<span style="font-size:11px;color:var(--amber)">No value yet</span>':''))+
          '<span style="font-size:11px;color:var(--amber)">Paid '+fmt$(p.paid)+'</span>'+
          (p.qty>1?'<span style="font-size:11px;color:var(--text2)">x'+p.qty+'</span>':'')+
          (tagStage?'<span style="font-size:10px;color:var(--green)">'+tagStage+'</span>':'')+
        '</div>'+
      '</div>'+
      '<div style="flex-shrink:0;padding:4px 2px 4px 8px;cursor:'+(_bundleMode?'default':'pointer')+'" '+(_bundleMode?'':'onclick="event.stopPropagation();openEditPrize('+p.id+')"')+'><i class="ti ti-chevron-right" style="font-size:14px;color:var(--text3)"></i></div>'+
    '</div>'+
    bundleLabel+
    (bundleBtn?'<div style="text-align:right">'+bundleBtn+'</div>':'')+
    extraPhotos+
  '</div>';
}

// ── Bundle card ───────────────────────────────────────────────────────────────
function bundleCard(b) {
  var bName = b.name || String(b.id);
  var bItems = b.bundleItems || [];
  var items = getPrizes().filter(function(p){
    return !p.isBundle && (p.bundledInto===bName || bItems.indexOf(p.id)>-1 || bItems.indexOf(String(p.id))>-1);
  });
  var isExpanded = !!b._expanded;

  // Photo collage from items
  var allThumbs = [];
  items.forEach(function(p){ (p.photos||[]).forEach(function(ph){ if(allThumbs.length<4) allThumbs.push(ph.thumb||ph); }); });

  var photoGrid = '';
  if (allThumbs.length === 0) {
    photoGrid = '<div style="width:70px;height:70px;border-radius:8px;background:var(--bg2);border:.5px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ti-packages" style="font-size:24px;color:var(--text3)"></i></div>';
  } else if (allThumbs.length === 1) {
    photoGrid = '<img src="'+allThumbs[0]+'" style="width:70px;height:70px;object-fit:cover;border-radius:8px;flex-shrink:0">';
  } else {
    photoGrid = '<div style="width:70px;height:70px;display:grid;grid-template-columns:1fr 1fr;gap:2px;border-radius:8px;overflow:hidden;flex-shrink:0">';
    allThumbs.slice(0,4).forEach(function(src){ photoGrid += '<img src="'+src+'" style="width:100%;height:100%;object-fit:cover">'; });
    photoGrid += '</div>';
  }

  var itemsHtml = '';
  if (isExpanded) {
    itemsHtml = '<div style="margin-top:10px;border-top:.5px solid var(--border);padding-top:10px;display:flex;flex-direction:column;gap:6px">';
    items.forEach(function(p){
      var th = (p.photos&&p.photos[0])
        ? '<img src="'+(p.photos[0].thumb||p.photos[0])+'" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0">'
        : '<div style="width:36px;height:36px;border-radius:4px;background:var(--bg3);flex-shrink:0"></div>';
      itemsHtml += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg2);border-radius:var(--radius-sm)">'+
        th+
        '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">'+escHtml(p.name||'')+'</div>'+
        '<div style="font-size:10px;color:var(--text3)">'+escHtml(p.cat||'')+' · '+escHtml(p.itemType||'')+'</div></div>'+
        '<button onclick="event.stopPropagation();openRemoveFromBundleFlow('+p.id+','+b.id+',false)" style="font-size:10px;padding:2px 7px;border:.5px solid var(--border2);border-radius:8px;background:transparent;color:var(--red);cursor:pointer;font-family:inherit">Remove</button>'+
      '</div>';
    });
    itemsHtml += '</div>';
  }

  var totalValue = items.reduce(function(s,p){ return s+(+p.value||0); },0);

  return '<div class="prize-card" style="border-color:var(--purple);background:var(--bg)">'+
    '<div style="display:flex;gap:10px;align-items:flex-start;cursor:pointer" onclick="toggleBundleExpand('+b.id+')">'+
      photoGrid+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'+
          '<span class="cat-pill cat-'+(b.cat||'').toLowerCase().replace(/ /g,'-')+'">'+escHtml(b.cat||'Bundle')+'</span>'+
          '<span style="font-size:10px;background:var(--purple-bg);color:var(--purple-text);padding:1px 6px;border-radius:8px"><i class="ti ti-packages" style="font-size:9px"></i> Bundle</span>'+
        '</div>'+
        '<div style="font-size:14px;font-weight:700">'+escHtml(b.name||'Bundle')+'</div>'+
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">'+items.length+' items'+(totalValue?' · Value '+fmt$(totalValue):'')+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">Tap to '+(isExpanded?'collapse':'expand')+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">'+
        '<button onclick="event.stopPropagation();openEditBundle('+b.id+')" style="font-size:11px;padding:3px 8px;border:.5px solid var(--border2);border-radius:8px;background:transparent;color:var(--text2);cursor:pointer;font-family:inherit"><i class="ti ti-pencil" style="font-size:11px"></i> Edit</button>'+
        '<i class="ti ti-chevron-'+(isExpanded?'up':'down')+'" style="font-size:14px;color:var(--text3)"></i>'+
      '</div>'+
    '</div>'+
    itemsHtml+
  '</div>';
}

async function toggleBundleExpand(id) {
  var p = getPrize(id);
  if (p) { await updatePrize(id, {_expanded: !p._expanded}); renderPrizes(); }
}

// ── Photo viewer ──────────────────────────────────────────────────────────────
async function viewPhoto(prizeId, idx) {
  var p = getPrize(prizeId);
  if (!p || !p.photos || !p.photos[idx]) return;
  if (!p.photos[idx].full) await loadFullPhotos(prizeId);
  var photo = getPrize(prizeId)?.photos?.[idx];
  if (!photo) return;
  var src = photo.full || photo.thumb || photo;
  var nav = '';
  if (p.photos.length > 1) {
    if (idx > 0) nav += '<button class="btn" onclick="closeModal();viewPhoto('+prizeId+','+(idx-1)+')">‹ Prev</button>';
    if (idx < p.photos.length-1) nav += '<button class="btn" onclick="closeModal();viewPhoto('+prizeId+','+(idx+1)+')">Next ›</button>';
  }
  showModal('<div style="text-align:center"><img src="'+src+'" style="max-width:100%;max-height:70vh;border-radius:8px;object-fit:contain">'+
    '<div style="margin-top:8px;font-size:12px;color:var(--text2)">'+escHtml(p.name||'')+' — Photo '+(idx+1)+' of '+p.photos.length+'</div>'+
    (nav?'<div style="display:flex;justify-content:center;gap:6px;margin-top:8px">'+nav+'</div>':'')+
    '</div><div class="m-actions"><button class="btn" onclick="closeModal()">Close</button></div>');
}

// ── Bundle building ───────────────────────────────────────────────────────────
// If a prize has qty > 1, asks how many of those units should go into the
// bundle, leaving the rest as a separate individual prize. Returns null if
// the person cancels or enters something invalid.
function promptBundleQty(p) {
  var totalQty = +p.qty || 1;
  if (totalQty <= 1) return 1;
  var input = prompt('This prize has a quantity of '+totalQty+'. How many do you want to include in this bundle?\n\nThe rest will stay as a separate individual prize.', '1');
  if (input === null) return null;
  var n = parseInt(input, 10);
  if (!n || n < 1) { showToast('Please enter a number between 1 and '+totalQty, 'error'); return null; }
  if (n > totalQty) n = totalQty;
  return n;
}

// Splits off a new prize record carrying `qty` units when bundling less than
// the full quantity on hand, leaving the remainder behind as its own
// individual prize with the same name. Because stacking groups individual
// prizes purely by matching name (see buildPrizeList), the two halves will
// automatically re-form a stack later if the split-off piece ever comes back
// out of a bundle — no extra bookkeeping needed. Returns the id that should
// actually be marked bundledInto (the split-off record, or the original if
// no split was needed because the whole quantity is going in).
async function resolvePrizeForBundle(prizeId, qty) {
  var p = getPrize(prizeId);
  if (!p) return null;
  var totalQty = +p.qty || 1;
  if (qty >= totalQty) return prizeId;

  var created = await addPrize({
    name: p.name, cat: p.cat, itemType: p.itemType, value: p.value, paid: p.paid,
    qty: qty, loc: p.loc, notes: p.notes,
    donorType: p.donorType, donor: p.donor, donorWebsite: p.donorWebsite,
    donorQRType: p.donorQRType, donorPronoun: p.donorPronoun, donorLogo: p.donorLogo,
    donationTagType: p.donationTagType, author: p.author, bookTitle: p.bookTitle,
    clothingType: p.clothingType, clothingTypeCustom: p.clothingTypeCustom,
    clothingDescription: p.clothingDescription, clothingSize: p.clothingSize, clothingSizeCustom: p.clothingSizeCustom,
    needTag: p.needTag, photos: p.photos||[]
  });
  await updatePrize(prizeId, { qty: totalQty - qty });
  return created ? created.id : null;
}

function startBundle(anchorId) {
  var p = getPrize(anchorId);
  if (!p) return;
  var qty = promptBundleQty(p);
  if (qty === null) return;
  _bundleQty = {}; _bundleQty[anchorId] = qty;
  _bundleMode = true; _bundleAnchor = anchorId; _bundleSelected = new Set([anchorId]);
  renderPrizes(); window.scrollTo(0,0);
}
// Starting a bundle from one specific virtual box of an unsplit multi-qty
// stack — the "how many?" question doesn't apply here since tapping that
// one box already means "just this 1 unit."
function startBundleFromUnit(anchorId) {
  var p = getPrize(anchorId);
  if (!p) return;
  _bundleQty = {}; _bundleQty[anchorId] = 1;
  _bundleMode = true; _bundleAnchor = anchorId; _bundleSelected = new Set([anchorId]);
  renderPrizes(); window.scrollTo(0,0);
}
function toggleBundleSelect(id) {
  if (!_bundleMode) return;
  if (id === _bundleAnchor) return;
  var p = getPrize(id);
  // Block adding prizes already in a different bundle
  if (p && p.bundledInto) {
    showToast('This prize is already in a bundle', 'error');
    return;
  }
  // Prizes can only be bundled with others in the exact same category —
  // Raffle only with Raffle, BINGO only with BINGO, and so on.
  var anchor = getPrize(_bundleAnchor);
  if (p && anchor && p.cat !== anchor.cat) {
    showToast('Can only bundle with other '+(anchor.cat||'')+' prizes', 'error');
    return;
  }
  if (_bundleSelected.has(id)) { _bundleSelected.delete(id); delete _bundleQty[id]; renderPrizes(); return; }
  var qty = promptBundleQty(p);
  if (qty === null) return;
  _bundleQty[id] = qty;
  _bundleSelected.add(id);
  renderPrizes();
}
function cancelBundle() {
  _bundleMode = false; _bundleAnchor = null; _bundleSelected = new Set(); _bundleQty = {}; renderPrizes();
}
function finishBundle() {
  if (_bundleSelected.size < 2) { showToast('Select at least 2 prizes to bundle','error'); return; }
  var anchor = getPrize(_bundleAnchor);
  var sharedCat = anchor ? anchor.cat : '';
  var mc = document.getElementById('modal-container');
  mc.innerHTML = '';
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; // clicking outside no longer closes it — use Cancel/Create bundle
  var box = document.createElement('div'); box.className = 'modal';
  var h3 = document.createElement('h3'); h3.textContent = 'Name this bundle';
  var sub = document.createElement('p'); sub.style.cssText='font-size:12px;color:var(--text2);margin-bottom:12px';
  sub.textContent = _bundleSelected.size+' prizes selected';
  var nf = document.createElement('div'); nf.className='field';
  nf.innerHTML='<label>Bundle name</label><input type="text" id="bundle-name" placeholder="e.g. Dream book set" style="width:100%">';
  var cf = document.createElement('div'); cf.className='field';
  cf.innerHTML='<label>Category</label><select id="bundle-cat" style="width:100%">'+
    CATEGORIES.map(function(c){return '<option value="'+c+'"'+(c===sharedCat?' selected':'')+'>'+(CAT_LABELS[c]||c)+'</option>';}).join('')+'</select>';
  var ac = document.createElement('div'); ac.className='m-actions';
  var cb = document.createElement('button'); cb.className='btn'; cb.textContent='Cancel';
  cb.onclick=function(){overlay.remove();cancelBundle();};
  var sb = document.createElement('button'); sb.className='btn primary';
  sb.innerHTML='<i class="ti ti-packages"></i> Create bundle';
  sb.onclick=createBundle;
  ac.appendChild(cb); ac.appendChild(sb);
  box.appendChild(h3); box.appendChild(sub); box.appendChild(nf); box.appendChild(cf); box.appendChild(ac);
  overlay.appendChild(box); mc.appendChild(overlay);
  setTimeout(function(){ document.getElementById('bundle-name')?.focus(); },50);
}
async function createBundle() {
  var name = document.getElementById('bundle-name')?.value?.trim();
  if (!name) { showToast('Please enter a bundle name','error'); return; }
  var cat = document.getElementById('bundle-cat')?.value || 'BINGO';

  // Resolve each selected prize to the id that actually goes in the bundle,
  // splitting off a new record first if only part of its quantity is included.
  var resolvedIds = [];
  for (var id of _bundleSelected) {
    var bundleQty = _bundleQty[id] || 1;
    var resolvedId = await resolvePrizeForBundle(id, bundleQty);
    if (resolvedId) resolvedIds.push(resolvedId);
  }

  var sel = resolvedIds.map(function(id){return getPrize(id);}).filter(Boolean);
  var allThumbs = []; sel.forEach(function(p){(p.photos||[]).forEach(function(ph){if(allThumbs.length<4)allThumbs.push(ph);});});
  await addPrize({name:name,cat:cat,isBundle:true,bundleItems:resolvedIds,
    value:sel.reduce(function(s,p){return s+(+p.value||0);},0),
    paid:sel.reduce(function(s,p){return s+(+p.paid||0);},0),
    itemType:'Bundle',photos:allThumbs,qty:1,_expanded:false,
    notes:'Bundle: '+sel.map(function(p){return p.name;}).join(', ')});
  for (var rid of resolvedIds) {
    var p=getPrize(rid);
    // Only bundle prizes that aren't already in another bundle
    if(p && !p.isBundle && !p.bundledInto) {
      await updatePrize(rid, {bundledInto: name});
    }
  }
  document.getElementById('modal-container').innerHTML='';
  _bundleMode=false; _bundleAnchor=null; _bundleSelected=new Set(); _bundleQty={};
  showToast('Bundle "'+name+'" created!'); renderPrizes(); renderGoals();
}

// ── Remove-from-bundle flow ─────────────────────────────────────────────────
// Replaces the old native confirm() dialog. When launched from inside the
// Edit Bundle modal (inModal=true), we capture whatever the coordinator/admin
// has already typed into the name/category fields before opening this flow,
// and restore it afterward — so an in-progress rename/category change isn't
// lost just because they also removed an item.
function captureEditBundleOverrides() {
  var nameEl = document.getElementById('eb-name');
  if (!nameEl) return null;
  var catEl = document.getElementById('eb-cat');
  return {name: nameEl.value, cat: catEl ? catEl.value : undefined};
}

function openRemoveFromBundleFlow(prizeId, bundleId, inModal) {
  var p = getPrize(prizeId);
  var bundle = getPrize(bundleId);
  if (!p || !bundle) return;
  _removeFlow = {
    prizeId: prizeId,
    bundleId: bundleId,
    inModal: !!inModal,
    overrides: inModal ? captureEditBundleOverrides() : null
  };
  var otherBundles = getPrizes().filter(function(b){ return b.isBundle && b.id !== bundleId; });
  var html = '<h3>Remove from bundle</h3>'+
    '<p style="font-size:13px;color:var(--text2);margin-bottom:14px">Remove "'+escHtml(p.name||'this prize')+'" from "'+escHtml(bundle.name||'')+'"?</p>'+
    '<div style="display:flex;flex-direction:column;gap:8px">'+
      '<button class="btn primary" onclick="confirmRemoveAsIndividual()"><i class="ti ti-package-off"></i> Remove — make individual prize</button>'+
      (otherBundles.length ? '<button class="btn" onclick="showMoveToBundleList()"><i class="ti ti-arrows-right-left"></i> Move to another bundle</button>' : '')+
    '</div>'+
    '<div class="m-actions"><button class="btn" onclick="cancelRemoveFlow()">Cancel</button></div>';
  showModal(html);
}

function cancelRemoveFlow() {
  var flow = _removeFlow; _removeFlow = null;
  if (flow && flow.inModal) {
    openEditBundle(flow.bundleId, flow.overrides);
  } else {
    closeModal();
  }
}

// Detaches a prize from bundleName, auto-disbanding the bundle if it would
// drop below 2 remaining items. Returns true if the bundle got disbanded.
async function detachFromBundle(bundleName) {
  var remaining = getPrizes().filter(function(q){ return q.bundledInto===bundleName && !q.isBundle; });
  if (remaining.length < 2) {
    var br = getPrizes().find(function(q){ return q.isBundle && q.name===bundleName; });
    if (br) {
      for (var i=0;i<remaining.length;i++) await updatePrize(remaining[i].id,{bundledInto:null});
      await deletePrize(br.id);
      showToast('Bundle disbanded — only 1 item left');
      return true;
    }
  }
  return false;
}

async function confirmRemoveAsIndividual() {
  var flow = _removeFlow;
  if (!flow) return;
  var p = getPrize(flow.prizeId);
  if (!p) { _removeFlow=null; closeModal(); return; }
  var bundleName = p.bundledInto;
  await updatePrize(flow.prizeId, {bundledInto: null});
  var disbanded = bundleName ? await detachFromBundle(bundleName) : false;
  if (!disbanded) showToast('Removed from bundle');

  renderPrizes(); renderGoals();
  _removeFlow = null;
  if (flow.inModal && !disbanded) {
    openEditBundle(flow.bundleId, flow.overrides);
  } else {
    closeModal();
  }
}

function showMoveToBundleList() {
  var flow = _removeFlow;
  if (!flow) return;
  var otherBundles = getPrizes().filter(function(b){ return b.isBundle && b.id !== flow.bundleId; });
  var html = '<h3>Move to which bundle?</h3>'+
    '<div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;margin-bottom:12px">'+
      otherBundles.map(function(b){
        return '<button class="btn" style="text-align:left;justify-content:flex-start" onclick="showRenameTargetBundle('+b.id+')">'+escHtml(b.name||'Bundle')+'</button>';
      }).join('')+
    '</div>'+
    '<div class="m-actions"><button class="btn" onclick="cancelRemoveFlow()">Cancel</button></div>';
  showModal(html);
}

function showRenameTargetBundle(targetBundleId) {
  var flow = _removeFlow;
  if (!flow) return;
  var target = getPrize(targetBundleId);
  if (!target) return;
  flow.targetBundleId = targetBundleId;
  var html = '<h3>Rename bundle?</h3>'+
    '<p style="font-size:13px;color:var(--text2);margin-bottom:10px">Moving into "'+escHtml(target.name||'')+'". Edit the name below if you want to rename it, or leave it as is.</p>'+
    '<div class="field"><label>Bundle name</label><input type="text" id="move-target-name" value="'+escHtml(target.name||'')+'" style="width:100%"></div>'+
    '<div class="m-actions">'+
      '<button class="btn" onclick="cancelRemoveFlow()">Cancel</button>'+
      '<button class="btn primary" onclick="saveMoveToBundle()"><i class="ti ti-check"></i> Save</button>'+
    '</div>';
  showModal(html);
  setTimeout(function(){ document.getElementById('move-target-name')?.focus(); },50);
}

async function saveMoveToBundle() {
  var flow = _removeFlow;
  if (!flow || !flow.targetBundleId) return;
  var newName = document.getElementById('move-target-name')?.value?.trim();
  var target = getPrize(flow.targetBundleId);
  if (!target) { _removeFlow=null; closeModal(); return; }
  if (!newName) { showToast('Please enter a bundle name','error'); return; }

  // Rename the target bundle everywhere (its record + all its current items) if changed
  if (newName !== target.name) {
    var targetItems = getPrizes().filter(function(p){ return p.bundledInto===target.name && !p.isBundle; });
    for (var i=0;i<targetItems.length;i++) await updatePrize(targetItems[i].id,{bundledInto:newName});
    await updatePrize(flow.targetBundleId, {name:newName});
  }

  var p = getPrize(flow.prizeId);
  var oldBundleName = p ? p.bundledInto : null;
  await updatePrize(flow.prizeId, {bundledInto: newName});
  var disbandedOld = oldBundleName ? await detachFromBundle(oldBundleName) : false;

  showToast('Moved to "'+newName+'"');
  renderPrizes(); renderGoals();

  var inModal = flow.inModal, bundleId = flow.bundleId, overrides = flow.overrides;
  _removeFlow = null;
  if (inModal && !disbandedOld) {
    openEditBundle(bundleId, overrides);
  } else {
    closeModal();
  }
}

function openEditBundle(id, overrides) {
  overrides = overrides || {};
  var b = getPrize(id);
  if (!b||!b.isBundle) return;
  var bName = b.name||String(b.id);
  var bItems = b.bundleItems || [];
  var items = getPrizes().filter(function(p){
    if (p.isBundle) return false;
    // Match by bundledInto name OR by bundleItems ID array
    return p.bundledInto===bName || 
           bItems.indexOf(p.id)>-1 || 
           bItems.indexOf(String(p.id))>-1 ||
           bItems.indexOf(+p.id)>-1;
  });
  var itemIds = new Set(items.map(function(p){return p.id;}));
  var avail = getPrizes().filter(function(p){
    return !p.isBundle && !p.bundledInto && p.cat===b.cat && !itemIds.has(p.id);
  });
  var nameVal = overrides.name !== undefined ? overrides.name : (b.name||'');
  var catVal  = overrides.cat  !== undefined ? overrides.cat  : (b.cat||'');
  showModal(
    '<h3>Edit bundle</h3>'+
    '<div class="field"><label>Bundle name</label><input type="text" id="eb-name" value="'+escHtml(nameVal)+'" style="width:100%"></div>'+
    '<div class="field"><label>Category</label><select id="eb-cat" style="width:100%">'+
      CATEGORIES.map(function(c){return '<option value="'+c+'"'+(catVal===c?' selected':'')+'>'+(CAT_LABELS[c]||c)+'</option>';}).join('')+
    '</select></div>'+
    '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px">In bundle ('+items.length+')</div>'+
    '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px">'+
      items.map(function(p){return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg2);border-radius:var(--radius-sm)">'+
        '<div style="flex:1;font-size:12px">'+escHtml(p.name||'')+'</div>'+
        '<button onclick="openRemoveFromBundleFlow('+p.id+','+id+',true)" style="font-size:10px;padding:2px 7px;border:.5px solid var(--border2);border-radius:8px;background:transparent;color:var(--red);cursor:pointer;font-family:inherit">Remove</button>'+
      '</div>';}).join('')+
    '</div>'+
    (avail.length?'<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px">Add to bundle</div>'+
    '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;max-height:200px;overflow-y:auto">'+
      avail.map(function(p){return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg2);border-radius:var(--radius-sm)">'+
        '<div style="flex:1;font-size:12px">'+escHtml(p.name||'')+'</div>'+
        '<button onclick="addToExistingBundle('+p.id+','+id+')" style="font-size:10px;padding:2px 7px;border:.5px solid var(--border2);border-radius:8px;background:transparent;color:var(--purple-text);cursor:pointer;font-family:inherit">+ Add</button>'+
      '</div>';}).join('')+
    '</div>':'')+
    '<div class="m-actions">'+
      '<button class="btn danger" onclick="confirmDeleteBundle('+id+')"><i class="ti ti-trash"></i> Delete bundle</button>'+
      '<button class="btn" onclick="_editMode=false;_currentPrizeId=0;closeModal()">Cancel</button>'+
      '<button class="btn primary" onclick="saveEditBundle('+id+')"><i class="ti ti-check"></i> Save</button>'+
    '</div>'
  );
}
async function saveEditBundle(id) {
  var name = document.getElementById('eb-name')?.value?.trim();
  var cat  = document.getElementById('eb-cat')?.value;
  if (!name) { showToast('Please enter a name','error'); return; }
  var oldName = getPrize(id)?.name;
  await updatePrize(id, {name:name,cat:cat});
  if (oldName&&oldName!==name) {
    var items = getPrizes().filter(function(p){return p.bundledInto===oldName;});
    for (var p of items) await updatePrize(p.id,{bundledInto:name});
  }
  closeModal(); showToast('Bundle saved'); renderPrizes();
}
async function addToExistingBundle(prizeId, bundleId) {
  var bundle = getPrize(bundleId);
  if (!bundle) return;
  var p = getPrize(prizeId);
  if (!p) return;
  if (p.cat !== bundle.cat) {
    showToast('Can only bundle with other '+(bundle.cat||'')+' prizes', 'error');
    return;
  }
  var qty = promptBundleQty(p);
  if (qty === null) return;
  var resolvedId = await resolvePrizeForBundle(prizeId, qty);
  if (!resolvedId) return;
  await updatePrize(resolvedId, {bundledInto:bundle.name});
  closeModal(); openEditBundle(bundleId); renderPrizes();
}
async function confirmDeleteBundle(id) {
  var b = getPrize(id);
  if (!b) return;
  var bName = b.name||String(b.id);
  var bItems = b.bundleItems || [];
  var items = getPrizes().filter(function(p){
    if (p.isBundle) return false;
    // Match by bundledInto name OR by bundleItems ID array
    return p.bundledInto===bName || 
           bItems.indexOf(p.id)>-1 || 
           bItems.indexOf(String(p.id))>-1 ||
           bItems.indexOf(+p.id)>-1;
  });
  if (confirm('Delete bundle "'+escHtml(b.name||'')+'"?\n\n'+items.length+' items will return as individual prizes. They will NOT be deleted.')) {
    for (var i=0;i<items.length;i++) await updatePrize(items[i].id,{bundledInto:null});
    await deletePrize(id);
    closeModal(); showToast('Bundle deleted — items restored'); renderPrizes(); renderGoals();
  }
}


// ── Next / Add prize button, and category split popups ───────────────────────
var _pmLastAdvance = 0, _prevCat = 'Uncategorized', _pmSubResolve = null;

function refreshPrimary(){
  var b = document.getElementById('pm-primary'); if(!b) return;
  if (document.querySelector('.modal[data-prize-id]')) return; // edit mode stays "Save"
  var r = document.getElementById('pm-rest'), last = !!(r && r.style.display!=='none');
  b.innerHTML = last ? '<i class="ti ti-check"></i> Add prize' : 'Next <i class="ti ti-arrow-right"></i>';
}
function pmPrimary(){
  var r = document.getElementById('pm-rest');
  if (document.querySelector('.modal[data-prize-id]') || (r && r.style.display!=='none')) { savePrizeModal(); return; }
  if (r) { showToast('Pick a category first','error'); return; }
  pmNext();
}
function pmNext(){
  // Tapping Next blurs the text box first, which already advances the step.
  if (Date.now() - _pmLastAdvance < 700) return;
  if (!document.getElementById('pm-item-type')?.value) { showToast('Pick an item type first','error'); return; }
  var tries = [['pm-author',advanceBookAuthor],['pm-book-title',advanceBookTitle],
    ['pm-clothing-type-custom',advanceClothingTypeCustom],['pm-clothing-size-custom',advanceClothingSizeCustom],
    ['pm-clothing-desc',advanceClothingDesc],['pm-bookish-desc',advanceBookishDesc],['pm-name',advancePrizeDescription]];
  for (var i=0;i<tries.length;i++){
    var el = document.getElementById(tries[i][0]);
    if (el) {
      if (!el.value.trim()) { showToast('Please fill this in first','error'); el.focus(); return; }
      tries[i][1](); return;
    }
  }
  showToast('Tap one of the options first','error');
}

function catLabelOf(c){ return CAT_LABELS[c] || c; }
function pmSubOpen(html){
  pmSubClose();
  var o = document.createElement('div');
  o.className = 'modal-overlay'; o.id = 'pm-sub-bg'; o.style.zIndex = 300;
  o.innerHTML = '<div class="modal">'+html+'</div>';
  document.body.appendChild(o);
}
function pmSubClose(){ var o=document.getElementById('pm-sub-bg'); if(o) o.remove(); }
function pmSubDone(v){
  var r=_pmSubResolve; _pmSubResolve=null; pmSubClose(); if(r) r(v);
}
// Resolves to: a number (how many to change), 'some' (add mode), or null (cancelled)
function askSplitChoice(o){
  var N=o.total, lab=escHtml(catLabelOf(o.label));
  return new Promise(function(resolve){
    _pmSubResolve = resolve;
    var h = '<h3>Set category to '+lab+'?</h3>'+
      '<p style="font-size:13px;color:var(--text2);margin:0 0 12px">You have '+N+' of these. Is '+lab+' the category for:</p>'+
      '<div style="display:flex;flex-direction:column;gap:8px">'+
        '<button class="btn primary" onclick="pmSubDone('+N+')">All '+N+' of them</button>'+
        (o.mode==='edit'?'<button class="btn" onclick="pmSubDone(1)">Just this one</button>':'')+
        '<button class="btn" onclick="'+(o.mode==='edit'?"document.getElementById(\'pm-some-row\').style.display=\'flex\';document.getElementById(\'pm-some-n\').focus()":"pmSubDone(\'some\')")+'">Some of them</button>'+
        (o.mode==='edit'?'<div id="pm-some-row" style="display:none;align-items:center;gap:8px"><input type="number" id="pm-some-n" min="1" max="'+N+'" style="width:90px" placeholder="how many"> <span>/ '+N+'</span> <button class="btn primary" onclick="pmSomeApply('+N+')">Apply</button></div>':'')+
        '<button class="btn" onclick="pmSubDone(null)">Cancel</button>'+
      '</div>';
    pmSubOpen(h);
  });
}
function pmSomeApply(N){
  var n = parseInt(document.getElementById('pm-some-n')?.value);
  if (!n || n<1 || n>N) { showToast('Enter a number from 1 to '+N,'error'); return; }
  pmSubDone(n);
}
// Resolves to {category: qty, ...} or null (cancelled). Save is disabled until the total matches.
function askCategoryAlloc(N, start){
  return new Promise(function(resolve){
    _pmSubResolve = resolve;
    var rows = CATEGORIES.map(function(c,i){
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><span>'+escHtml(catLabelOf(c))+'</span>'+
        '<input type="number" class="pm-alloc" data-cat="'+escHtml(c)+'" min="0" inputmode="numeric" style="width:90px" value="'+((start&&start[c])||'')+'" oninput="pmAllocUpdate('+N+')"></div>';
    }).join('');
    pmSubOpen('<h3>Split '+N+' across categories</h3>'+
      '<div id="pm-alloc-math" style="font-weight:600;margin:0 0 12px"></div>'+rows+
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'+
        '<button class="btn" onclick="pmSubDone(null)">Cancel</button>'+
        '<button class="btn primary" id="pm-alloc-save" onclick="pmAllocSave('+N+')">Save</button></div>');
    pmAllocUpdate(N);
  });
}
function pmAllocRead(){
  var out={}; document.querySelectorAll('.pm-alloc').forEach(function(i){ var n=parseInt(i.value)||0; if(n>0) out[i.dataset.cat]=n; });
  return out;
}
function pmAllocUpdate(N){
  var a=pmAllocRead(), sum=0; for(var k in a) sum+=a[k];
  var left=N-sum, m=document.getElementById('pm-alloc-math'), b=document.getElementById('pm-alloc-save');
  if(m){
    m.textContent = left===0 ? 'Assigned '+sum+' of '+N+' ✓' : (left>0 ? 'Assigned '+sum+' of '+N+' · '+left+' left' : 'Assigned '+sum+' of '+N+' · '+(-left)+' too many');
    m.style.color = left===0 ? 'var(--success, #2e7d32)' : (left<0 ? 'var(--danger, #c62828)' : 'var(--text)');
  }
  if(b) b.disabled = left!==0;
}
function pmAllocSave(N){
  var a=pmAllocRead(), sum=0; for(var k in a) sum+=a[k];
  if(sum!==N){ showToast('The quantities must add up to '+N,'error'); return; }
  pmSubDone(a);
}
function pmAllocNote(a){
  return 'Split: '+Object.keys(a).map(function(c){return a[c]+' × '+catLabelOf(c);}).join(', ')+
    ' · <a href="#" onclick="pmReopenAlloc();return false" style="color:var(--accent,inherit)">change</a>';
}
async function pmReopenAlloc(){
  var N=parseInt(document.getElementById('pm-qty')?.value)||1, cur={};
  try{ cur=JSON.parse(document.getElementById('pm-cat-alloc').value||'{}'); }catch(e){}
  var a = await askCategoryAlloc(N, cur);
  if(a){ document.getElementById('pm-cat-alloc').value=JSON.stringify(a); document.getElementById('pm-cat-note').innerHTML=pmAllocNote(a); }
}
function setCatUI(c){
  var h=document.getElementById('pm-cat'); if(h) h.value=c||'';
  document.querySelectorAll('#prize-details [data-cat]').forEach(function(b){ b.classList.toggle('active', b.dataset.cat===c); });
}
async function pickCat(newCat){
  var box=document.querySelector('.modal[data-prize-id]');
  var N=parseInt(document.getElementById('pm-qty')?.value)||1;
  var splitEl=document.getElementById('pm-cat-split'), allocEl=document.getElementById('pm-cat-alloc'), note=document.getElementById('pm-cat-note');
  splitEl.value=''; allocEl.value=''; note.innerHTML='';
  setCatUI(newCat);
  if (box) {
    var p=getPrize(parseInt(box.dataset.prizeId)), orig=p?p.cat:'';
    if (N>1 && newCat!==orig) {
      var k = await askSplitChoice({total:N,label:newCat,mode:'edit'});
      if (k===null) { setCatUI(orig); return; }
      if (k<N) {
        splitEl.value=k;
        note.textContent = k+' of '+N+' will move to '+catLabelOf(newCat)+'; the other '+(N-k)+' stay '+catLabelOf(orig)+'.';
      }
    }
  } else if (N>1) {
    var r = await askSplitChoice({total:N,label:newCat,mode:'add'});
    if (r===null) { setCatUI(_prevCat); return; }
    if (r==='some') {
      var a = await askCategoryAlloc(N);
      if (!a) { setCatUI(_prevCat); return; }
      allocEl.value=JSON.stringify(a); note.innerHTML=pmAllocNote(a);
    }
  }
  _prevCat = newCat;
  var rest=document.getElementById('pm-rest');
  if (rest && rest.style.display==='none') { rest.style.display=''; }
  refreshPrimary();
}

// ── Add/Edit prize modal ──────────────────────────────────────────────────────
function savePrizeModal() {
  // Read prize ID from modal data attribute (more reliable than global state)
  var box = document.querySelector('.modal[data-prize-id]');
  var modalPrizeId = box ? parseInt(box.dataset.prizeId) : 0;
  if (modalPrizeId) {
    doEditPrize(modalPrizeId);
  } else if (_editMode && _currentPrizeId) {
    doEditPrize(_currentPrizeId);
  } else {
    doAddPrize();
  }
}

async function openAddPrize() {
  _editMode = false; _currentPrizeId = 0; _pendingPhotos = [];
  // Small delay to ensure any previous modal is fully gone
  await new Promise(function(r){ setTimeout(r, 50); });
  await showPrizeModal(null, getAuthors(), getItemTypes());
}

async function openEditPrize(id) {
  // Always hard-reset first to ensure clean state
  _editMode = false; _currentPrizeId = 0; _pendingPhotos = [];
  var p = getPrize(id);
  if (!p) { showToast('Prize not found', 'error'); return; }
  _pendingPhotos = [...(p.photos||[])];
  _editMode = true;
  _currentPrizeId = id;
  // Small delay to ensure any previous modal is fully gone
  await new Promise(function(r){ setTimeout(r, 50); });
  await showPrizeModal(p, getAuthors(), getItemTypes());
}

async function showPrizeModal(p, authors, itemTypes) {
  var isEdit = !!p;
  var prizeId = p ? p.id : 0;
  var currentItemType = (p&&p.itemType)||'';

  var typeBtns = itemTypes.map(function(t){
    return '<button class="cat-btn'+(currentItemType===t?' active':'')+'" onclick="selectItemType(\''+escHtml(t)+'\')" id="itype-'+t.replace(/ /g,'_')+'">'+escHtml(t)+'</button>';
  }).join('')+'<button class="cat-btn" onclick="addNewItemType()"><i class="ti ti-plus"></i> New</button>';

  var actions = '<div class="m-actions">'+
    (isEdit?'<button class="btn danger" onclick="confirmDeletePrize('+p.id+')"><i class="ti ti-trash"></i> Delete</button>':'')+
    '<button class="btn" onclick="closeModal()">Cancel</button>'+
    '<button class="btn primary" id="pm-primary" onclick="pmPrimary()">'+(isEdit?'<i class="ti ti-check"></i> Save':'Next <i class="ti ti-arrow-right"></i>')+'</button>'+
  '</div>';

  var mc = document.getElementById('modal-container');
  mc.innerHTML = '';
  var overlay = document.createElement('div');
  overlay.className='modal-overlay'; overlay.id='modal-bg';
  // Clicking outside the modal no longer closes it — must use X, Cancel, or Save.
  var box = document.createElement('div');
  box.className='modal';
  if (prizeId) box.dataset.prizeId = String(prizeId);

  box.innerHTML =
    '<button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>'+
    '<h3>'+(isEdit?'Edit prize':'Add prize')+'</h3>'+
    '<div class="field"><label>Item type</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+typeBtns+'</div><input type="hidden" id="pm-item-type" value="'+escHtml(currentItemType)+'"></div>'+
    '<div id="prize-details"></div>'+
    actions;

  overlay.appendChild(box);
  mc.appendChild(overlay);

  // Add mode: everything below Item Type stays hidden until a type is picked.
  // Edit mode: the type is already known, so reveal the rest immediately.
  if (currentItemType) {
    selectItemType(currentItemType, p);
  }
}

// Reads whatever's already been filled in below Item Type, so switching
// types mid-entry doesn't silently wipe category/value/donor/etc.
function captureCurrentDetails(){
  var donorFieldsEl = document.getElementById('donor-fields');
  return {
    cat: document.getElementById('pm-cat')?.value||'',
    value: document.getElementById('pm-value')?.value||'',
    paid: document.getElementById('pm-paid')?.value||'',
    qty: document.getElementById('pm-qty')?.value||'',
    loc: document.getElementById('pm-loc')?.value||'',
    notes: document.getElementById('pm-notes')?.value||'',
    donorType: donorFieldsEl?(donorFieldsEl.dataset.donorType||'none'):'none',
    donor: document.getElementById('pm-donor')?.value||'',
    donorWebsite: document.getElementById('pm-website')?.value||'',
    donorQRType: document.getElementById('pm-qrtype')?.value||'website',
    donorPronoun: document.getElementById('pm-pronoun')?.value||'their',
    donorLogo: document.getElementById('pm-logo')?.value||'',
  };
}

function selectItemType(t, preFill) {
  _pmLastAdvance = Date.now();
  _selectItemTypeInner(t, preFill);
  refreshPrimary();
}
function _selectItemTypeInner(t, preFill) {
  document.querySelectorAll('[id^="itype-"]').forEach(function(b){b.classList.remove('active');});
  var btn=document.getElementById('itype-'+t.replace(/ /g,'_')); if(btn)btn.classList.add('active');
  var inp=document.getElementById('pm-item-type'); if(inp)inp.value=t;

  var el = document.getElementById('prize-details');
  if (!el) return;

  // If details were already showing (user picked a type, then changed their
  // mind), carry forward the generic fields rather than wiping them.
  var carried = el.innerHTML.trim() ? captureCurrentDetails() : null;
  var pf = preFill || carried || null;

  var isEdit = !!(pf && pf.id);
  var isBook = t==='Book';
  var isClothing = t==='Clothing';
  var isBookish = t==='Bookish item';

  var nameSection;
  if (isBook) {
    var authorVal = (pf&&pf.author)||'';
    // Legacy prizes saved before this field existed: fall back to showing
    // the old manually-typed name in Title so it isn't silently lost.
    var titleVal = (pf&&pf.bookTitle) || ((pf&&pf.id&&!pf.author) ? (pf.name||'') : '');

    // Add flow only: step through Author, then Title, one at a time —
    // nothing else on screen until both are filled in. Edit mode (data
    // already exists) skips straight to showing both together.
    if (!isEdit && !authorVal) {
      el.innerHTML = '<div class="field"><label>Author</label><input type="text" id="pm-author" placeholder="Author name" onblur="advanceBookAuthor()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>';
      document.getElementById('pm-author')?.focus();
      return;
    }
    if (!isEdit && !titleVal) {
      el.innerHTML =
        '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Author: <b>'+escHtml(authorVal)+'</b></div>'+
        '<div class="field"><label>Title of book/series</label><input type="text" id="pm-book-title" placeholder="Book or series title" onblur="advanceBookTitle()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>'+
        '<input type="hidden" id="pm-author-hidden" value="'+escHtml(authorVal)+'">';
      document.getElementById('pm-book-title')?.focus();
      return;
    }
    nameSection =
      '<div class="field"><label>Author</label><input type="text" id="pm-author" value="'+escHtml(authorVal)+'" placeholder="Author name"></div>'+
      '<div class="field"><label>Title of book/series</label><input type="text" id="pm-book-title" value="'+escHtml(titleVal)+'" placeholder="Book or series title"></div>';

  } else if (isClothing) {
    var ctype=(pf&&pf.clothingType)||'';
    var ctypeCustom=(pf&&pf.clothingTypeCustom)||'';
    var csize=(pf&&pf.clothingSize)||'';
    var csizeCustom=(pf&&pf.clothingSizeCustom)||'';
    var descVal = (pf&&pf.clothingDescription) || ((pf&&pf.id&&!pf.clothingType) ? (pf.name||'') : '');
    var ctypeResolved = ctype==='Other' ? ctypeCustom : ctype;
    var ctypeReady = ctype && (ctype!=='Other' || ctypeCustom);
    var csizeReady = csize && (csize!=='Custom' || csizeCustom);

    // Stage 1: Type of clothing only
    if (!isEdit && !ctypeReady) {
      el.innerHTML =
        '<div class="field"><label>Type of clothing</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+
          ['T-shirt','Sweatshirt','Hat','Other'].map(function(ct){
            return '<button type="button" class="cat-btn'+(ctype===ct?' active':'')+'" onclick="pickClothingType(\''+ct+'\')" id="ctype-'+ct.replace(/[^a-zA-Z]/g,'')+'">'+ct+'</button>';
          }).join('')+
        '</div>'+
        (ctype==='Other'?'<div style="margin-top:6px"><input type="text" id="pm-clothing-type-custom" placeholder="Describe the clothing type" onblur="advanceClothingTypeCustom()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>':'')+
        '</div>';
      if (ctype==='Other') document.getElementById('pm-clothing-type-custom')?.focus();
      return;
    }
    // Stage 2: Size only
    if (!isEdit && !csizeReady) {
      el.innerHTML =
        '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Type: <b>'+escHtml(ctypeResolved)+'</b></div>'+
        '<div class="field"><label>Size</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+
          ['XS','S','M','L','XL','XXL','XXXL','One size','Other'].map(function(sz){
            var val=sz==='Other'?'Custom':sz;
            return '<button type="button" class="cat-btn'+(csize===val?' active':'')+'" onclick="pickClothingSize(\''+val+'\')" id="csize-'+val.replace(/[^a-zA-Z]/g,'')+'">'+sz+'</button>';
          }).join('')+
        '</div>'+
        (csize==='Custom'?'<div style="margin-top:6px"><input type="text" id="pm-clothing-size-custom" placeholder="Enter size" onblur="advanceClothingSizeCustom()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>':'')+
        '</div>'+
        '<input type="hidden" id="pm-clothing-type-hidden" value="'+escHtml(ctype)+'">'+
        '<input type="hidden" id="pm-clothing-type-custom-hidden" value="'+escHtml(ctypeCustom)+'">';
      if (csize==='Custom') document.getElementById('pm-clothing-size-custom')?.focus();
      return;
    }
    // Stage 3: Description only
    if (!isEdit && !descVal) {
      var csizeResolved = csize==='Custom' ? csizeCustom : csize;
      el.innerHTML =
        '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Type: <b>'+escHtml(ctypeResolved)+'</b> \u00b7 Size: <b>'+escHtml(csizeResolved)+'</b></div>'+
        '<div class="field"><label>Description</label><input type="text" id="pm-clothing-desc" placeholder="e.g. navy with gold logo" onblur="advanceClothingDesc()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>'+
        '<input type="hidden" id="pm-clothing-type-hidden" value="'+escHtml(ctype)+'">'+
        '<input type="hidden" id="pm-clothing-type-custom-hidden" value="'+escHtml(ctypeCustom)+'">'+
        '<input type="hidden" id="pm-clothing-size-hidden" value="'+escHtml(csize)+'">'+
        '<input type="hidden" id="pm-clothing-size-custom-hidden" value="'+escHtml(csizeCustom)+'">';
      document.getElementById('pm-clothing-desc')?.focus();
      return;
    }
    // Stage 4: everything, all editable together
    nameSection =
      '<div class="field"><label>Type of clothing</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+
        ['T-shirt','Sweatshirt','Hat','Other'].map(function(ct){
          return '<button type="button" class="cat-btn'+(ctype===ct?' active':'')+'" onclick="selectClothingType(\''+ct+'\')" id="ctype-'+ct.replace(/[^a-zA-Z]/g,'')+'">'+ct+'</button>';
        }).join('')+
      '</div><input type="hidden" id="pm-clothing-type" value="'+escHtml(ctype)+'">'+
      '<div id="clothing-type-other-field" style="display:'+(ctype==='Other'?'block':'none')+';margin-top:6px"><input type="text" id="pm-clothing-type-custom" value="'+escHtml(ctypeCustom)+'" placeholder="Describe the clothing type"></div>'+
      '</div>'+
      '<div class="field"><label>Size</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+
        ['XS','S','M','L','XL','XXL','XXXL','One size','Other'].map(function(sz){
          var val=sz==='Other'?'Custom':sz;
          return '<button type="button" class="cat-btn'+(csize===val?' active':'')+'" onclick="selectClothingSize(\''+val+'\')" id="csize-'+val.replace(/[^a-zA-Z]/g,'')+'">'+sz+'</button>';
        }).join('')+
      '</div><input type="hidden" id="pm-clothing-size" value="'+escHtml(csize)+'">'+
      '<div id="clothing-size-other-field" style="display:'+(csize==='Custom'?'block':'none')+';margin-top:6px"><input type="text" id="pm-clothing-size-custom" value="'+escHtml(csizeCustom)+'" placeholder="Enter size"></div>'+
      '</div>'+
      '<div class="field"><label>Description</label><input type="text" id="pm-clothing-desc" value="'+escHtml(descVal)+'" placeholder="e.g. navy with gold logo"></div>';

  } else if (isBookish) {
    var btype=(pf&&pf.bookishType)||'';
    var bdescVal = (pf&&pf.bookishDescription) || ((pf&&pf.id&&!pf.bookishType) ? (pf.name||'') : '');
    var btypeReady = !!btype;

    // Stage 1: Type only
    if (!isEdit && !btypeReady) {
      el.innerHTML =
        '<div class="field"><label>Type</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+
          ['Tote','Annotation tabs','Decor','DIY project','Bin','Misc'].map(function(bt){
            return '<button type="button" class="cat-btn'+(btype===bt?' active':'')+'" onclick="pickBookishType(\''+bt+'\')" id="btype-'+bt.replace(/[^a-zA-Z]/g,'')+'">'+bt+'</button>';
          }).join('')+
        '</div></div>';
      return;
    }
    // Stage 2: Description only
    if (!isEdit && !bdescVal) {
      el.innerHTML =
        '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Type: <b>'+escHtml(btype)+'</b></div>'+
        '<div class="field"><label>Description</label><input type="text" id="pm-bookish-desc" placeholder="e.g. teal canvas with gold logo" onblur="advanceBookishDesc()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>'+
        '<input type="hidden" id="pm-bookish-type-hidden" value="'+escHtml(btype)+'">';
      document.getElementById('pm-bookish-desc')?.focus();
      return;
    }
    // Stage 3: everything, all editable together
    nameSection =
      '<div class="field"><label>Type</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+
        ['Tote','Annotation tabs','Decor','DIY project','Bin','Misc'].map(function(bt){
          return '<button type="button" class="cat-btn'+(btype===bt?' active':'')+'" onclick="selectBookishType(\''+bt+'\')" id="btype-'+bt.replace(/[^a-zA-Z]/g,'')+'">'+bt+'</button>';
        }).join('')+
      '</div><input type="hidden" id="pm-bookish-type" value="'+escHtml(btype)+'">'+
      '</div>'+
      '<div class="field"><label>Description</label><input type="text" id="pm-bookish-desc" value="'+escHtml(bdescVal)+'" placeholder="e.g. teal canvas with gold logo"></div>';

  } else {
    // Jewelry, Misc, and any custom item type: single "Prize description"
    // step, then everything else.
    var descOnly = (pf&&pf.name)||'';
    if (!isEdit && !descOnly) {
      el.innerHTML = '<div class="field"><label>Prize description</label><input type="text" id="pm-name" placeholder="What is the prize?" onblur="advancePrizeDescription()" onkeydown="if(event.key===\'Enter\')this.blur()"></div>';
      document.getElementById('pm-name')?.focus();
      return;
    }
    nameSection = '<div class="field"><label>Prize description</label><input type="text" id="pm-name" value="'+escHtml(descOnly)+'" placeholder="What is the prize?"></div>';
  }

  // Default to Uncategorized (not a blank placeholder) so saving is never
  // silently blocked just because a picker didn't visually pop open —
  // desktop browsers don't auto-open a <select> the way iOS does, so this
  // was leaving Category stuck empty on Mac and blocking every save.
  var defaultCat = (pf&&pf.cat) || '';
  var catPills = CATEGORIES.map(function(c){
    return '<button type="button" class="cat-btn'+(defaultCat===c?' active':'')+'" data-cat="'+escHtml(c)+'" onclick="pickCat(\''+c+'\')">'+escHtml(catLabelOf(c))+'</button>';
  }).join('');

  var tagHtml = isEdit ? getTagStatusHtml(pf) : '';

  _prevCat = defaultCat;
  el.innerHTML =
    nameSection+
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">'+
      '<div class="field"><label>Value ($)</label><input type="text" inputmode="decimal" id="pm-value" value="'+((pf&&pf.value)||'')+'" placeholder="0.00"></div>'+
      '<div class="field"><label>Amount paid ($)</label><input type="text" inputmode="decimal" id="pm-paid" value="'+((pf&&pf.paid)||'')+'" placeholder="0.00"></div>'+
      '<div class="field"><label>Qty</label><input type="number" id="pm-qty" value="'+((pf&&pf.qty)||'')+'" placeholder="1" min="1"></div>'+
    '</div>'+
    '<div class="field"><label>Category</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+catPills+'</div>'+
      '<input type="hidden" id="pm-cat" value="'+escHtml(defaultCat)+'">'+
      '<input type="hidden" id="pm-cat-split" value=""><input type="hidden" id="pm-cat-alloc" value="">'+
      '<div id="pm-cat-note" style="font-size:12px;color:var(--text2);margin-top:4px"></div></div>'+
    '<div id="pm-rest"'+((isEdit||defaultCat)?'':' style="display:none"')+'>'+
    '<div class="field"><label>Location</label><input type="text" id="pm-loc" value="'+escHtml((pf&&pf.loc)||'')+'" placeholder="Where is it?"></div>'+
    '<div class="field"><label>Notes</label><textarea id="pm-notes" rows="2" placeholder="Any notes\u2026">'+escHtml((pf&&pf.notes)||'')+'</textarea></div>'+
    '<div class="field"><label>Photos</label>'+
      '<div id="photo-preview" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>'+
      '<div style="display:flex;gap:6px">'+
        '<label class="btn" style="cursor:pointer"><i class="ti ti-camera"></i> Take photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="handlePhotoFile(this)"></label>'+
        '<label class="btn" style="cursor:pointer"><i class="ti ti-photo"></i> Choose<input type="file" accept="image/*" multiple style="display:none" onchange="handlePhotoFile(this)"></label>'+
      '</div>'+
    '</div>'+
    '<div class="field"><label>Donor</label>'+
      '<div style="display:flex;gap:6px;margin-bottom:8px">'+
        '<button class="cat-btn'+((!pf||!pf.donorType||pf.donorType==='none')?' active':'')+'" onclick="setDonorType(\'none\')" id="donor-btn-none">None</button>'+
        '<button class="cat-btn'+((pf&&pf.donorType==='author')?' active':'')+'" onclick="setDonorType(\'author\')" id="donor-btn-author">Author</button>'+
        '<button class="cat-btn'+((pf&&pf.donorType==='business')?' active':'')+'" onclick="setDonorType(\'business\')" id="donor-btn-business">Business</button>'+
      '</div>'+
      '<div id="donor-fields"></div>'+
    '</div>'+
    tagHtml+
    '</div>';

  setDonorType((pf&&pf.donorType)||'none', pf);
  renderPhotoPreview();

  // Add flow only: just finished the last staged field, so start on Value.
  if (!isEdit) { document.getElementById('pm-value')?.focus(); }

  if (pf&&pf.donor) {
    setTimeout(function(){
      var elx=document.getElementById('pm-donor'); if(elx){elx.value=pf.donor;toggleOtherAuthor(pf.donor);}
      var ws=document.getElementById('pm-website'); if(ws&&pf.donorWebsite)ws.value=pf.donorWebsite;
      var qt=document.getElementById('pm-qrtype');  if(qt&&pf.donorQRType) qt.value=pf.donorQRType;
      var pr=document.getElementById('pm-pronoun'); if(pr&&pf.donorPronoun)pr.value=pf.donorPronoun;
      var lg=document.getElementById('pm-logo');    if(lg&&pf.donorLogo)   lg.value=pf.donorLogo;
    },50);
  }
}

function advanceBookAuthor(){
  var v = document.getElementById('pm-author')?.value?.trim()||'';
  if(!v) return; // stay put until they actually enter something
  selectItemType('Book', {author:v});
}
function advanceBookTitle(){
  var authorVal = document.getElementById('pm-author-hidden')?.value||'';
  var v = document.getElementById('pm-book-title')?.value?.trim()||'';
  if(!v) return;
  selectItemType('Book', {author:authorVal, bookTitle:v});
}

// Clothing staging: tapping a type pill advances immediately; "Other"
// reveals an inline text field instead (still on the same step) whose
// blur/Enter is what actually advances.
function pickClothingType(t){
  if (t==='Other') { selectItemType('Clothing', {clothingType:'Other'}); return; }
  selectItemType('Clothing', {clothingType:t});
}
function advanceClothingTypeCustom(){
  var v = document.getElementById('pm-clothing-type-custom')?.value?.trim()||'';
  if (!v) return;
  selectItemType('Clothing', {clothingType:'Other', clothingTypeCustom:v});
}
function pickClothingSize(v){
  var ctype = document.getElementById('pm-clothing-type-hidden')?.value||'';
  var ctypeCustom = document.getElementById('pm-clothing-type-custom-hidden')?.value||'';
  if (v==='Custom') { selectItemType('Clothing', {clothingType:ctype, clothingTypeCustom:ctypeCustom, clothingSize:'Custom'}); return; }
  selectItemType('Clothing', {clothingType:ctype, clothingTypeCustom:ctypeCustom, clothingSize:v});
}
function advanceClothingSizeCustom(){
  var ctype = document.getElementById('pm-clothing-type-hidden')?.value||'';
  var ctypeCustom = document.getElementById('pm-clothing-type-custom-hidden')?.value||'';
  var v = document.getElementById('pm-clothing-size-custom')?.value?.trim()||'';
  if (!v) return;
  selectItemType('Clothing', {clothingType:ctype, clothingTypeCustom:ctypeCustom, clothingSize:'Custom', clothingSizeCustom:v});
}
function advanceClothingDesc(){
  var ctype = document.getElementById('pm-clothing-type-hidden')?.value||'';
  var ctypeCustom = document.getElementById('pm-clothing-type-custom-hidden')?.value||'';
  var csize = document.getElementById('pm-clothing-size-hidden')?.value||'';
  var csizeCustom = document.getElementById('pm-clothing-size-custom-hidden')?.value||'';
  var v = document.getElementById('pm-clothing-desc')?.value?.trim()||'';
  if (!v) return;
  selectItemType('Clothing', {clothingType:ctype, clothingTypeCustom:ctypeCustom, clothingSize:csize, clothingSizeCustom:csizeCustom, clothingDescription:v});
}

// Bookish item staging: tapping any type pill (including "Misc") advances
// immediately straight to Description — no custom-text sub-step.
function pickBookishType(t){
  selectItemType('Bookish item', {bookishType:t});
}
function advanceBookishDesc(){
  var btype = document.getElementById('pm-bookish-type-hidden')?.value||'';
  var v = document.getElementById('pm-bookish-desc')?.value?.trim()||'';
  if (!v) return;
  selectItemType('Bookish item', {bookishType:btype, bookishDescription:v});
}

// Jewelry / Misc / any custom item type: single description field, then rest.
function advancePrizeDescription(){
  var v = document.getElementById('pm-name')?.value?.trim()||'';
  if (!v) return;
  var t = document.getElementById('pm-item-type')?.value||'';
  selectItemType(t, {name:v});
}

function selectClothingType(t) {
  ['T-shirt','Sweatshirt','Hat','Other'].forEach(function(x){
    var btn=document.getElementById('ctype-'+x.replace(/[^a-zA-Z]/g,'')); if(btn)btn.classList.toggle('active',x===t);
  });
  var inp=document.getElementById('pm-clothing-type'); if(inp)inp.value=t;
  var otherField=document.getElementById('clothing-type-other-field'); if(otherField)otherField.style.display=t==='Other'?'block':'none';
}
function selectBookishType(t) {
  ['Tote','Annotation tabs','Decor','DIY project','Bin','Misc'].forEach(function(x){
    var btn=document.getElementById('btype-'+x.replace(/[^a-zA-Z]/g,'')); if(btn)btn.classList.toggle('active',x===t);
  });
  var inp=document.getElementById('pm-bookish-type'); if(inp)inp.value=t;
}
function selectClothingSize(v) {
  ['XS','S','M','L','XL','XXL','XXXL','One size','Custom'].forEach(function(x){
    var btn=document.getElementById('csize-'+x.replace(/[^a-zA-Z]/g,'')); if(btn)btn.classList.toggle('active',x===v);
  });
  var inp=document.getElementById('pm-clothing-size'); if(inp)inp.value=v;
  var otherField=document.getElementById('clothing-size-other-field'); if(otherField)otherField.style.display=v==='Custom'?'block':'none';
}
function addNewItemType() {
  var name=prompt('New item type name:');
  if(!name||!name.trim())return;
  addItemType(name.trim()).then(function(){showToast('Item type added');openAddPrize();});
}

function setDonorType(type, preFill) {
  ['none','author','business'].forEach(function(t){
    var btn=document.getElementById('donor-btn-'+t); if(btn)btn.classList.toggle('active',t===type);
  });
  var el=document.getElementById('donor-fields'); if(!el)return;
  if(type==='none'){el.innerHTML='';el.dataset.donorType='none';return;}
  var isAuthor=type==='author';
  var authors=getAuthors();
  var html='';
  if(isAuthor){
    html+='<div class="field"><label>Author</label>'+
      '<select id="pm-donor" onchange="toggleOtherAuthor(this.value)">'+
      '<option value="">— Select author —</option>'+
      authors.map(function(a){return '<option>'+escHtml(a)+'</option>';}).join('')+
      '<option value="__other__">Other (enter name)</option>'+
      '</select></div>'+
      '<div id="other-author-field" style="display:none" class="field"><label>Author name</label><input type="text" id="pm-other-author" placeholder="Full name"></div>';
  } else {
    html+='<div class="field"><label>Business name</label><input type="text" id="pm-donor" placeholder="Business name"></div>';
  }
  html+=
    '<div class="field"><label>Donor website (for QR code)</label><input type="text" id="pm-website" placeholder="https://\u2026"></div>'+
    '<div class="field"><label>QR type</label><select id="pm-qrtype"><option value="website">Website</option><option value="instagram">Instagram profile</option></select></div>'+
    '<div class="field"><label>Pronoun</label><select id="pm-pronoun"><option value="their">their</option><option value="her">her</option><option value="his">his</option></select></div>'+
    '<div class="field"><label>Logo</label>'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
        '<label class="btn" style="cursor:pointer;font-size:12px"><i class="ti ti-upload"></i> Upload logo<input type="file" accept="image/*" style="display:none" onchange="handleLogoUpload(this)"></label>'+
        '<span style="font-size:11px;color:var(--text3)">or</span>'+
        '<input type="text" id="pm-logo" placeholder="Paste Google Drive link" style="flex:1;min-width:100px">'+
      '</div>'+
      '<div id="pm-logo-preview" style="margin-top:6px"></div>'+
    '</div>';
  el.innerHTML=html;
  el.dataset.donorType=type;
}
function toggleOtherAuthor(val){
  var f=document.getElementById('other-author-field'); if(f)f.style.display=val==='__other__'?'block':'none';
  if (val && val!=='__other__') fillFromAuthorInfo(val);
}
// Soir\u00e9e authors already gave their logo and website in Author Info, so pull them
// in when that author is picked as the donor (only into fields that are still empty).
function driveThumbUrl(u,w){
  var m=String(u||'').match(/drive\.google\.com\/file\/d\/([\w-]+)/)||String(u||'').match(/drive\.google\.com\/(?:open|uc)\?[^#]*id=([\w-]+)/);
  return m ? 'https://drive.google.com/thumbnail?id='+m[1]+'&sz=w'+(w||200) : '';
}
async function fillFromAuthorInfo(name){
  try{
    var res=await fetch(DONOR_LOGO_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'getAuthorData',authorName:name})});
    var j=await res.json();
    if(!j||!j.success||!j.exists) return;
    if(currentDonorName()!==name) return; // they picked someone else while this loaded
    var li=document.getElementById('pm-logo'), lp=document.getElementById('pm-logo-preview'), ws=document.getElementById('pm-website');
    var got=[];
    if(li && !li.value.trim() && j.logoUrl){
      li.value=j.logoUrl;
      var t=driveThumbUrl(j.logoUrl,200);
      if(lp) lp.innerHTML=(t?'<img src="'+t+'" style="height:50px;border-radius:6px;border:.5px solid var(--border)"> ':'')+
        '<span style="font-size:11px;color:var(--text2)">Using the logo from their Author Info</span>';
      got.push('logo');
    }
    var site=(j.data&&j.data.linkWebsite)||'';
    if(ws && !ws.value.trim() && site){ ws.value=site; got.push('website'); }
    if(got.length) showToast('Added '+name+'\u2019s '+got.join(' and ')+' from Author Info');
  }catch(e){ /* no Author Info data available: fine, upload or paste instead */ }
}
// Full-resolution donor logos are saved to Google Drive through the same Apps
// Script as Author Info (needs the "uploadDonorLogo" action in Code.gs).
var DONOR_LOGO_API = "https://script.google.com/macros/s/AKfycbx243aXYN1O8ABOO729RyMlgKV68OzKqVtKUqPetqVPwSKQ_5wCjI71_vyEG6y_K66i/exec";
function fileToBase64(file){
  return new Promise(function(resolve,reject){
    var r=new FileReader();
    r.onload=function(){ resolve(String(r.result).split(',')[1]||''); };
    r.onerror=function(){ reject(r.error); };
    r.readAsDataURL(file);
  });
}
function currentDonorName(){
  var v=document.getElementById('pm-donor')?.value?.trim()||'';
  if (v==='__other__') v=document.getElementById('pm-other-author')?.value?.trim()||'';
  return v;
}
async function handleLogoUpload(input){
  var file=input.files[0]; if(!file)return;
  var donor=currentDonorName();
  if(!donor){ showToast('Enter the donor name first, then upload the logo','error'); input.value=''; return; }
  if(file.size>30*1024*1024){ showToast('That file is over 30 MB \u2014 please use a smaller one','error'); input.value=''; return; }
  showToast('Saving full-size logo to Drive\u2026');
  var li=document.getElementById('pm-logo'), lp=document.getElementById('pm-logo-preview');
  var isRaster=/^image\/(png|jpe?g|webp|gif)$/.test(file.type);
  var thumb=null, small=null;
  if(isRaster){ small=await compressImage(file,800,0.8); thumb=await makeThumbnail(small,200,0.7); }
  try{
    var b64=await fileToBase64(file);
    var res=await fetch(DONOR_LOGO_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'uploadDonorLogo',donor:donor,fileName:file.name,mimeType:file.type,base64:b64})});
    var j=await res.json();
    if(!j.success) throw new Error(j.error||'Upload failed');
    if(li) li.value=j.url;
    if(lp) lp.innerHTML=(thumb?'<img src="'+thumb+'" style="height:50px;border-radius:6px;border:.5px solid var(--border)"> ':'')+
      '<span style="font-size:11px;color:var(--text2)">Saved to Drive: '+escHtml(j.name||'')+'</span>';
    showToast('Full-size logo saved to Drive \u2713');
  }catch(e){
    // Drive unreachable: keep a smaller copy so nothing is lost, but make it obvious.
    if(small){
      if(li) li.value=small;
      if(lp) lp.innerHTML='<img src="'+thumb+'" style="height:50px;border-radius:6px;border:.5px solid var(--border)"> <span style="font-size:11px;color:var(--danger,#c62828)">Only a small copy was kept \u2014 upload again</span>';
    }
    showToast('Could not reach Drive ('+(e.message||'error')+'). Try again.','error');
  }
  input.value='';
}
async function handlePhotoFile(input){
  var files=Array.from(input.files);
  for(var i=0;i<files.length;i++){
    showToast('Processing photo\u2026');
    var full=await compressImage(files[i],1000,0.65);
    var thumb=await makeThumbnail(full,150,0.5);
    _pendingPhotos.push({full:full,thumb:thumb});
  }
  renderPhotoPreview(); showToast('Photo added!'); input.value='';
}
function renderPhotoPreview(){
  var el=document.getElementById('photo-preview'); if(!el)return;
  el.innerHTML=_pendingPhotos.map(function(ph,i){
    return '<div style="position:relative">'+
      '<img src="'+ph.thumb+'" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="viewPendingPhoto('+i+')">'+
      '<button onclick="removePendingPhoto('+i+')" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--red);color:white;border:none;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">\xd7</button>'+
    '</div>';
  }).join('');
}
function viewPendingPhoto(i){
  if(!_pendingPhotos[i])return;
  showModal('<img src="'+_pendingPhotos[i].full+'" style="max-width:100%;max-height:75vh;border-radius:8px;object-fit:contain;display:block;margin:0 auto">'+
    '<div class="m-actions"><button class="btn" onclick="closeModal()">Close</button></div>');
}
function removePendingPhoto(i){_pendingPhotos.splice(i,1);renderPhotoPreview();}

function getTagStatusHtml(p){
  if(!p)return'';
  var checks=[{key:'tagMade',label:'Tag made'},{key:'tagPrinted',label:'Tag printed'},{key:'tagAttached',label:'Tag attached'},{key:'onTote',label:'On tote paper'}];
  return'<div class="field"><label>Donation tag status</label>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">'+
    checks.map(function(c,i){return'<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border-radius:var(--radius-sm);border:.5px solid var(--border);cursor:pointer;font-size:13px">'+
      '<input type="checkbox" id="pm-'+c.key+'" '+(p[c.key]?'checked':'')+' style="accent-color:var(--purple);width:16px;height:16px;flex-shrink:0">'+
      '<span><span style="font-size:10px;color:var(--text3);display:block">Step '+(i+1)+'</span>'+c.label+'</span></label>';}).join('')+
    '</div></div>';
}

function parseMoney(val){
  var s=String(val||'').trim().replace(/[^0-9.]/g,'');
  if(!s)return 0;
  return s.includes('.')?Math.round(parseFloat(s)*100)/100:parseInt(s,10);
}
function getDonorFields(){
  var el=document.getElementById('donor-fields');
  if(!el||!el.dataset.donorType||el.dataset.donorType==='none')return{donorType:'none',donor:'',donorWebsite:'',donorQRType:'website',donorPronoun:'their',donorLogo:''};
  var type=el.dataset.donorType;
  var donor=document.getElementById('pm-donor')?.value||'';
  if(donor==='__other__')donor=document.getElementById('pm-other-author')?.value?.trim()||'';
  return{donorType:type,donor:donor,
    donorWebsite:document.getElementById('pm-website')?.value?.trim()||'',
    donorQRType:document.getElementById('pm-qrtype')?.value||'website',
    donorPronoun:document.getElementById('pm-pronoun')?.value||'their',
    donorLogo:document.getElementById('pm-logo')?.value?.trim()||'',
    needTag:!!donor.trim()};
}

// Builds the prize name (and any type-specific fields to persist) from
// whichever set of fields is showing, based on the selected Item Type.
// donationTagType drives which physical tag template gets used later.
function computePrizeNameAndTypeFields(){
  var itemType = document.getElementById('pm-item-type')?.value||'';
  if (itemType==='Book') {
    var author=document.getElementById('pm-author')?.value?.trim()||'';
    var title=document.getElementById('pm-book-title')?.value?.trim()||'';
    var name = (author&&title) ? (author+': '+title) : (author||title);
    return {ok:!!(author&&title), name:name, extra:{author:author,bookTitle:title}, donationTagType:'book'};
  }
  if (itemType==='Clothing') {
    var ctypeRaw=document.getElementById('pm-clothing-type')?.value||'';
    var ctypeCustom=document.getElementById('pm-clothing-type-custom')?.value?.trim()||'';
    var ctypeResolved = ctypeRaw==='Other' ? (ctypeCustom||'Other') : ctypeRaw;
    var desc=document.getElementById('pm-clothing-desc')?.value?.trim()||'';
    var sizeRaw=document.getElementById('pm-clothing-size')?.value||'';
    var sizeCustom=document.getElementById('pm-clothing-size-custom')?.value?.trim()||'';
    var sizeResolved = sizeRaw==='Custom' ? (sizeCustom||'') : sizeRaw;
    var name = (ctypeResolved&&desc) ? (ctypeResolved+': '+desc+(sizeResolved?', '+sizeResolved:'')) : '';
    return {ok:!!(ctypeRaw&&desc&&sizeRaw), name:name, extra:{
      clothingType:ctypeRaw, clothingTypeCustom:ctypeCustom,
      clothingDescription:desc,
      clothingSize:sizeRaw, clothingSizeCustom:sizeCustom
    }, donationTagType:'clothing'};
  }
  if (itemType==='Bookish item') {
    var btypeRaw=document.getElementById('pm-bookish-type')?.value||'';
    var bdesc=document.getElementById('pm-bookish-desc')?.value?.trim()||'';
    var bname = (btypeRaw&&bdesc) ? (btypeRaw+': '+bdesc) : '';
    return {ok:!!(btypeRaw&&bdesc), name:bname, extra:{
      bookishType:btypeRaw,
      bookishDescription:bdesc
    }, donationTagType:'other'};
  }
  var name=document.getElementById('pm-name')?.value?.trim()||'';
  return {ok:!!name, name:name, extra:{}, donationTagType:'other'};
}

function prizeValidationMessage(itemType){
  if(itemType==='Book') return 'Please enter both author and title';
  if(itemType==='Clothing') return 'Please fill in clothing type, description, and size';
  if(itemType==='Bookish item') return 'Please fill in the type and description';
  return 'Please enter a prize name';
}

async function doAddPrize(){
  var itemType=document.getElementById('pm-item-type')?.value;
  if(!itemType){showToast('Please select an item type','error');return;}
  var gen=computePrizeNameAndTypeFields();
  if(!gen.ok){showToast(prizeValidationMessage(itemType),'error');return;}
  var cat=document.getElementById('pm-cat')?.value;
  if(!cat){showToast('Please select a category','error');return;}
  var qty=parseInt(document.getElementById('pm-qty')?.value)||1;
  var alloc=null;
  try{ alloc=JSON.parse(document.getElementById('pm-cat-alloc')?.value||'null'); }catch(e){}
  if(alloc && qty===1) alloc=null;
  if(alloc){
    var sum=0; for(var ck in alloc) sum+=alloc[ck];
    if(sum!==qty){
      document.getElementById('pm-cat-alloc').value=''; document.getElementById('pm-cat-note').textContent='';
      showToast('Quantity changed \u2014 pick the category again','error'); return;
    }
  }
  showToast('Saving\u2026');
  var donor=getDonorFields();
  var base={name:gen.name,
    itemType:itemType,
    donationTagType:gen.donationTagType,
    value:parseMoney(document.getElementById('pm-value')?.value),
    paid:parseMoney(document.getElementById('pm-paid')?.value),
    loc:document.getElementById('pm-loc')?.value?.trim()||'',
    notes:document.getElementById('pm-notes')?.value?.trim()||'',
    photos:[..._pendingPhotos],...gen.extra,...donor};
  if(alloc){
    for(var c in alloc){ await addPrize({...base,cat:c,qty:alloc[c]}); }
  } else {
    await addPrize({...base,cat:cat,qty:qty});
  }
  _pendingPhotos=[]; _editMode=false; _currentPrizeId=0;
  closeModal(); renderPrizes(); renderGoals();
}

async function doEditPrize(id){
  var itemType=document.getElementById('pm-item-type')?.value;
  if(!itemType){showToast('Please select an item type','error');return;}
  var gen=computePrizeNameAndTypeFields();
  if(!gen.ok){showToast(prizeValidationMessage(itemType),'error');return;}
  var donor=getDonorFields();
  var tagFields={
    tagMade:document.getElementById('pm-tagMade')?.checked||false,
    tagPrinted:document.getElementById('pm-tagPrinted')?.checked||false,
    tagAttached:document.getElementById('pm-tagAttached')?.checked||false,
    onTote:document.getElementById('pm-onTote')?.checked||false,
  };
  var newCat=document.getElementById('pm-cat')?.value||'';
  var qty=parseInt(document.getElementById('pm-qty')?.value)||1;
  var moveK=parseInt(document.getElementById('pm-cat-split')?.value)||0;
  var orig=getPrize(id);
  var fields={name:gen.name,
    itemType:itemType,
    donationTagType:gen.donationTagType,
    value:parseMoney(document.getElementById('pm-value')?.value),
    paid:parseMoney(document.getElementById('pm-paid')?.value),
    loc:document.getElementById('pm-loc')?.value?.trim()||'',
    notes:document.getElementById('pm-notes')?.value?.trim()||'',
    photos:[..._pendingPhotos],...gen.extra,...donor,...tagFields};
  if(moveK>0 && moveK<qty && orig && orig.cat!==newCat){
    // Only part of the stack changes category: the new category gets its own record.
    await addPrize({...fields,cat:newCat,qty:moveK});
    await updatePrize(id,{...fields,cat:orig.cat,qty:qty-moveK});
  } else {
    await updatePrize(id,{...fields,cat:newCat,qty:qty});
  }
  _pendingPhotos=[]; _editMode=false; _currentPrizeId=0;
  closeModal(); showToast('Prize saved!'); renderPrizes(); renderGoals();
}

function confirmDeletePrize(id){
  var p=getPrize(id);
  if(!p)return;
  if(confirm('Delete "'+escHtml(p.name||'this prize')+'"? This cannot be undone.')){
    deletePrize(id).then(function(){closeModal();showToast('Prize deleted');renderPrizes();renderGoals();});
  }
}
