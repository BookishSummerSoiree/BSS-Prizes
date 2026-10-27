// fbauth.js — signs the team into Firebase and attaches the sign-in token to every
// database request, so the database can be locked to signed-in people only.
// One shared sign-in works for HQ, the Prize Manager and anything else on this site
// (they share this browser's storage). Nothing secret lives in this file.
(function(){
  var API_KEY = '__FIREBASE_WEB_API_KEY__';          // public identifier, safe in code
  var DB_RE   = /^https:\/\/[a-z0-9-]+-default-rtdb\.firebaseio\.com\//;
  var STORE   = 'bss_fb_auth';
  var SNOOZE  = 'bss_fb_auth_snooze';
  if (!API_KEY || API_KEY.indexOf('__') === 0) return;   // not configured yet: do nothing
  var origFetch = window.fetch.bind(window);

  function load(){ try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch(e){ return null; } }
  function save(a){ try { localStorage.setItem(STORE, JSON.stringify(a)); } catch(e){} }
  function clear(){ try { localStorage.removeItem(STORE); } catch(e){} }

  var auth = load();   // {email, refreshToken, idToken, exp}
  var refreshing = null;

  async function refresh(){
    if (!auth || !auth.refreshToken) return null;
    if (refreshing) return refreshing;
    refreshing = (async function(){
      try {
        var r = await origFetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
          method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken)
        });
        var j = await r.json();
        if (!r.ok || !j.id_token) { if (r.status === 400) { auth = null; clear(); } return null; }
        auth.idToken = j.id_token; auth.refreshToken = j.refresh_token || auth.refreshToken;
        auth.exp = Date.now() + (parseInt(j.expires_in,10) || 3600) * 1000;
        save(auth); return auth.idToken;
      } catch(e) { return null; } finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function token(){
    if (!auth) return null;
    if (auth.idToken && auth.exp && auth.exp - Date.now() > 120000) return auth.idToken;
    return refresh();
  }

  var waiters = [];
  function openSignIn(mandatory){
    return new Promise(function(resolve){
      waiters.push(resolve);
      if (document.getElementById('bss-signin')) return;
      var d = document.createElement('div'); d.id = 'bss-signin';
      d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(20,24,50,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif';
      d.innerHTML = '<form style="background:#fff;border-radius:14px;padding:22px;max-width:340px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
        '<div style="font-size:17px;font-weight:600;margin-bottom:4px;color:#222">Team sign-in</div>' +
        '<div style="font-size:13px;color:#555;margin-bottom:14px">Sign in once on this device to open the Soirée apps.</div>' +
        '<input id="bss-em" type="email" autocomplete="username" placeholder="Email" style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccc;border-radius:8px;font-size:16px;margin-bottom:8px">' +
        '<input id="bss-pw" type="password" autocomplete="current-password" placeholder="Password" style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccc;border-radius:8px;font-size:16px;margin-bottom:8px">' +
        '<div id="bss-err" style="color:#b00020;font-size:12.5px;min-height:16px;margin-bottom:8px"></div>' +
        '<button type="submit" style="width:100%;padding:12px;border:0;border-radius:8px;background:#3b3a8c;color:#fff;font-size:15px;font-weight:600">Sign in</button>' +
        (mandatory ? '' : '<button type="button" id="bss-skip" style="width:100%;margin-top:8px;padding:10px;border:0;background:transparent;color:#666;font-size:13px">Not now</button>') +
        '</form>';
      document.body.appendChild(d);
      var form = d.querySelector('form'), err = d.querySelector('#bss-err');
      form.onsubmit = async function(e){
        e.preventDefault(); err.textContent = '';
        try {
          var r = await origFetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email:d.querySelector('#bss-em').value.trim(), password:d.querySelector('#bss-pw').value, returnSecureToken:true})
          });
          var j = await r.json();
          if (!r.ok) { err.textContent = 'That email or password didn’t work.'; return; }
          auth = {email:j.email, refreshToken:j.refreshToken, idToken:j.idToken, exp:Date.now() + (parseInt(j.expiresIn,10)||3600)*1000};
          save(auth); d.remove(); var w = waiters; waiters = []; w.forEach(function(f){ f(true); });
        } catch(ex) { err.textContent = 'Couldn’t reach the sign-in service. Check your connection.'; }
      };
      var skip = d.querySelector('#bss-skip');
      if (skip) skip.onclick = function(){ try { localStorage.setItem(SNOOZE, String(Date.now() + 24*3600*1000)); } catch(e){} d.remove(); var w = waiters; waiters = []; w.forEach(function(f){ f(false); }); };
    });
  }
  function snoozed(){ try { return Date.now() < (+localStorage.getItem(SNOOZE) || 0); } catch(e){ return false; } }

  function withAuth(url, tok){ return url + (url.indexOf('?') > -1 ? '&' : '?') + 'auth=' + encodeURIComponent(tok); }

  window.fetch = async function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!DB_RE.test(url) || typeof input !== 'string') return origFetch(input, init);
    var tok = await token();
    var res = await origFetch(tok ? withAuth(url, tok) : url, init);
    if (res.status === 401 || res.status === 403) {
      // The database wants a sign-in. Get one (or a fresh token), then try once more.
      var t2 = tok ? await refresh() : null;
      if (!t2) { await openSignIn(true); t2 = await token(); }
      if (t2) res = await origFetch(withAuth(url, t2), init);
    }
    return res;
  };

  // Gentle first-time prompt (skippable) while the database is still open, so signing in can be
  // checked ahead of the switch.
  window.addEventListener('DOMContentLoaded', function(){
    if (!auth && !snoozed() && window === window.top) openSignIn(false);   // not inside the HQ frame
  });
  // If another tab or the HQ frame signs in, pick that up here too.
  window.addEventListener('storage', function(e){
    if (e.key === STORE) { auth = load(); var o = document.getElementById('bss-signin'); if (auth && o) { o.remove(); var w = waiters; waiters = []; w.forEach(function(f){ f(true); }); } }
  });
})();
