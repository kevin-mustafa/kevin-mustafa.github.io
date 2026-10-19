// The lab in 3D. Plain ES module, no build step. three.js release r170, saved in assets/vendor/three-r170/.
import * as THREE from './vendor/three-r170/three.module.min.js';

const d = document, root = d.documentElement;
const $ = (id) => d.getElementById(id);
const stageEl = $('lab-stage'), canvas = $('lab-canvas'), labelsEl = $('lab-labels'), tipEl = $('lab-tip');
const keysEl = $('lab-keys'), panelEl = $('lab-panel');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
} catch (e) { renderer = null; }
if (!renderer) root.classList.add('no3d');
else { window.__lab3d = true; start(); }

function start() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TAU = Math.PI * 2;

  /* ---------- theme ---------- */
  const T = {};
  const ROLES = ['canvas', 'panel', 'ink', 'muted', 'line', 'line-strong', 'accent', 'highlight', 'copper', 'tint', 'support', 'selection'];
  function readTheme() {
    const cs = getComputedStyle(root);
    for (const r of ROLES) T[r] = new THREE.Color(cs.getPropertyValue('--ds-' + r).trim() || '#888888');
    const hsl = {}; T.canvas.getHSL(hsl);
    T.dark = hsl.l < 0.3;
    T.household = T['line-strong'].clone().lerp(T.panel, 0.55);
    T.pulse = T.dark ? T.ink.clone() : T.selection.clone();
  }
  readTheme();

  const mats = [];
  const KIND = { lambert: THREE.MeshLambertMaterial, basic: THREE.MeshBasicMaterial, line: THREE.LineBasicMaterial, dash: THREE.LineDashedMaterial };
  function M(kind, role, opts) {
    const m = new KIND[kind](opts || {});
    m.userData.role = role; m.userData.kind = kind;
    mats.push(m); paint(m); return m;
  }
  function hotTarget(role) { return (role === 'accent' || role === 'highlight' || role === 'pulse') ? T.ink : T.accent; }
  function paint(m) {
    const r = m.userData.role; if (!r || !T[r]) return;
    m.color.copy(T[r]);
    if (m.userData.hot) {
      if (m.userData.kind === 'line' || m.userData.kind === 'dash') m.color.copy(T.accent);
      else m.color.lerp(hotTarget(r), 0.5);
    }
  }
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

  /* ---------- renderer, camera, lights ---------- */
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); root.classList.add('no3d'); });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  const amb = new THREE.AmbientLight(0xffffff, 0.72 * Math.PI);
  const sun = new THREE.DirectionalLight(0xffffff, 0.36 * Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0006;
  scene.add(amb, sun, sun.target);

  function applyTheme() {
    readTheme();
    for (const m of mats) paint(m);
    renderer.setClearColor(T.panel, 1);
    for (const s of Object.values(scenes)) if (s.shadowMat) s.shadowMat.opacity = T.dark ? 0.32 : 0.13;
    kick();
  }

  /* ---------- builders ---------- */
  function newScene(name) {
    const g = new THREE.Group(); g.visible = false; scene.add(g);
    const lw = d.createElement('div'); lw.style.display = 'none'; labelsEl.appendChild(lw);
    return { name, group: g, pick: [], parts: {}, anchor: {}, order: [], pulses: [], labels: [], labelWrap: lw, bars: [] };
  }
  function tag(sc, obj, key, anchor) {
    obj.userData.key = key; sc.pick.push(obj);
    if (!sc.parts[key]) { sc.parts[key] = []; sc.order.push(key); }
    sc.parts[key].push(obj);
    if (!sc.anchor[key]) sc.anchor[key] = anchor ? anchor.clone() : obj.position.clone();
  }
  function edgeLines(geo, role, dashed, opacity, dash) {
    const eg = new THREE.EdgesGeometry(geo, 20);
    const m = dashed
      ? M('dash', role, { dashSize: dash || 0.4, gapSize: (dash || 0.4) * 0.7, transparent: true, opacity: opacity })
      : M('line', role, { transparent: true, opacity: opacity });
    const ls = new THREE.LineSegments(eg, m);
    if (dashed) ls.computeLineDistances();
    return ls;
  }
  function box(parent, w, h, dp, role, o) {
    o = o || {};
    const geo = new THREE.BoxGeometry(w, h, dp);
    if (o.base) geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, M('lambert', role));
    mesh.position.set(o.x || 0, o.y || 0, o.z || 0);
    mesh.castShadow = o.shadow !== false; mesh.receiveShadow = true;
    if (o.edge !== false) mesh.add(edgeLines(geo, o.edge || 'ink', o.dashed, o.edgeOpacity == null ? 0.85 : o.edgeOpacity, o.dash));
    parent.add(mesh);
    return mesh;
  }
  function hitBox(parent, w, h, dp, pos) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), hitMat);
    m.position.copy(pos); parent.add(m); return m;
  }
  function lineSet(parent, pts, role, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ls = new THREE.LineSegments(g, M('line', role, { transparent: true, opacity: opacity == null ? 1 : opacity }));
    parent.add(ls); return ls;
  }
  function floor(sc, half, step, shadowHalf) {
    const pts = [];
    for (let v = -half; v <= half + 1e-6; v += step) pts.push(-half, 0, v, half, 0, v, v, 0, -half, v, 0, half);
    lineSet(sc.group, pts, 'line', 0.9);
    const sm = new THREE.ShadowMaterial({ opacity: T.dark ? 0.32 : 0.13 });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), sm);
    pl.rotation.x = -Math.PI / 2; pl.position.y = 0.02; pl.receiveShadow = true;
    sc.group.add(pl); sc.shadowMat = sm; sc.shadowHalf = shadowHalf || half;
  }
  function rounded(pts, r) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], a = pts[i - 1], b = pts[i + 1];
      const da = p.clone().sub(a), db = b.clone().sub(p);
      const ra = Math.min(r, da.length() / 2), rb = Math.min(r, db.length() / 2);
      out.push(p.clone().sub(da.normalize().multiplyScalar(ra)), p.clone().add(db.normalize().multiplyScalar(rb)));
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function makeCurve(pts) { return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5); }
  function tube(parent, curve, r, mat, from, to) {
    let c = curve;
    if (from != null) {
      const n = 8, sub = [];
      for (let i = 0; i <= n; i++) sub.push(curve.getPointAt(from + (to - from) * i / n));
      c = new THREE.CatmullRomCurve3(sub);
    }
    const len = c.getLength();
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(4, Math.min(220, Math.round(len * 1.5))), r, 7, false), mat);
    parent.add(m); return m;
  }
  /* cable: a tube along points, optional dashes, soft halo, hit proxy and pulses */
  function cable(sc, pts, o) {
    const curve = makeCurve(o.corner ? rounded(pts, o.corner) : pts);
    const len = curve.getLength();
    const mat = M(o.lit ? 'basic' : 'lambert', o.role);
    const g = new THREE.Group(); sc.group.add(g);
    if (o.dash) {
      const step = o.dash * 1.7 / len;
      for (let t = 0; t < 1; t += step) tube(g, curve, o.r, mat, t, Math.min(1, t + o.dash / len));
    } else tube(g, curve, o.r, mat);
    if (o.halo) {
      const hm = M('basic', o.role, { transparent: true, opacity: T.dark ? 0.22 : 0.16, depthWrite: false });
      tube(g, curve, o.r * 2.4, hm);
    }
    const hit = tube(g, curve, o.hitR || o.r * 4, hitMat);
    if (o.key) {
      tag(sc, hit, o.key, curve.getPointAt(o.anchorAt == null ? 0.5 : o.anchorAt));
      g.children.forEach((c) => { if (c !== hit) sc.parts[o.key].push(c); });
    }
    const n = o.pulses || 0;
    const pr = Math.max(o.r * 1.9, o.pulseMin || 0);
    for (let i = 0; i < n; i++) {
      const pm = new THREE.Mesh(new THREE.SphereGeometry(pr, 12, 8), M('basic', o.pulseRole || 'pulse'));
      g.add(pm);
      sc.pulses.push({ curve, mesh: pm, len, speed: o.speed, off: i / n + (o.phase || 0), dir: o.bidir && i % 2 ? -1 : (o.dir || 1) });
    }
    return g;
  }
  function label(sc, html, pos, cls) {
    const el = d.createElement('div');
    el.className = 'lbl ' + (cls || 'c');
    el.innerHTML = html;
    sc.labelWrap.appendChild(el);
    const L = { el, pos: pos.clone(), cls: cls || 'c' };
    sc.labels.push(L); return L;
  }

  const scenes = {};

  /* ---------- scene 1: rack (units: cm) ---------- */
  (function buildRack() {
    const sc = newScene('rack'); scenes.rack = sc; const G = sc.group;
    sc.title = 'Rack';
    sc.caption = $('lab-scap').textContent;
    floor(sc, 80, 10, 70);
    sc.view = { target: V(0, 50, -14), theta: 0.5, phi: 1.24, R: 46 };
    sc.sun = V(70, 150, 110);

    for (const sx of [-1, 1]) {
      const x = sx * 25.75;
      tag(sc, box(G, 3.5, 96, 3.5, 'line', { x, y: 48, z: -1.75 }), 'rack', V(x, 70, 0));
      tag(sc, box(G, 6, 2, 52, 'line', { x, y: 1, z: -18 }), 'rack');
      const ticks = [];
      for (let u = 6; u < 95; u += 4.445) ticks.push(x - 1, u, 0.02, x + 1, u, 0.02);
      lineSet(G, ticks, 'muted', 0.7);
    }
    tag(sc, box(G, 55, 2.5, 3.5, 'line', { y: 97.25, z: -1.75 }), 'rack');

    // core switch
    const cy = 90.7;
    tag(sc, box(G, 44, 4.4, 22, 'panel', { y: cy, z: -11 }), 'core', V(0, cy + 2.2, 0));
    for (const sx of [-1, 1]) tag(sc, box(G, 2.6, 4.4, 0.3, 'panel', { x: sx * 23.3, y: cy, z: 0.15 }), 'core');
    const corePort = [];
    for (let i = 0; i < 8; i++) {
      const x = -15.4 + i * 4.4;
      const p = box(G, 2.0, 1.2, 0.5, i === 6 ? 'highlight' : 'accent', { x, y: cy, z: 0.25, edge: 'muted', shadow: false });
      tag(sc, p, 'core-p' + (i + 1));
      tag(sc, hitBox(G, 4.2, 4.2, 1.4, V(x, cy, 0.5)), 'core-p' + (i + 1));
      corePort.push(V(x, cy, 0.5));
    }
    // access switch
    const ay = 84.2;
    tag(sc, box(G, 44, 4.4, 24, 'panel', { y: ay, z: -12 }), 'access', V(0, ay - 2.2, 0));
    for (const sx of [-1, 1]) tag(sc, box(G, 2.6, 4.4, 0.3, 'panel', { x: sx * 23.3, y: ay, z: 0.15 }), 'access');
    const TYPE = { 1: 'h', 2: 'h', 3: 'c', 4: 'e', 5: 'h', 6: 'h', 7: 'c', 8: 'c', 9: 'e', 10: 'c', 11: 'c', 12: 'c', 13: 'c', 14: 'e', 15: 'm', 16: 'c', 17: 't', 18: 'e' };
    const accPort = {};
    for (let n = 1; n <= 18; n++) {
      let x, y, w, h;
      if (n <= 16) { const c = Math.floor((n - 1) / 2); x = -18 + c * 3.0; y = n % 2 ? ay + 0.9 : ay - 0.9; w = 1.4; h = 1.1; }
      else { x = n === 17 ? 7.5 : 10.5; y = ay; w = 2.0; h = 1.2; }
      const t = TYPE[n];
      const role = t === 'h' ? 'household' : t === 'c' || t === 'm' ? 'copper' : t === 't' ? 'highlight' : 'tint';
      const p = box(G, w, h, 0.45, role, { x, y, z: 0.225, edge: 'muted', dashed: t === 'e', dash: 0.18, shadow: false, edgeOpacity: 1 });
      tag(sc, p, 'acc-p' + n);
      if (t === 'm') {
        const g = new THREE.BufferGeometry().setFromPoints([V(-0.5, -0.36, 0), V(0.5, -0.36, 0), V(0.5, 0.36, 0), V(-0.5, 0.36, 0), V(-0.5, -0.36, 0)]);
        const ln = new THREE.Line(g, M('dash', 'panel', { dashSize: 0.14, gapSize: 0.12 }));
        ln.computeLineDistances(); ln.position.set(x, y, 0.47); G.add(ln); sc.parts['acc-p' + n].push(ln);
      }
      tag(sc, hitBox(G, n <= 16 ? 2.9 : 2.9, n <= 16 ? 1.8 : 3.6, 1.4, V(x, y, 0.5)), 'acc-p' + n);
      accPort[n] = V(x, y, 0.5);
    }
    // shelves with unnamed desktop machines
    [4, 30, 56].forEach((sy, k) => {
      const key = 'shelf#' + (k + 1);
      tag(sc, box(G, 47, 1, 44, 'line', { y: sy - 0.5, z: -22 }), key, V(0, sy + 10, 0));
      tag(sc, box(G, 42, 20, 40, 'tint', { y: sy + 10, z: -21.2 }), key);
      const v = [];
      for (let i = 0; i < 5; i++) { const yy = sy + 5 + i * 2.5; v.push(-15, yy, -1.15, 15, yy, -1.15); }
      sc.parts[key].push(lineSet(G, v, 'accent', 0.55));
      label(sc, 'Desktop server shelf<span>machine not named</span>', V(-30, sy + 12, 0), 'r');
    });
    label(sc, 'Core switch', V(-30, cy + 0.6, 0), 'r');
    label(sc, 'Access switch', V(-30, ay - 0.6, 0), 'r');

    // fibre from the core switch, down the right side of the frame
    const fibrePorts = [0, 1, 2, 3, 4, 5, 7];
    fibrePorts.forEach((i, j) => {
      const p = corePort[i], xb = 29.2 + j * 0.62, zb = 4 + (j % 2) * 0.5;
      cable(sc, [p, V(p.x, p.y - 0.1, 3.4), V(p.x + (xb - p.x) * 0.55, 89.3 - j * 0.2, 5.6), V(xb, 86.5, zb + 0.6), V(xb, 60, zb), V(xb, 14, zb), V(xb, 4.5, 1), V(xb, 3.2, -16), V(xb, 3.2, -46)],
        { r: 0.2, role: 'accent', lit: true, halo: true, key: 'core-p' + (i + 1), hitR: 0.9, anchorAt: 0.04, pulses: 2, bidir: true, speed: 16, phase: j * 0.13, pulseMin: 0.42 });
    });
    // 1 gigabit fibre trunk, core port 7 to access port 17
    const p7 = corePort[6], p17 = accPort[17];
    const trunk = cable(sc, [p7, V(p7.x, p7.y - 0.3, 3.8), V((p7.x + p17.x) / 2, 87.6, 6.4), V(p17.x, p17.y + 1.4, 3.8), p17],
      { r: 0.22, role: 'highlight', lit: true, halo: true, key: 'core-p7', hitR: 0.9, anchorAt: 0.5, pulses: 2, bidir: true, speed: 6, pulseMin: 0.42 });
    sc.parts['acc-p17'].push(trunk);
    // copper from the access switch, down the left side
    const copper = [1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16];
    copper.forEach((n, j) => {
      const p = accPort[n], xb = -29.2 - j * 0.5, zb = 4 + (j % 2) * 0.45;
      const role = TYPE[n] === 'h' ? 'household' : n === 14 ? 'muted' : 'copper';
      cable(sc, [p, V(p.x, p.y - 0.15, 3), V(p.x + (xb - p.x) * 0.55, 81.6 - j * 0.12, 5.4), V(xb, 79, zb + 0.5), V(xb, 40, zb), V(xb, 14, zb), V(xb, 4.5, 1), V(xb, 3.2, -16), V(xb, 3.2, -46)],
        { r: 0.26, role, key: 'acc-p' + n, hitR: 0.9, anchorAt: 0.04 });
    });
    sc.keyOrder = ['core'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'core-p' + i), ['access'], Array.from({ length: 18 }, (_, i) => 'acc-p' + (i + 1)), ['shelf#1', 'shelf#2', 'shelf#3', 'rack']);
  })();

  /* ---------- scene 2: network (units: drawing px / 10) ---------- */
  (function buildNetwork() {
    const sc = newScene('network'); scenes.network = sc; const G = sc.group;
    sc.title = 'Network';
    sc.caption = 'Every recorded link, laid out as on the network diagram. The storage server\u2019s two fibres are drawn as one 20 gigabit bundle.'.replace('\u2019', "'");
    floor(sc, 70, 5, 62);
    sc.view = { target: V(0, 0, 1), theta: 0, phi: 0.72, R: 56, wideTheta: -0.72, widePhi: 0.64 };
    sc.sun = V(40, 120, 70);
    const P = (x, y, h) => V((x - 300) / 10, h || 0, (y - 520) / 10);
    const N = [
      ['internet', 215, 17, 170, 46, 1.0, 'canvas', 1, 'Internet'],
      ['router', 210, 112, 180, 56, 2.6, 'panel', 0, 'Router'],
      ['small', 30, 212, 170, 56, 1.6, 'panel', 0, 'Small switch, 2.5 Gb'],
      ['wifi', 395, 212, 180, 56, 1.0, 'canvas', 1, 'Wi-Fi devices'],
      ['access', 150, 312, 300, 56, 1.8, 'panel', 0, 'Access switch'],
      ['kvm1', 20, 414, 170, 52, 1.4, 'panel', 0, null],
      ['kvm2', 20, 484, 170, 52, 1.4, 'panel', 0, null],
      ['kvm3', 20, 554, 170, 52, 1.4, 'panel', 0, null],
      ['kvm4', 20, 624, 170, 52, 1.4, 'panel', 0, null],
      ['control', 417, 414, 176, 52, 0.8, 'panel', 0, null],
      ['security', 417, 484, 176, 52, 0.8, 'panel', 0, null],
      ['household', 417, 554, 176, 52, 1.0, 'canvas', 1, 'Household devices'],
      ['core', 120, 742, 360, 56, 1.8, 'panel', 0, 'Core switch'],
      ['s1', 25, 852, 170, 56, 5, 'tint', 0, 'Server 1'],
      ['s2', 215, 852, 170, 56, 5, 'tint', 0, 'Server 2'],
      ['media', 405, 852, 170, 56, 5, 'tint', 0, 'Media server'],
      ['storage', 120, 962, 170, 56, 5, 'tint', 0, 'Storage server'],
      ['training', 310, 962, 170, 56, 0.8, 'panel', 0, 'Training laptop']
    ];
    for (const [key, x, y, w, h, ht, role, dashed, name] of N) {
      const c = P(x + w / 2, y + h / 2);
      const m = box(G, w / 10 - 0.8, ht, h / 10 - 0.8, role, { x: c.x, z: c.z, base: true, dashed: !!dashed, dash: 0.6, edge: dashed ? 'muted' : 'ink', edgeOpacity: dashed ? 1 : 0.85 });
      tag(sc, m, key, V(c.x, ht, c.z));
      if (role === 'tint') {
        const v = []; const fz = c.z + (h / 10 - 0.8) / 2 + 0.02, hw = (w / 10 - 0.8) / 2 - 1.6;
        for (let i = 0; i < 4; i++) { const yy = 1.2 + i * 0.9; v.push(c.x - hw, yy, fz, c.x + hw, yy, fz); }
        sc.parts[key].push(lineSet(G, v, 'accent', 0.55));
      }
      if (name) label(sc, name, V(c.x, ht + 0.4, c.z), 'c');
    }
    label(sc, 'Remote consoles<span>one for each server</span>', P(105, 545, 1.8), 'c');
    label(sc, 'Control and security laptops', P(505, 475, 1.2), 'c');
    const Y = 0.45;
    const KINDS = {
      fibre: { r: 0.32, role: 'accent', lit: true, halo: true, pulseRole: 'pulse' },
      bundle: { r: 0.62, role: 'accent', lit: true, halo: true, pulseRole: 'pulse' },
      trunk: { r: 0.3, role: 'highlight', lit: true, dash: 1.1, pulseRole: 'pulse' },
      copper: { r: 0.2, role: 'copper', pulseRole: 'accent' },
      copper25: { r: 0.32, role: 'copper', pulseRole: 'accent' },
      mirror: { r: 0.2, role: 'copper', dash: 0.35, pulseRole: 'accent' },
      house: { r: 0.2, role: 'household', pulseRole: 'accent' },
      wifi: { r: 0.15, role: 'muted', dash: 0.8, pulseRole: 'accent' },
      plain: { r: 0.2, role: 'muted', pulseRole: 'accent' }
    };
    const L = [
      ['l-internet', 'plain', [[300, 63], [300, 112]]],
      ['l-up1', 'copper', [[288, 168], [288, 312]]],
      ['l-up2', 'copper', [[312, 168], [312, 312]]],
      ['l-small', 'copper25', [[210, 140], [115, 140], [115, 212]]],
      ['l-wifi', 'wifi', [[390, 140], [485, 140], [485, 212]]],
      ['l-kvm1', 'copper', [[200, 368], [200, 440], [190, 440]]],
      ['l-kvm2', 'copper', [[208, 368], [208, 510], [190, 510]]],
      ['l-kvm3', 'copper', [[216, 368], [216, 580], [190, 580]]],
      ['l-kvm4', 'copper', [[224, 368], [224, 650], [190, 650]]],
      ['l-control', 'copper', [[376, 368], [376, 440], [417, 440]]],
      ['l-secm', 'copper', [[384, 368], [384, 503], [417, 503]]],
      ['l-secc', 'mirror', [[392, 368], [392, 517], [417, 517]]],
      ['l-house', 'house', [[400, 368], [400, 580], [417, 580]]],
      ['l-trunk', 'trunk', [[300, 368], [300, 742]]],
      ['l-s1a', 'fibre', [[150, 798], [150, 852]]],
      ['l-s1b', 'fibre', [[170, 798], [170, 852]]],
      ['l-s2', 'fibre', [[300, 798], [300, 852]]],
      ['l-media', 'fibre', [[460, 798], [460, 852]]],
      ['l-storage', 'bundle', [[205, 798], [205, 962]]],
      ['l-training', 'fibre', [[395, 798], [395, 962]]],
      ['l-storage25', 'copper25', [[30, 240], [8, 240], [8, 990], [120, 990]]]
    ];
    L.forEach(([key, kind, pts], i) => {
      const k = KINDS[kind];
      const v = pts.map(([x, y]) => P(x, y, Y));
      let len = 0; for (let j = 1; j < v.length; j++) len += v[j].distanceTo(v[j - 1]);
      cable(sc, v, Object.assign({}, k, { key, corner: 1.2, hitR: 1.1, pulses: Math.max(1, Math.round(len / 9)), speed: 5, phase: i * 0.17, pulseMin: 0.42 }));
    });
    sc.keyOrder = N.map((n) => n[0]).concat(L.map((l) => l[0]));
  })();

  /* ---------- scene 3: test results ---------- */
  (function buildTests() {
    const sc = newScene('tests'); scenes.tests = sc; const G = sc.group;
    sc.title = 'Test results';
    sc.caption = 'Three hour training runs, each server on its own, 24 September 2026, from the hardware test report. Each group of bars has its own scale, starting from zero.';
    floor(sc, 60, 5, 50);
    sc.view = { target: V(0, 10, 0), theta: 0.14, phi: 1.22, R: 25 };
    sc.sun = V(30, 90, 60);
    const groups = [
      { x: -35, label: 'Throughput<br>tokens a second', bars: [['t-thr-s1', 41399, '41,399', 'Server 1', 'accent'], ['t-thr-s2', 20502, '20,502', 'Server 2', 'highlight']] },
      { x: 0, label: 'Hottest card<br>degrees C', bars: [['t-temp-s1#a', 64, '64 C', 'Server 1, one card', 'accent'], ['t-temp-s1#b', 66, '66 C', 'Server 1, other card', 'accent'], ['t-temp-s2', 77, '77 C', 'Server 2', 'highlight']] },
      { x: 35, label: 'Peak power<br>watts', bars: [['t-pow-s1', 678, '678 W', 'Server 1', 'accent'], ['t-pow-s2', 329, '329 W', 'Server 2', 'highlight']] }
    ];
    const H = 22, STEP = 9;
    let n = 0;
    for (const g of groups) {
      const max = Math.max.apply(null, g.bars.map((b) => b[1]));
      const wdt = g.bars.length * STEP + 2.4;
      box(G, wdt, 0.6, 9, 'panel', { x: g.x, y: 0.3 });
      label(sc, g.label, V(g.x, 0, 6.2), 'grp t');
      g.bars.forEach((b, i) => {
        const [key, v, txt, who, role] = b;
        const x = g.x + (i - (g.bars.length - 1) / 2) * STEP;
        const h = H * v / max;
        const m = box(G, 6, 1, 6, role, { x, y: 0.6, base: true });
        tag(sc, m, key, V(x, 0.6 + h / 2, 0));
        const sp = txt.indexOf(' ');
        const lb = label(sc, '<b>' + (sp > 0 ? txt.slice(0, sp) + '<small> ' + txt.slice(sp + 1) + '</small>' : txt) + '</b>', V(x, 0.6 + h, 0), 'val');
        sc.bars.push({ mesh: m, h, delay: n * 0.12, lbl: lb, key });
        n++;
      });
    }
    sc.keyOrder = sc.order.slice();
  })();

  /* ---------- facts from the page ---------- */
  const SUFFIX = { 'shelf#1': ', 1 of 3', 'shelf#2': ', 2 of 3', 'shelf#3': ', 3 of 3', 't-temp-s1#a': ', one card', 't-temp-s1#b': ', other card' };
  function fact(key) {
    const id = key.split('#')[0];
    const el = $('fact-' + id);
    if (!el) return null;
    return { el, name: el.querySelector('h4').textContent + (SUFFIX[key] || ''), short: el.getAttribute('data-short') || '' };
  }

  /* ---------- camera ---------- */
  const view = { theta: 0, phi: 1, dist: 100, target: V(0, 0, 0) };
  const goal = { theta: 0, phi: 1, dist: 100 };
  const base = { theta: 0, phi: 1, dist: 100 };
  let cur = null, fitDist = 100, autoTurn = !reduceMQ.matches, paused = reduceMQ.matches, animT = 0, swayT = 0;
  const SWAY = 0.42, SWAY_PERIOD = 44;
  // Keep the scene centred in the free area between the chips and the tool buttons.
  const chipsEl = stageEl.querySelector('.lab-chips');
  let padT = 0, padB = 0;
  function framing() {
    padT = chipsEl ? chipsEl.offsetTop + chipsEl.offsetHeight + 4 : 0;
    padB = 58;
    const lg = $('lab-legend'); if (lg) lg.style.top = padT + 'px';
    if (lg && cur && cur.name === 'tests') padT += lg.offsetHeight + 4;
    const hr = Math.max(Hh * 0.5, Hh - padT - padB);
    if (hr < Hh - padT - padB) { padT = (Hh - hr) * 0.6; padB = (Hh - hr) * 0.4; }
    const hv = padT + Hh - padB;
    camera.setViewOffset(W, hv, 0, 0, W, Hh);
    camera.aspect = W / hv;
    camera.updateProjectionMatrix();
  }
  function fit(R) {
    const hr = Hh - padT - padB, hv = padT + Hh - padB;
    const v = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * hr / hv);
    const h = 2 * Math.atan(Math.tan(v / 2) * W / hr);
    return R / Math.sin(Math.min(v, h) / 2);
  }
  function wide() { return W / Math.max(1, Hh - padT - padB) > 1.15; }
  function setBase() {
    const vw = cur.view;
    base.theta = wide() && vw.wideTheta != null ? vw.wideTheta : vw.theta;
    base.phi = wide() && vw.widePhi != null ? vw.widePhi : vw.phi;
    let R = vw.R;
    if (cur.name === 'network') R = wide() ? 38 : 42;
    fitDist = fit(R); base.dist = fitDist;
  }
  function resetView(snap) {
    setBase();
    goal.theta = base.theta; goal.phi = base.phi; goal.dist = base.dist;
    swayT = 0; autoTurn = !reduceMQ.matches;
    if (snap) { view.theta = goal.theta; view.phi = goal.phi; view.dist = goal.dist; }
    view.target.copy(cur.view.target);
    kick();
  }
  function stepCamera(dt) {
    const k = 1 - Math.exp(-dt * 9);
    let moving = false;
    for (const p of ['theta', 'phi', 'dist']) {
      const diff = goal[p] - view[p];
      if (Math.abs(diff) > (p === 'dist' ? 0.01 : 0.0004)) { view[p] += diff * k; moving = true; } else view[p] = goal[p];
    }
    const sp = Math.sin(view.phi), t = view.target;
    camera.position.set(t.x + view.dist * sp * Math.sin(view.theta), t.y + view.dist * Math.cos(view.phi), t.z + view.dist * sp * Math.cos(view.theta));
    camera.near = view.dist / 40; camera.far = view.dist * 6;
    camera.updateProjectionMatrix();
    camera.lookAt(t);
    return moving;
  }
  function stopAuto() { autoTurn = false; }

  /* ---------- size, visibility, loop ---------- */
  let W = 1, Hh = 1;
  function resize() {
    W = Math.max(1, stageEl.clientWidth); Hh = Math.max(1, stageEl.clientHeight);
    renderer.setSize(W, Hh, false);
    framing();
    if (cur) {
      const old = fitDist; setBase();
      const r = fitDist / old;
      goal.dist *= r; view.dist *= r;
      if (autoTurn) goal.theta = base.theta;
      labelMode();
    }
    kick();
  }
  new ResizeObserver(resize).observe(stageEl);
  // The stage clips its content; never let focus or the panel scroll it sideways or down.
  stageEl.addEventListener('scroll', () => { if (stageEl.scrollTop || stageEl.scrollLeft) { stageEl.scrollTop = 0; stageEl.scrollLeft = 0; } });
  let pageVisible = !d.hidden, onScreen = true;
  d.addEventListener('visibilitychange', () => { pageVisible = !d.hidden; kick(); });
  new IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; kick(); }, { threshold: 0 }).observe(stageEl);

  let raf = 0, last = 0, riseStart = 0;
  function kick() { if (!raf && pageVisible && onScreen) raf = requestAnimationFrame(frame); }
  function updatePulses() {
    for (const p of cur.pulses) {
      let u = ((animT * p.speed / p.len + p.off) % 1 + 1) % 1;
      if (p.dir < 0) u = 1 - u;
      p.mesh.position.copy(p.curve.getPointAt(u));
      const s = Math.sqrt(Math.sin(Math.PI * u));
      p.mesh.scale.setScalar(Math.max(0.05, s));
    }
  }
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function updateBars() {
    if (!cur.bars.length) return false;
    let busy = false;
    for (const b of cur.bars) {
      const t = clamp((animT - riseStart - b.delay) / 1.1, 0, 1);
      const e = b.instant ? 1 : ease(t);
      if (e < 1) busy = true;
      b.mesh.scale.y = Math.max(0.001, b.h * e);
      b.lbl.pos.y = 0.6 + b.h * e;
      b.lbl.el.style.opacity = e > 0.6 ? 1 : e / 0.6;
    }
    return busy && !paused;
  }
  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!paused) {
      animT += dt;
      if (autoTurn) { swayT += dt; goal.theta = base.theta + SWAY * Math.sin(swayT * TAU / SWAY_PERIOD); }
    }
    updatePulses();
    const rising = updateBars();
    const moving = stepCamera(dt);
    renderer.render(scene, camera);
    updateLabels();
    if (tipAnchored && hoverKey) placeTipAtAnchor();
    if ((!paused || rising || moving) && pageVisible && onScreen) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  /* ---------- labels ---------- */
  const pv = new THREE.Vector3();
  function project(p) { pv.copy(p).project(camera); return { x: (pv.x + 1) / 2 * W, y: (1 - pv.y) / 2 * Hh, ok: pv.z < 1 }; }
  let showAll = true;
  function labelMode() { showAll = W >= 560; }
  function updateLabels() {
    for (const L of cur.labels) {
      const isVal = L.cls.indexOf('val') >= 0 || L.cls.indexOf('grp') >= 0;
      const p = project(L.pos);
      const show = p.ok && (showAll || isVal) && p.x > -200 && p.x < W + 200;
      L.el.style.display = show ? '' : 'none';
      if (!show) continue;
      let tx;
      if (L.cls.indexOf('r') === 0) tx = 'translate(-100%,-50%) translate(-8px,0)';
      else if (L.cls.indexOf(' t') > 0) tx = 'translate(-50%,0) translate(0,6px)';
      else tx = 'translate(-50%,-100%) translate(0,-6px)';
      L.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) ' + tx;
    }
  }

  /* ---------- hover, tip, highlight ---------- */
  let hoverKey = null, pinKey = null, tipAnchored = false, tipMode = 'mouse';
  const hotNow = new Set();
  function setHotSet() {
    const want = new Set([hoverKey, pinKey].filter(Boolean));
    const flip = (key, on) => {
      for (const o of cur.parts[key] || []) o.traverse((c) => {
        const ms = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
        for (const m of ms) if (m.userData && m.userData.role) { m.userData.hot = on; paint(m); }
      });
    };
    for (const k of hotNow) if (!want.has(k)) { flip(k, false); hotNow.delete(k); }
    for (const k of want) if (!hotNow.has(k)) { flip(k, true); hotNow.add(k); }
    kick();
  }
  function setHover(key, mode, x, y) {
    hoverKey = key; tipMode = mode;
    setHotSet();
    canvas.classList.toggle('over', !!key && mode === 'mouse');
    if (!key) { tipEl.style.display = 'none'; tipAnchored = false; return; }
    const f = fact(key); if (!f) return;
    tipEl.textContent = '';
    const b = d.createElement('b'); b.textContent = f.name; tipEl.appendChild(b);
    const s = d.createElement('span'); s.textContent = f.short; tipEl.appendChild(s);
    if (mode === 'touch') {
      const btn = d.createElement('button'); btn.type = 'button'; btn.textContent = 'Details';
      btn.addEventListener('click', (e) => { e.stopPropagation(); openPanel(key); });
      tipEl.appendChild(btn);
    } else {
      const h = d.createElement('span'); h.className = 'hint';
      h.textContent = mode === 'kbd' ? 'Press Enter for the full detail' : 'Click for the full detail';
      tipEl.appendChild(h);
    }
    tipEl.style.display = 'block';
    tipEl.style.pointerEvents = mode === 'touch' ? 'auto' : 'none';
    if (mode === 'mouse') { tipAnchored = false; placeTip(x, y, false); }
    else { tipAnchored = true; placeTipAtAnchor(); }
  }
  function placeTip(x, y, above) {
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let left, top;
    if (above) { left = x - w / 2; top = y - h - 16; if (top < 8) top = y + 18; }
    else { left = x + 14; top = y + 16; if (top + h > Hh - 8) top = y - h - 12; if (left + w > W - 8) left = x - w - 14; }
    left = clamp(left, 8, Math.max(8, W - w - 8)); top = clamp(top, 8, Math.max(8, Hh - h - 8));
    tipEl.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }
  function placeTipAtAnchor() {
    const a = cur.anchor[hoverKey]; if (!a) return;
    const p = project(a); placeTip(p.x, p.y, true);
  }

  /* ---------- picking and pointer controls ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(cur.pick, false);
    return hits.length ? hits[0].object.userData.key : null;
  }
  const ptrs = new Map();
  let down = null, pinch0 = 0, dist0 = 0, hoverRaf = 0, lastMove = null;
  function rel(e) { const r = stageEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, moved: false, type: e.pointerType };
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; dist0 = goal.dist;
      if (down) down.moved = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId);
    if (prev) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      prev.x = e.clientX; prev.y = e.clientY;
      if (ptrs.size === 1 && down) {
        if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down.moved = true; canvas.classList.add('drag'); if (down.type === 'mouse') setHover(null); }
        if (down.moved) {
          goal.theta -= dx * 0.0075;
          goal.phi = clamp(goal.phi - dy * 0.006, 0.18, 1.5);
          stopAuto(); kick();
        }
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const dd = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        goal.dist = clamp(dist0 * pinch0 / dd, fitDist * 0.35, fitDist * 1.8); kick();
      }
      return;
    }
    if (e.pointerType !== 'mouse') return;
    lastMove = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const ev = lastMove, key = pickAt(ev.clientX, ev.clientY), p = rel(ev);
      if (key !== hoverKey || tipMode !== 'mouse') setHover(key, 'mouse', p.x, p.y);
      else if (key) placeTip(p.x, p.y, false);
    });
  });
  function endPtr(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) {
      canvas.classList.remove('drag');
      if (down && !down.moved && e.type === 'pointerup') tap(e, down.type);
      down = null;
    }
  }
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size && tipMode === 'mouse') setHover(null); });
  function tap(e, type) {
    const key = pickAt(e.clientX, e.clientY), p = rel(e);
    if (type === 'mouse') {
      if (key) openPanel(key); else { closePanel(); setHover(null); }
    } else {
      if (key && key === hoverKey) openPanel(key);
      else if (key) setHover(key, 'touch', p.x, p.y);
      else { setHover(null); }
    }
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    goal.dist = clamp(goal.dist * Math.exp(dy * 0.0012), fitDist * 0.35, fitDist * 1.8);
    kick();
  }, { passive: false });

  /* ---------- keyboard ---------- */
  function buildKeys() {
    keysEl.textContent = '';
    for (const key of cur.keyOrder) {
      const f = fact(key); if (!f) continue;
      const b = d.createElement('button'); b.type = 'button';
      b.textContent = f.name; b.dataset.key = key;
      b.setAttribute('aria-describedby', 'lab-help');
      b.addEventListener('focus', () => { stageEl.classList.add('kbd'); setHover(key, 'kbd'); });
      b.addEventListener('blur', () => { stageEl.classList.remove('kbd'); if (hoverKey === key && tipMode === 'kbd') setHover(null); });
      b.addEventListener('click', () => openPanel(key));
      keysEl.appendChild(b);
    }
  }
  canvas.addEventListener('focus', () => { if (canvas.matches(':focus-visible')) stageEl.classList.add('kbd'); });
  canvas.addEventListener('blur', () => stageEl.classList.remove('kbd'));
  stageEl.addEventListener('keydown', (e) => {
    if (e.target.closest('.lab-panel')) { if (e.key === 'Escape') closePanel(true); return; }
    const k = e.key;
    let used = true;
    if (k === 'ArrowLeft') goal.theta += 0.2;
    else if (k === 'ArrowRight') goal.theta -= 0.2;
    else if (k === 'ArrowUp') goal.phi = clamp(goal.phi - 0.12, 0.18, 1.5);
    else if (k === 'ArrowDown') goal.phi = clamp(goal.phi + 0.12, 0.18, 1.5);
    else if (k === '+' || k === '=') goal.dist = clamp(goal.dist * 0.85, fitDist * 0.35, fitDist * 1.8);
    else if (k === '-' || k === '_') goal.dist = clamp(goal.dist / 0.85, fitDist * 0.35, fitDist * 1.8);
    else if (k === 'Escape') { setHover(null); used = false; }
    else used = false;
    if (used) { e.preventDefault(); if (k.indexOf('Arrow') === 0) stopAuto(); kick(); }
  });

  /* ---------- side panel / bottom sheet ---------- */
  let lastFocus = null, closeTimer = 0;
  function openPanel(key) {
    const f = fact(key); if (!f) return;
    clearTimeout(closeTimer);
    $('lab-panel-k').textContent = cur.title;
    $('lab-panel-h').textContent = f.name;
    const body = $('lab-panel-body'); body.textContent = '';
    const ul = f.el.querySelector('ul'); if (ul) body.appendChild(ul.cloneNode(true));
    const links = f.el.querySelectorAll('.src a');
    if (links.length) {
      const src = d.createElement('div'); src.className = 'src';
      links.forEach((a) => { const c = a.cloneNode(true); c.textContent = 'Open the ' + a.textContent.charAt(0).toLowerCase() + a.textContent.slice(1); src.appendChild(c); });
      body.appendChild(src);
    }
    pinKey = key; setHover(null);
    setHotSet();
    if (!panelEl.classList.contains('open')) lastFocus = d.activeElement;
    panelEl.classList.add('open');
    panelEl.scrollTop = 0;
    $('lab-panel-h').focus({ preventScroll: true });
  }
  function closePanel(restore) {
    if (!panelEl.classList.contains('open')) return;
    panelEl.classList.remove('open');
    pinKey = null; setHotSet();
    if (restore && lastFocus && stageEl.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    else if (restore) canvas.focus({ preventScroll: true });
  }
  $('lab-panel-close').addEventListener('click', () => closePanel(true));
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelEl.classList.contains('open')) closePanel(true); });

  /* ---------- tools ---------- */
  const pauseBtn = $('lab-pause');
  function setPaused(p) {
    paused = p;
    pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
    pauseBtn.querySelector('span').textContent = p ? 'Play' : 'Pause';
    kick();
  }
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  $('lab-reset').addEventListener('click', () => { resetView(false); });
  setPaused(paused);

  /* ---------- tabs and scenes ---------- */
  const tabs = [...d.querySelectorAll('.lab-tabs [role="tab"]')];
  function setScene(name, focusTab) {
    if (!scenes[name]) name = 'rack';
    if (cur) { setHover(null); closePanel(false); pinKey = null; hotNow.clear(); cur.group.visible = false; cur.labelWrap.style.display = 'none'; }
    cur = scenes[name];
    cur.group.visible = true; cur.labelWrap.style.display = '';
    for (const t of tabs) {
      const on = t.dataset.scene === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on) { stageEl.setAttribute('aria-labelledby', t.id); if (focusTab) t.focus(); }
    }
    $('lab-scap').textContent = cur.caption;
    const lg = $('lab-legend'); if (lg) lg.hidden = name !== 'tests';
    canvas.setAttribute('aria-label', '3D view: ' + cur.title + '. ' + cur.caption);
    const s = cur.shadowHalf, sc = sun.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = cur.sun.length() * 2.5; sc.updateProjectionMatrix();
    sun.position.copy(cur.view.target).add(cur.sun); sun.target.position.copy(cur.view.target);
    sun.shadow.normalBias = s * 0.0012;
    riseStart = animT;
    for (const b of cur.bars) b.instant = paused;
    buildKeys(); labelMode(); framing();
    resetView(true);
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setScene(t.dataset.scene));
    t.addEventListener('keydown', (e) => {
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = tabs.length - 1;
      if (j >= 0) { e.preventDefault(); setScene(tabs[j].dataset.scene, true); }
    });
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (scenes[h] && h !== cur.name) setScene(h); });

  /* ---------- theme and motion preferences ---------- */
  const onScheme = () => { if (!root.hasAttribute('data-theme')) applyTheme(); };
  if (darkMQ.addEventListener) darkMQ.addEventListener('change', onScheme); else darkMQ.addListener(onScheme);
  const onMotion = () => { if (reduceMQ.matches) { autoTurn = false; setPaused(true); } };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotion); else reduceMQ.addListener(onMotion);

  new MutationObserver(() => applyTheme()).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  resize();
  applyTheme();
  setScene(location.hash.slice(1) || 'rack');
}
