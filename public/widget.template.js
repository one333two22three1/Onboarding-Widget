/* GHL Onboarding Widget (served by the backend at /widget.js). Edit widget.config.json, not this file. */
(function () {
    if (window.__ghlOnboarding) return;
    window.__ghlOnboarding = true;

    var CONFIG = __WIDGET_CONFIG__;

    var STEPS = CONFIG.STEPS;
    var state = { loc: '', done: {}, linked: null };

    function getLoc() {
        var m = location.pathname.match(/\/location\/([^/]+)/);
        return m ? m[1] : '';
    }
    function key() { return 'ghl_ob_' + state.loc; }
    function loadLocal() {
        try { return JSON.parse(localStorage.getItem(key()) || '{}'); } catch (e) { return {}; }
    }
    function saveLocal() {
        try { localStorage.setItem(key(), JSON.stringify(state.done)); } catch (e) { }
    }

    /* ---------- DOM (Shadow DOM so GHL CSS can't interfere) ---------- */
    var host = document.createElement('div');
    host.id = 'ghl-onboarding-host';
    host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483000;';
    var root = host.attachShadow({ mode: 'open' });

    root.innerHTML =
        '<style>' +
        '*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
        '.ribbon{position:fixed;right:0;top:120px;background:#4B006E;color:#fff;border:0;cursor:pointer;' +
        'display:flex;align-items:center;padding:12px 12px 12px 24px;font-size:13px;font-weight:600;' +
        'clip-path:polygon(0 0,100% 0,100% 100%,0 100%,14px 50%);transition:background .2s}' +
        '.ribbon:hover,.ribbon.open{background:#3a0055}' +
        '.ribbon .ico{display:flex;width:18px;overflow:hidden;opacity:1;transition:width .25s ease,opacity .15s ease}' +
        '.ribbon .ico svg{flex:none;width:18px;height:18px}' +
        '.ribbon .lbl{display:flex;align-items:center;white-space:nowrap;max-width:0;overflow:hidden;opacity:0;' +
        'transition:max-width .3s ease,opacity .2s ease}' +
        '.ribbon:hover .ico,.ribbon.open .ico,.ribbon:focus-visible .ico{width:0;opacity:0}' +
        '.ribbon:hover .lbl,.ribbon.open .lbl,.ribbon:focus-visible .lbl{max-width:200px;opacity:1}' +
        '.ribbon .cnt{margin-left:8px;background:rgba(255,255,255,.22);border-radius:10px;padding:2px 8px;font-size:11px}' +
        '.panel{position:fixed;right:12px;top:172px;width:340px;max-height:calc(100vh - 200px);display:flex;flex-direction:column;overflow:hidden;' +
        'background:#fff;color:#111827;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.28);' +
        'transform-origin:top right;transform:scaleY(0);opacity:0;pointer-events:none;' +
        'transition:transform .22s ease,opacity .22s ease}' +
        '.panel.open{transform:scaleY(1);opacity:1;pointer-events:auto}' +
        '#list{flex:1 1 auto;min-height:0;overflow-y:auto}' +
        '.hd{flex:none;padding:14px 16px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:15px;' +
        'display:flex;justify-content:space-between;align-items:center}' +
        '.x{background:none;border:0;font-size:18px;cursor:pointer;color:#6b7280}' +
        '.row{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid #f3f4f6}' +
        '.row.done .nm{color:#9ca3af;text-decoration:line-through}' +
        '.play{flex:none;width:30px;height:30px;border-radius:50%;border:0;background:#eef2ff;color:#4f46e5;' +
        'cursor:pointer;font-size:12px}' +
        '.play:hover{background:#e0e7ff}' +
        '.nm{flex:1;text-align:left;background:none;border:0;cursor:pointer;font-size:13.5px;color:#111827;padding:0}' +
        '.nm:hover{color:#4f46e5;text-decoration:underline}' +
        '.row input{flex:none;width:18px;height:18px;accent-color:#16a34a;cursor:pointer}' +
        '.row input:disabled{cursor:default}' +
        '.ft{flex:none;padding:14px 16px;border-top:1px solid #e5e7eb}' +
        '.bar{height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden}' +
        '.bar i{display:block;height:100%;background:#16a34a;width:0;transition:width .3s}' +
        '.sum{margin-top:8px;font-size:13px;font-weight:600}' +
        '.err{color:#dc2626;font-size:12px;margin-top:6px;min-height:14px}' +
        '.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center}' +
        '.modal.open{display:flex}' +
        '.vbox{position:relative;width:min(860px,92vw)}' +
        '.vbox video{width:100%;max-height:80vh;border-radius:10px;background:#000}' +
        '.vclose{position:absolute;top:-34px;right:0;background:none;border:0;color:#fff;font-size:26px;cursor:pointer}' +
        '</style>' +
        '<button class="ribbon" id="ribbon"></button>' +
        '<div class="panel" id="panel">' +
        '  <div class="hd"><span id="title"></span><button class="x" id="close" aria-label="Close">&times;</button></div>' +
        '  <div id="list"></div>' +
        '  <div class="ft"><div class="bar"><i id="fill"></i></div>' +
        '  <div class="sum" id="sum"></div><div class="err" id="err"></div></div>' +
        '</div>' +
        '<div class="modal" id="modal"><div class="vbox">' +
        '  <button class="vclose" id="vclose" aria-label="Close video">&times;</button>' +
        '  <video id="player" controls playsinline></video></div></div>';

    var GEAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';
    var $ = function (id) { return root.getElementById(id); };
    var ribbon = $('ribbon'), panel = $('panel'), list = $('list'),
        modal = $('modal'), player = $('player'), err = $('err');

    $('title').textContent = CONFIG.TITLE;

    /* ---------- Behaviour ---------- */
    function setOpen(v) {
        panel.classList.toggle('open', v);
        ribbon.classList.toggle('open', v);
    }

    function navigate(path) {
        var url = '/v2/location/' + state.loc + path;
        try {
            // GHL is a single-page app: route without a full reload
            history.pushState({}, '', url);
            window.dispatchEvent(new PopStateEvent('popstate'));
            setTimeout(function () {            // fallback if router ignored it
                if (location.pathname + location.search !== url) location.href = url;
            }, 400);
        } catch (e) { location.href = url; }
        setOpen(false);
    }

    function openVideo(src) {
        player.src = src;
        modal.classList.add('open');
        player.play().catch(function () { });
    }
    function closeVideo() {
        player.pause();
        player.removeAttribute('src');
        player.load();
        modal.classList.remove('open');
    }

    function api(method, path, body) {
        return fetch(CONFIG.API_BASE + path, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    function complete(step, box) {
        err.textContent = '';
        state.done[step.id] = true;           // optimistic
        saveLocal(); render();
        api('POST', '/onboarding/complete', {
            locationId: state.loc,
            stepId: step.id
        }).catch(function () {
            delete state.done[step.id];         // roll back if stage update failed
            saveLocal(); render();
            err.textContent = 'Could not update pipeline stage. Please try again.';
        });
    }

    function render() {
        list.innerHTML = '';
        var count = 0;
        STEPS.forEach(function (s) {
            var isDone = !!state.done[s.id];
            if (isDone) count++;

            var row = document.createElement('div');
            row.className = 'row' + (isDone ? ' done' : '');

            var play = document.createElement('button');
            play.className = 'play'; play.title = 'Watch video'; play.textContent = '\u25B6';
            play.onclick = function () { openVideo(s.video); };

            var nm = document.createElement('button');
            nm.className = 'nm'; nm.textContent = s.name; nm.title = 'Go to this feature';
            nm.onclick = function () { navigate(s.path); };

            var cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = isDone; cb.disabled = isDone; // locked once completed
            cb.title = isDone ? 'Completed' : 'Mark as complete';
            cb.onchange = function () { if (cb.checked) complete(s, cb); };

            row.appendChild(play); row.appendChild(nm); row.appendChild(cb);
            list.appendChild(row);
        });

        var pct = STEPS.length ? Math.round((count / STEPS.length) * 100) : 0;
        $('fill').style.width = pct + '%';
        $('sum').textContent = count === STEPS.length
            ? '\uD83C\uDF89 Onboarding complete (100%)'
            : 'Overall: ' + count + ' of ' + STEPS.length + ' completed (' + pct + '%)';
        ribbon.innerHTML = '<span class="ico">' + GEAR + '</span><span class="lbl">' + CONFIG.TITLE +
            '<span class="cnt">' + count + '/' + STEPS.length + '</span></span>';
    }

    function syncFromServer() {
        api('GET', '/onboarding/status?locationId=' + encodeURIComponent(state.loc))
            .then(function (res) {
                state.linked = res.linked;
                if (state.linked === false) host.style.display = 'none';   // not an onboarding customer
                state.done = {};                      // server is the source of truth
                (res.completed || []).forEach(function (id) { state.done[id] = true; });
                saveLocal(); render();
            }).catch(function () { /* offline backend: keep local state */ });
    }

    function isAllowed(loc) {
        var only = CONFIG.ONLY_LOCATIONS;
        return !only || !only.length || only.indexOf(loc) >= 0;
    }

    function onLocationChange() {
        var loc = getLoc();
        if (!loc || !isAllowed(loc)) { host.style.display = 'none'; return; }   // testing allowlist
        host.style.display = state.linked !== false ? '' : 'none';
        if (loc !== state.loc) {
            state.loc = loc;
            state.linked = null;
            state.done = loadLocal();
            render();
            syncFromServer();
        }
    }

    ribbon.setAttribute('aria-label', 'Onboarding checklist');
    ribbon.onclick = function () { setOpen(!panel.classList.contains('open')); };
    $('close').onclick = function () { setOpen(false); };
    $('vclose').onclick = closeVideo;
    modal.onclick = function (e) { if (e.target === modal) closeVideo(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeVideo(); });

    function mount() {
        document.body.appendChild(host);
        onLocationChange();
        setInterval(function () {
            if (!document.body.contains(host)) document.body.appendChild(host);
            onLocationChange();
        }, 1500);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();