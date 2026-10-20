/* Visit log for this site. What it sends, when, and for how long it is kept: visits.html.
   No cookies. Nothing is stored in your browser, except the opt-out setting if you turn it on.
   Messages go to the log service named below as plain text: when a page opens, every 15 seconds while
   you are using it, on a tracked click (links and downloads), and when the page is hidden or closed. */
(function () {
  "use strict";
  var EP = "https://site-visits.kevin-mustafa.workers.dev";
  var HEARTBEAT = 15000, IDLE = 30000, GATE = 3000, SEEN = 1000;
  var FILES = /\.(csv|drawio|py|md|json|zip|pdf|txt|xlsx?|docx?)$/i;

  function off() { try { return localStorage.getItem("nocount") === "1"; } catch (e) { return false; } }
  var ready = EP.indexOf("http") === 0 && !!window.fetch;

  // The opt-out switch on visits.html. It works even while counting is off, so it can be turned back on.
  var sw = document.getElementById("nocount");
  if (sw) {
    var note = document.getElementById("nocount-note");
    var say = function () { if (note) note.textContent = sw.checked ? "This browser is not counted." : "This browser is counted. Turn the switch on to stop."; };
    sw.disabled = false;
    sw.checked = off();
    say();
    sw.addEventListener("change", function () {
      try {
        if (sw.checked) {
          if (ready && !off()) post({ t: "optout" });   // a bare count of opt-outs, nothing else
          localStorage.setItem("nocount", "1");
        } else localStorage.removeItem("nocount");
      } catch (e) { sw.checked = false; }
      say();
    });
  }
  if (!ready || off()) return;

  function post(obj) {
    return fetch(EP + "/h", { method: "POST", keepalive: true, credentials: "omit", mode: "cors",
      headers: { "Content-Type": "text/plain" }, body: JSON.stringify(obj) });
  }
  function send(obj, wantReply) {
    if (off()) return Promise.resolve(null);
    try {
      return post(obj).then(function (r) { return wantReply && r.ok ? r.json() : null; }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function code(search) { var m = /[?&]r=([A-Za-z0-9_-]{1,32})(?:&|$)/.exec(search || ""); return m ? m[1] : null; }
  function words(t) { return (t.match(/\S+/g) || []).length; }
  function band(w) { return w < 480 ? "under 480" : w < 1024 ? "480 to 1023" : w < 1440 ? "1024 to 1439" : "1440 and over"; }
  function now() { return performance.now(); }

  // Sections: each <section>, or on document pages each h2 with the elements after it.
  var units = [];
  function addUnit(id, els, heading) {
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
    var text = els.map(function (e) { return e.textContent || ""; }).join(" ");
    units.push({ id: id, els: els, heading: (heading || "").trim().replace(/\s+/g, " ").slice(0, 80), w: words(text), vis: [], tot: [], ms: 0, run: 0, seen: false, fresh: false });
  }
  Array.prototype.forEach.call(document.querySelectorAll("section"), function (s) {
    var id = s.id || s.getAttribute("aria-labelledby");
    var h = (s.getAttribute("aria-labelledby") && document.getElementById(s.getAttribute("aria-labelledby"))) || s.querySelector("h2, h3");
    addUnit(id, [s], h ? h.textContent : id);
  });
  if (!units.length) {
    Array.prototype.forEach.call(document.querySelectorAll("main h2[id]"), function (h) {
      var els = [h], n = h.nextElementSibling;
      while (n && n.tagName !== "H2") { els.push(n); n = n.nextElementSibling; }
      addUnit(h.id, els, h.textContent);
    });
  }
  var vh = window.innerHeight;
  if (window.IntersectionObserver) {
    var steps = []; for (var i = 0; i <= 20; i++) steps.push(i / 20);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.rootBounds) vh = en.rootBounds.height;
        units.forEach(function (u) {
          var k = u.els.indexOf(en.target);
          if (k >= 0) { u.vis[k] = en.isIntersecting ? en.intersectionRect.height : 0; u.tot[k] = en.boundingClientRect.height; }
        });
      });
    }, { threshold: steps });
    units.forEach(function (u) { u.els.forEach(function (e) { io.observe(e); }); });
  }

  var gpc = navigator.globalPrivacyControl === true;
  var home = document.getElementById("vcount");
  var s;   // this page load

  function start() {
    var ref = document.referrer, rh = "", same = false;
    try { if (ref) { var u = new URL(ref); rh = u.hostname; same = u.origin === location.origin; } } catch (e) {}
    s = { id: uuid(), t0: now(), last: now(), tick: now(), lastInput: now(), a: 0, v: 0, sd: 0, q: 0, clicks: [],
      inp: { first: null, s: 0, p: 0, k: 0, t: 0 }, tier: null, sentA: 0, vs: !same, pcSent: false, beatA: -1 };
    units.forEach(function (u) { u.ms = 0; u.run = 0; u.seen = false; u.fresh = false; u.sent = 0; });
    // The log service decides what to keep (visits.html); a privacy signal is passed on with the rest.
    var body = { t: "view", id: s.id, p: location.pathname, r: code(location.search), rr: same ? code(new URL(ref).search) : null,
      rh: rh || null, c: home ? 1 : 0, wd: navigator.webdriver === true, gpc: gpc,
      tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null,
      lang: (navigator.languages && navigator.languages[0]) || navigator.language || null,
      sb: band(screen.width), cs: window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      th: theme(), tch: navigator.maxTouchPoints > 1, sw: {} };
    units.forEach(function (u) { body.sw[u.id] = { w: u.w, h: u.heading }; });
    var mine = s;
    send(body, true).then(function (r) {
      if (mine !== s) return;
      mine.tier = r && r.tier ? r.tier : "none";
      if (home && r && typeof r.n === "number" && /^\d{4}-\d{2}-\d{2}$/.test(r.since || "")) {
        var p = r.since.split("-"), mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p[1]) - 1];
        home.textContent = r.n.toLocaleString("en-AU") + (r.n === 1 ? " visit" : " visits") + " since " + Number(p[2]) + " " + mon + " " + p[0];
        home.hidden = false;
      }
    });
  }
  function theme() { return document.documentElement.getAttribute("data-theme") || "auto"; }

  // Time counts while the page is on screen; active time also needs a scroll, pointer move, tap or key in the last 30 s.
  function tick() {
    var t = now(), dt = t - s.tick; s.tick = t;
    if (dt > 2000) dt = 0;                       // timers were paused (hidden tab or sleep)
    var visible = document.visibilityState === "visible", active = visible && t - s.lastInput < IDLE;
    if (visible) s.v += dt;
    if (active) s.a += dt;
    units.forEach(function (u) {
      var vis = 0, tot = 0;
      for (var k = 0; k < u.els.length; k++) { vis += u.vis[k] || 0; tot += u.tot[k] || 0; }
      if (active && tot > 0 && vis >= 0.5 * Math.min(tot, vh)) {
        u.run += dt;
        if (u.run >= SEEN) { u.ms += u.run - dt < SEEN ? u.run : dt; if (!u.seen) { u.seen = true; u.fresh = true; } }   // a stretch counts once it lasts 1 s
      } else u.run = 0;
    });
  }
  setInterval(function () { if (s) tick(); }, 500);

  function onInput(kind) {
    return function (e) {
      if (!s) return;
      var t = now(); s.lastInput = t;
      if (e.isTrusted && t - s.t0 >= GATE) { s.inp[kind]++; if (s.inp.first === null) s.inp.first = Math.round(t - s.t0); }
    };
  }
  addEventListener("scroll", function (e) {
    if (!s) return;
    onInput("s")(e);
    var d = document.documentElement, h = Math.max(d.scrollHeight, 1);
    s.sd = Math.max(s.sd, Math.min(100, Math.round((scrollY + innerHeight) / h * 100)));
  }, { passive: true, capture: true });
  addEventListener("wheel", onInput("s"), { passive: true, capture: true });
  addEventListener("pointermove", function (e) { onInput(e.pointerType === "touch" ? "t" : "p")(e); }, { passive: true, capture: true });
  addEventListener("pointerdown", function (e) { onInput(e.pointerType === "touch" ? "t" : "p")(e); }, { passive: true, capture: true });
  addEventListener("touchstart", onInput("t"), { passive: true, capture: true });
  addEventListener("keydown", onInput("k"), { capture: true });

  // Clicks: where a link goes (outside sites by name only), downloads, buttons, tabs, turns of the 3D view.
  function rec(kind, target) {
    var t = Math.round(now() - s.t0), last = s.clicks[s.clicks.length - 1];
    if (kind === "canvas" && last && last.kind === "canvas" && last.target === target && t - last.t < 3000) { last.n = (last.n || 1) + 1; last.t = t; return; }
    if (s.clicks.length < 200) s.clicks.push({ t: t, kind: kind, target: String(target || "").slice(0, 120) });
  }
  document.addEventListener("click", function (e) {
    if (!s) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (a) {
      var u; try { u = new URL(a.getAttribute("href"), location.href); } catch (x) { return; }
      if (u.protocol === "mailto:") rec("mail", "email link");
      else if (u.origin !== location.origin) rec("out", u.hostname);
      else if (FILES.test(u.pathname) || a.hasAttribute("download")) rec("download", u.pathname);
      else rec("link", u.pathname + (u.hash || ""));
      flush("click");
      return;
    }
    var b = e.target.closest && e.target.closest("button, [role=tab], summary, [data-track]");
    if (b) rec(b.getAttribute("role") === "tab" ? "tab" : "button", b.getAttribute("data-track") || b.getAttribute("aria-label") || (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60));
  }, true);
  document.addEventListener("pointerdown", function (e) {
    if (!s || !e.target || e.target.tagName !== "CANVAS") return;
    var host = e.target.closest("section");
    rec("canvas", e.target.id || (host && (host.id || host.getAttribute("aria-labelledby"))) || "3d view");
  }, true);
  document.addEventListener("copy", function () {
    if (!s) return;
    var sel = window.getSelection ? getSelection() : null, n = sel ? String(sel).length : 0, where = "page";
    var node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    units.forEach(function (u) { u.els.forEach(function (el) { if (node && el.contains(node)) where = u.id; }); });
    rec("copy", where + ": " + n + " characters");   // never the copied text
  });

  function flush(kind) {
    if (!s || !s.tier || s.tier === "none" || s.tier === "excluded" || off()) return;
    tick();
    if (s.tier === "totals") {
      var da = Math.round(s.a - s.sentA), dsec = {}, sv = [], any = false;
      units.forEach(function (u) { var d = Math.round(u.ms - u.sent); if (d > 0) { dsec[u.id] = d; any = true; } if (u.fresh) { sv.push(u.id); u.fresh = false; any = true; } u.sent = u.ms; });
      var pc = !s.pcSent && s.vs && s.inp.first !== null;
      if (da <= 0 && !any && !pc) return;
      s.sentA = s.a; if (pc) s.pcSent = true;
      send({ t: kind, tier: "totals", p: location.pathname, da: Math.max(da, 0), dsec: dsec, sv: sv, inp: { first: s.inp.first }, vs: s.vs, pc: pc });
      return;
    }
    var sec = {}, total = 0;
    units.forEach(function (u) { if (u.ms > 0) { sec[u.id] = Math.round(u.ms); total += sec[u.id]; } });
    var sig = [Math.round(s.a / 1000), s.sd, s.clicks.length, Math.round(total / 1000), s.inp.first].join(",");
    if (kind === "end" && sig === s.sig) return;     // hidden and pagehide often come together: send once
    s.sig = sig;
    s.q++;
    send({ t: kind, id: s.id, q: s.q, a: Math.round(s.a), v: Math.round(s.v), sd: s.sd, sec: sec, ck: s.clicks, inp: s.inp, th: theme() });
  }
  setInterval(function () {
    if (!s || document.visibilityState !== "visible" || now() - s.lastInput >= IDLE || now() - s.t0 > 6 * 3600 * 1000) return;
    flush("beat");
  }, HEARTBEAT);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush("end"); else if (s) s.tick = now(); });
  addEventListener("pagehide", function () { flush("end"); });
  addEventListener("pageshow", function (e) { if (e.persisted) start(); });   // back from the browser's page cache: a new view
  start();
})();
