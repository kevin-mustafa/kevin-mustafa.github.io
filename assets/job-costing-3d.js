// Job costing in 3D: a cost landscape (one stacked bar per scenario) and a token factory (the chosen scenario as
// machines, energy flowing in and tokens flowing out). Plain ES module, no build step. three.js release r170, saved in
// assets/vendor/three-r170/. Loaded only when its stage comes near the screen; the numbers come from the page's engine.
import * as THREE from './vendor/three-r170/three.module.min.js';

export function init({ stage, canvas, labels, tip, onPick }) {
  let renderer = null;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); } catch (e) { renderer = null; }
  if (!renderer || !renderer.getContext()) return null;
  const d = document, root = d.documentElement;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)'), darkMQ = matchMedia('(prefers-color-scheme: dark)');
  let reduced = reduceMQ.matches;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stage.closest('.jc-app')?.classList.add('jc-no3d'); });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-24, 40, 30);
  scene.add(hemi, sun);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  /* ---------- theme: read the page's colour tokens, repaint on change ---------- */
  const T = {};
  function readTheme() {
    const cs = getComputedStyle(root);
    const g = (n, fb) => new THREE.Color((cs.getPropertyValue(n) || '').trim() || fb);
    T.canvas = g('--ds-canvas', '#F0E8DA'); T.panel = g('--ds-panel', '#FAF0DC'); T.ink = g('--ds-ink', '#25272B');
    T.muted = g('--ds-muted', '#55585C'); T.line = g('--ds-line', '#C9C2B5'); T.strong = g('--ds-line-strong', '#6F7276');
    T.accent = g('--ds-accent', '#1F3F86'); T.copper = g('--ds-copper', '#85592C'); T.rent = g('--jc-rent', '#A8A49B');
    T.tint = g('--ds-tint', '#E4DED3'); T.highlight = g('--ds-highlight', '#4A69A6'); T.support = g('--ds-support', '#3B3E43');
    const hsl = {}; T.canvas.getHSL(hsl); T.dark = hsl.l < 0.3;
    T.dimBox = T.strong.clone().lerp(T.panel, 0.62);
  }
  readTheme();
  const mats = new Set();
  function M(kind, role, opts = {}, mix = null) {
    const C = kind === 'basic' ? THREE.MeshBasicMaterial : kind === 'line' ? THREE.LineBasicMaterial : THREE.MeshLambertMaterial;
    const m = new C(opts); m.userData.role = role; m.userData.mix = mix; mats.add(m); paint(m); return m;
  }
  function paint(m) {
    const r = m.userData.role; if (!r || !T[r]) return;
    m.color.copy(T[r]);
    if (m.userData.mix) m.color.lerp(T[m.userData.mix[0]], m.userData.mix[1]);
    if (m.userData.hot) m.color.lerp(T.ink, 0.22);
  }
  function dropMat(m) { mats.delete(m); m.dispose(); }

  /* ---------- shared state ---------- */
  let view = 'landscape', state = null, paused = reduced, userMoved = false, sway = !reduced, swayT = 0, time = 0;
  const views = {
    landscape: { yaw: -0.32, pitch: 0.46, dist: 40, target: new THREE.Vector3(0, 2.2, 0), center: new THREE.Vector3(0, 3.3, 0.35), box: [] },
    factory: { yaw: -0.42, pitch: 0.62, dist: 50, target: new THREE.Vector3(0, 1.4, -1.2), center: new THREE.Vector3(0, 1.8, -2), box: [] },
  };
  const landG = new THREE.Group(), facG = new THREE.Group();
  scene.add(landG, facG); facG.visible = false;
  const labs = [];   // {el, at: Vector3, group: 'land'|'fac', show: () => bool}
  function lab(cls, html, group) {
    const el = d.createElement('span'); el.className = 'jc-lab ' + cls; el.innerHTML = html; labels.appendChild(el);
    const o = { el, at: new THREE.Vector3(), group, on: true }; labs.push(o); return o;
  }
  function dropLabs(group) {
    for (let i = labs.length - 1; i >= 0; i--) if (labs[i].group === group) { labs[i].el.remove(); labs.splice(i, 1); }
  }

  /* ---------- the cost landscape ---------- */
  const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
  const SP = 1.6, BW = 1.0, HMAX = 6.2, GAP = 0.06;
  const floorMat = M('lambert', 'canvas');
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 3.4), floorMat); floor.position.set(0, -0.1, 0.25); landG.add(floor);
  const laneLineMat = M('line', 'line');
  const planeMat = M('basic', 'accent', { transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.6), planeMat); plane.rotation.x = -Math.PI / 2; landG.add(plane);
  const outlineMat = M('line', 'ink');
  const outGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BW + 0.14, 1, BW + 0.14)); outGeo.translate(0, 0.5, 0);
  const outline = new THREE.LineSegments(outGeo, outlineMat); landG.add(outline);
  const outline2Mat = M('line', 'muted');
  const outline2 = new THREE.LineSegments(outGeo, outline2Mat); outline2.visible = false; landG.add(outline2);
  const selMat = M('basic', 'accent');
  const selMark = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.3, 0.04, 0.12), selMat); selMark.position.set(0, 0.02, 0.74); landG.add(selMark);
  let laneLine = null;
  let bars = [], barsLane = null, hot = -1, planeH = { cur: 0, from: 0, to: 0 }, tween = null;
  const PART = [['cap', 'accent'], ['en', 'copper'], ['ext', 'rent']];
  function buildBars(st) {
    for (const b of bars) for (const s of b.segs) { landG.remove(s.mesh); dropMat(s.mesh.material); }
    dropLabs('land'); bars = [];
    const n = st.rows.length, W = n * SP + 0.6;
    floor.scale.x = W; plane.scale.x = W - 0.2;
    if (laneLine) { landG.remove(laneLine); laneLine.geometry.dispose(); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute([-W / 2 + 0.2, 0.01, 0.9, W / 2 - 0.2, 0.01, 0.9], 3));
    laneLine = new THREE.LineSegments(lg, laneLineMat); landG.add(laneLine);
    st.rows.forEach((row, i) => {
      const x = (i - (n - 1) / 2) * SP;
      const segs = PART.map(([k, role]) => {
        const mesh = new THREE.Mesh(BOX, M('lambert', role));
        mesh.position.set(x, 0, 0); mesh.scale.set(BW, 0.001, BW); mesh.userData.i = i; landG.add(mesh);
        return { k, mesh, cur: 0, from: 0, to: 0 };
      });
      const name = lab('n', esc(row.short), 'land'), val = lab('v', '', 'land');
      bars.push({ sid: row.sid, x, segs, lift: 0, liftTo: 0, name, val, row });
    });
    barsLane = st.lane + '|' + st.rows.map((r) => r.sid).join(',');
    const v = views.landscape; v.box = [];
    for (const xx of [-W / 2, W / 2]) for (const y of [0, HMAX + 0.7]) for (const z of [-0.7, 1.5]) v.box.push(new THREE.Vector3(xx, y, z));
    v.center.set(0, (HMAX + 0.7) / 2, 0.4);
    hot = -1;
  }
  function setBars(st, animate) {
    const max = st.max || 1;
    st.rows.forEach((row, i) => {
      const b = bars[i]; if (!b) return; b.row = row;
      b.segs.forEach((s) => { s.from = s.cur; s.to = HMAX * Math.max(0, row.seg[s.k]) / max; });
      b.val.el.textContent = st.fmt(row.v);
    });
    planeH.from = planeH.cur; planeH.to = HMAX * st.base / max;
    if (animate && !reduced) tween = { t0: performance.now(), dur: 600 };
    else { tween = null; bars.forEach((b) => b.segs.forEach((s) => { s.cur = s.to; })); planeH.cur = planeH.to; }
    layoutBars();
  }
  function layoutBars() {
    for (const b of bars) {
      let y = b.lift;
      for (const s of b.segs) {
        const h = s.cur;
        s.mesh.visible = h > 0.002;
        s.mesh.position.y = y; s.mesh.scale.y = Math.max(0.001, h);
        if (h > 0.002) y += h + GAP;
      }
      b.top = y;
      b.name.at.set(b.x, 0, 1.25);
      b.val.at.set(b.x, Math.max(b.top, 0.05) + 0.12, 0);
    }
    const bi = bars.findIndex((b) => b.sid === 'base');
    if (bi >= 0) { const b = bars[bi]; outline.visible = true; outline.position.set(b.x, b.lift - 0.02, 0); outline.scale.set(1, Math.max(0.05, b.top - b.lift + 0.04), 1); } else outline.visible = false;
    const wi = state && state.g !== 'train' ? bars.findIndex((b) => b.sid === 'sw') : -1;
    if (wi >= 0) { const b = bars[wi]; outline2.visible = true; outline2.position.set(b.x, b.lift - 0.02, 0); outline2.scale.set(1, Math.max(0.05, b.top - b.lift + 0.04), 1); } else outline2.visible = false;
    plane.position.y = planeH.cur; plane.visible = planeH.cur > 0.01;
    const si = state ? bars.findIndex((b) => b.sid === state.sel) : -1;
    selMark.visible = si >= 0 && view === 'landscape'; if (si >= 0) selMark.position.x = bars[si].x;
  }
  function setHot(i) {
    if (i === hot) return;
    keepDirty = true;
    if (hot >= 0 && bars[hot]) { bars[hot].liftTo = 0; bars[hot].segs.forEach((s) => { s.mesh.material.userData.hot = false; paint(s.mesh.material); }); }
    hot = i;
    if (hot >= 0 && bars[hot]) { bars[hot].liftTo = reduced ? 0 : 0.35; bars[hot].segs.forEach((s) => { s.mesh.material.userData.hot = true; paint(s.mesh.material); }); }
    kick();
  }

  /* ---------- the token factory ---------- */
  const facFloorMat = M('lambert', 'canvas');
  const facFloor = new THREE.Mesh(new THREE.BoxGeometry(26, 0.2, 13), facFloorMat); facFloor.position.set(0, -0.1, -1.5); facG.add(facFloor);
  const facParts = [];   // meshes rebuilt per scenario
  const ENERGY_MAX = 120, TOKEN_MAX = 240;
  const eMat = M('lambert', 'copper'), tMat = M('lambert', 'accent');
  const eMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), eMat, ENERGY_MAX);
  const tMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), tMat, TOKEN_MAX);
  eMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  eMesh.frustumCulled = false; tMesh.frustumCulled = false;
  facG.add(eMesh, tMesh);
  let emitters = [], glowMats = [], rise = null, facKey = '';
  const STORE = new THREE.Vector3(9.4, 0, 0.9), METER = new THREE.Vector3(-10.4, 0, -1.6), CONV_Z = 1.3;
  function part(mesh) { facG.add(mesh); facParts.push(mesh); return mesh; }
  function clearFactory() {
    for (const m of facParts) {
      facG.remove(m);
      m.traverse((o) => { if (o.isMesh || o.isLineSegments) { if (o.geometry && o.geometry !== BOX) o.geometry.dispose(); if (o.material) dropMat(o.material); } });
    }
    facParts.length = 0; emitters = []; glowMats = []; dropLabs('fac');
  }
  function box(w, h, dd, role, x, y, z, mix) {
    const g = new THREE.BoxGeometry(w, h, dd); g.translate(0, h / 2, 0);
    const m = new THREE.Mesh(g, M('lambert', role, {}, mix)); m.position.set(x, y, z); return m;
  }
  function polyPath(pts) {
    const segs = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); segs.push([pts[i - 1], pts[i], L, l]); L += l; }
    const v = new THREE.Vector3();
    return { len: L, at(t, out) { const s0 = t * L; for (const [a, b, s, l] of segs) if (s0 <= s + l || b === pts[pts.length - 1]) return (out || v).copy(a).lerp(b, l ? Math.min(1, (s0 - s) / l) : 0); return (out || v).copy(pts[pts.length - 1]); } };
  }
  function curvePath(a, b, lift) {
    const c = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + lift, (a.z + b.z) / 2);
    const q = new THREE.QuadraticBezierCurve3(a.clone(), c, b.clone());
    return { len: q.getLength(), at(t, out) { return q.getPointAt(Math.min(1, Math.max(0, t)), out || new THREE.Vector3()); } };
  }
  const MACH = { pc1: [2.7, 2.3], pc2: [2.1, 2.1], pc3: [2.5, 2.5], pc5: [2.7, 2.3], m5: [2.5, 0.15] };
  function buildFactory(info) {
    clearFactory();
    const ms = info.machines;
    const widths = ms.map((m) => MACH[m.id][0]), total = widths.reduce((a, b) => a + b, 0) + 1.3 * (ms.length - 1);
    let x = -1.4 - total / 2;
    const zM = -1.6, dM = 1.9;
    // energy meter and the store
    const meter = part(box(1.1, 2.0, 0.9, 'support', METER.x, 0, METER.z));
    const dial = part(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 24), M('basic', 'copper')));
    dial.rotation.x = Math.PI / 2; dial.position.set(METER.x, 1.35, METER.z + 0.48);
    lab('m', 'Meter', 'fac').at.set(METER.x, 2.45, METER.z);
    part(box(2.0, 2.0, 2.0, 'support', STORE.x, 0, STORE.z));
    part(box(15.6, 0.18, 0.7, 'strong', (STORE.x - 1 + (-7.2)) / 2, 0, CONV_Z, ['panel', 0.25]));
    const big = lab('big', '', 'fac'); big.at.set(STORE.x, 2.35, STORE.z); big.el.innerHTML = `${esc(info.unit)}<small>${esc(info.name)}</small>`;
    const tokN = (tc) => (tc ? Math.max(4, Math.min(14, Math.round(3 + 2.2 * Math.log10(tc)))) : 10);
    const tokV = (tc) => (tc ? Math.max(0.06, Math.min(0.3, 0.07 + 0.035 * Math.log10(tc))) : 0.18);
    ms.forEach((mc, i) => {
      const [w, h] = MACH[mc.id], cx = x + w / 2; x += w + 1.3;
      const g = new THREE.Group(); part(g);
      const mix = mc.dim ? ['panel', 0.55] : null;
      if (mc.laptop) {
        const b = box(w, 0.14, 1.7, 'strong', 0, 0, 0, mix); g.add(b);
        const scr = box(w, 1.55, 0.08, 'support', 0, 0.12, -0.8, mix); scr.rotation.x = -0.22; g.add(scr);
      } else g.add(box(w, h, dM, mc.swap ? 'strong' : 'support', 0, 0, 0, mix));
      g.position.set(cx, 0, zM);
      const lb = lab('m' + (mc.dim ? ' dim' : ''), esc(mc.name) + (mc.dim ? ' (today)' : ''), 'fac'); lb.at.set(cx, (mc.laptop ? 1.7 : h) + 0.55, zM);
      // card slabs on the front face; glowing when they work in this scenario
      const slabs = [];
      for (let k = 0; k < mc.cards; k++) {
        const active = !mc.dim && k < mc.on;
        const role = active ? 'accent' : 'line';
        const sg = new THREE.BoxGeometry(mc.laptop ? w * 0.6 : w * 0.74, 0.24, 0.1);
        const sm = new THREE.Mesh(sg, M('basic', role, {}, mc.dim ? ['panel', 0.4] : null));
        const sy = mc.laptop ? 0.2 : 0.55 + k * 0.46, sz = mc.laptop ? 0.86 : dM / 2 + 0.06;
        sm.position.set(0, sy, sz); g.add(sm);
        if (active) { glowMats.push(sm.material); slabs.push(new THREE.Vector3(cx, sy, zM + sz + 0.08)); if (mc.swap) mc._slab = sm; }
      }
      if (!mc.dim) {
        // energy: from the meter to the top of this machine, rate set by its share of the power draw
        if (mc.kw > 0) {
          const a = new THREE.Vector3(METER.x, 2.0, METER.z), b = new THREE.Vector3(cx, (mc.laptop ? 0.3 : h) + 0.02, zM);
          emitters.push({ kind: 'e', path: curvePath(a, b, 2.2), n: 8, v: Math.max(0.05, Math.min(0.42, 0.06 + 0.24 * mc.kw)), ph: Math.random() });
        }
        const tc = mc.tps ? mc.tps / Math.max(1, mc.on) : null;
        for (const s of slabs) {
          const p = polyPath([s, new THREE.Vector3(s.x, s.y, CONV_Z - 0.1), new THREE.Vector3(s.x, 0.34, CONV_Z), new THREE.Vector3(STORE.x - 1.05, 0.34, CONV_Z), new THREE.Vector3(STORE.x - 1.05, 0.9, STORE.z)]);
          emitters.push({ kind: 't', path: p, n: tokN(tc), v: tokV(tc) * 6 / p.len * 1.6, ph: Math.random() });
        }
        if (mc.id === 'pc5' || mc.swap) rise = { g: mc.swap ? null : g, slab: mc.swap ? mc._slab : null, t0: performance.now(), dur: 900 };
      }
    });
    if (info.cloud) {
      const cp = new THREE.Vector3(3.2, 3.6, -5.4);
      const pad = part(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.3, 40), M('lambert', 'tint')));
      pad.position.copy(cp);
      const rb = part(box(2.4, 1.5, 1.6, 'support', cp.x, cp.y + 0.15, cp.z));
      for (let k = 0; k < info.cloud.n; k++) {
        const sm = part(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 0.1), M('basic', 'accent')));
        sm.position.set(cp.x, cp.y + 0.55 + k * 0.42, cp.z + 0.86); glowMats.push(sm.material);
      }
      lab('m', `Rented: ${info.cloud.n} × ${esc(info.cloud.card)}`, 'fac').at.set(cp.x, cp.y + 2.3, cp.z);
      const p = curvePath(new THREE.Vector3(cp.x + 1.2, cp.y + 0.6, cp.z + 0.9), new THREE.Vector3(STORE.x, 2.05, STORE.z), 1.2);
      const tc = info.cloud.tps ? info.cloud.tps / info.cloud.n : null;
      emitters.push({ kind: 't', path: p, n: tokN(tc) + 2, v: tokV(tc) * 6 / p.len * 1.6, ph: Math.random() });
      void rb;
    }
    if (info.api) {
      const a = new THREE.Vector3(2.0, 1.25, -8.5), b = new THREE.Vector3(STORE.x - 0.2, 1.25, STORE.z - 0.95);
      const len = a.distanceTo(b);
      const pg = new THREE.CylinderGeometry(0.36, 0.36, len, 20, 1, true);
      const pipe = part(new THREE.Mesh(pg, M('lambert', 'rent', { transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })));
      pipe.position.copy(a).lerp(b, 0.5); pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      lab('m', 'API: tokens bought from outside', 'fac').at.set(a.x, a.y + 1.0, a.z);
      emitters.push({ kind: 't', path: polyPath([a, b]), n: 12, v: 0.16, ph: Math.random() });
    }
    const v = views.factory; v.box = [];
    const zb = info.cloud || info.api ? -8.6 : -3.2;
    facFloor.scale.set(23.6 / 26, 1, (3.4 - zb) / 13); facFloor.position.set(0, -0.1, (2.8 + zb - 0.6) / 2);
    for (const xx of [-11.8, 11.8]) for (const y of [0, info.cloud ? 6.2 : 3.6]) for (const z of [zb - 0.6, 2.8]) v.box.push(new THREE.Vector3(xx, y, z));
    v.center.set(0, 1.6, (zb + 2.0) / 2);
    if (reduced) rise = null;
    applyRise(rise ? 0 : 1);
    if (view === 'factory') { frame(); }
  }
  function applyRise(t) {
    if (!rise) return;
    const k = easeOut(Math.min(1, t));
    if (rise.g) rise.g.position.y = -2.6 * (1 - k);
    if (rise.slab) rise.slab.scale.set(Math.max(0.01, k), 1, 1);
  }
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  function placeParticles() {
    let ie = 0, it = 0;
    for (const em of emitters) {
      for (let k = 0; k < em.n; k++) {
        const t = (em.ph + k / em.n + time * em.v) % 1;
        em.path.at(t, pv);
        const s = t < 0.06 ? t / 0.06 : t > 0.94 ? (1 - t) / 0.06 : 1;
        sc.setScalar(Math.max(0.001, s)); m4.compose(pv, q0, sc);
        if (em.kind === 'e') { if (ie < ENERGY_MAX) eMesh.setMatrixAt(ie++, m4); } else if (it < TOKEN_MAX) tMesh.setMatrixAt(it++, m4);
      }
    }
    sc.setScalar(0.0001); m4.compose(pv.set(0, -50, 0), q0, sc);
    for (; ie < ENERGY_MAX; ie++) eMesh.setMatrixAt(ie, m4);
    for (; it < TOKEN_MAX; it++) tMesh.setMatrixAt(it, m4);
    eMesh.instanceMatrix.needsUpdate = true; tMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------- camera: orbit, fitted to the stage; a slow drift unless paused or reduced motion ---------- */
  function aim(v, yaw) {
    const cp = Math.cos(v.pitch);
    camera.position.set(Math.sin(yaw) * cp * v.dist, Math.sin(v.pitch) * v.dist, Math.cos(yaw) * cp * v.dist).add(v.target);
    camera.lookAt(v.target); camera.updateMatrixWorld();
  }
  const HOME = { landscape: () => (stage.clientWidth < 560 ? { yaw: -0.78, pitch: 0.5 } : { yaw: -0.32, pitch: 0.46 }), factory: () => (stage.clientWidth < 560 ? { yaw: -0.62, pitch: 0.78 } : { yaw: -0.42, pitch: 0.62 }) };
  function frame() {
    keepDirty = true;
    const v = views[view], w = stage.clientWidth, h = stage.clientHeight;
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    if (!v.box.length) return;
    const topLim = 1 - 2 * Math.min(0.32, 96 / Math.max(1, h)), botLim = -(1 - 2 * Math.min(0.2, (view === 'factory' ? 58 : 34) / Math.max(1, h))), xLim = 0.94;
    const q = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
    v.target.copy(v.center);
    for (let pass = 0; pass < 3; pass++) {
      let lo = 4, hi = 900;
      for (let n = 0; n < 34; n++) {
        const mid = (lo + hi) / 2; v.dist = mid; aim(v, v.yaw);
        const fits = v.box.every((p) => { q.copy(p).project(camera); return Math.abs(q.x) < xLim && q.y < topLim && q.y > botLim && q.z < 1; });
        if (fits) hi = mid; else lo = mid;
      }
      v.dist = hi; aim(v, v.yaw);
      // centre the projected box in the free area by moving the target, then fit again
      let y0 = 9, y1 = -9, x0 = 9, x1 = -9;
      for (const p of v.box) { q.copy(p).project(camera); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); }
      const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * v.dist, ww = hh * camera.aspect;
      up.set(0, 1, 0).applyQuaternion(camera.quaternion); right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      v.target.addScaledVector(up, ((y0 + y1) / 2 - (botLim + topLim) / 2) * hh).addScaledVector(right, ((x0 + x1) / 2) * ww);
    }
  }
  function place() { const v = views[view]; aim(v, v.yaw + (sway && !paused ? Math.sin(swayT) * 0.11 : 0)); }

  /* ---------- labels: HTML spans placed from 3D points ---------- */
  const v3 = new THREE.Vector3();
  let keepSet = null, keepDirty = true;   // which labels show is decided on changes, not every frame, so the drift never flickers them
  function placeLabels() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const g = view === 'landscape' ? 'land' : 'fac';
    const pos = new Map();
    for (const l of labs) {
      if (l.group !== g) { l.el.style.opacity = 0; continue; }
      v3.copy(l.at).project(camera);
      pos.set(l, [(v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h, v3.z < 1]);
    }
    const keep = keepDirty || !keepSet ? new Set() : keepSet;
    if (g === 'land' && bars.length && (keepDirty || !keepSet)) {
      // names and values are thinned out where bars crowd together on screen; the list below has every one
      const minI = bars.reduce((m, b, i) => (b.row.v < bars[m].row.v ? i : m), 0);
      const selI = state ? bars.findIndex((b) => b.sid === state.sel) : -1, swI = state && state.g !== 'train' ? bars.findIndex((b) => b.sid === 'sw') : -1;
      const must = new Set([0, selI, hot].filter((i) => i >= 0));
      const first = [0, selI, hot, swI, minI].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
      const order = [...first, ...bars.map((b, i) => i).filter((i) => !first.includes(i))];
      let near = 999;
      for (let i = 1; i < bars.length; i++) near = Math.min(near, Math.abs(pos.get(bars[i].name)[0] - pos.get(bars[i - 1].name)[0]));
      const rot = near < 66, crowded = near < 22;
      for (const [kind, gap] of [['name', rot ? 19 : 62], ['val', 48]]) {
        const kept = [];
        const fits = (x, y) => kept.every(([kx, ky]) => Math.abs(kx - x) >= gap || (kind === 'val' && Math.abs(ky - y) > 17));
        for (const i of order) {
          const l = bars[i][kind], [x, y] = pos.get(l);
          if (kind === 'name' && crowded && !must.has(i)) continue;
          if (must.has(i) || fits(x, y)) { keep.add(l); kept.push([x, y]); }
        }
      }
      for (const b of bars) b.name.rot = rot;
      keepSet = keep; keepDirty = false;
    }
    for (const [l, [x0, y, front]] of pos) {
      let x = x0;
      if (l.el.classList.contains('big') || l.el.classList.contains('m')) { const hw = l.el.offsetWidth / 2 + 6; x = Math.min(Math.max(x, hw), w - hw); }
      const show = front && (g === 'fac' || keep.has(l));
      l.el.style.opacity = show ? 1 : 0;
      const tx = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      l.el.style.transform = l.rot ? tx + ' rotate(-38deg) translate(-100%,0)' : tx;
      l.el.classList.toggle('rot', !!l.rot);
    }
  }

  /* ---------- render loop: runs only while something moves and the stage is on screen ---------- */
  let running = false, onScreen = true, visible = !d.hidden, last = 0;
  function kick() { if (!running && onScreen && visible) { running = true; last = performance.now(); requestAnimationFrame(tick); } }
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    let busy = false;
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.dur), k = ease(t);
      bars.forEach((b) => b.segs.forEach((s) => { s.cur = s.from + (s.to - s.from) * k; }));
      planeH.cur = planeH.from + (planeH.to - planeH.from) * k;
      if (t >= 1) tween = null; busy = true;
    }
    for (const b of bars) { if (Math.abs(b.lift - b.liftTo) > 0.002) { b.lift += (b.liftTo - b.lift) * Math.min(1, dt * 12); busy = true; } else b.lift = b.liftTo; }
    if (view === 'landscape') layoutBars();
    if (view === 'factory') {
      if (rise) { const t = (now - rise.t0) / rise.dur; applyRise(t); if (t >= 1) rise = null; else busy = true; }
      if (!paused && !reduced) { time += dt; busy = true; const pulse = 0.5 + 0.5 * Math.sin(now / 420); glowMats.forEach((m) => { m.color.copy(T.accent).lerp(T.highlight, 0.35 * pulse); }); }
      placeParticles();
    }
    if (sway && !paused) { swayT += dt * 0.3; busy = true; }
    place(); renderer.render(scene, camera); placeLabels();
    if (busy && onScreen && visible) requestAnimationFrame(tick); else running = false;
  }
  d.addEventListener('visibilitychange', () => { visible = !d.hidden; kick(); });
  new IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; kick(); }, { threshold: 0 }).observe(stage);
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    if (!userMoved) for (const k of Object.keys(views)) Object.assign(views[k], HOME[k]());
    frame(); kick();
  }
  new ResizeObserver(resize).observe(stage);

  /* ---------- pointer: drag turns (sideways only on touch, so the page still scrolls), hover shows, click opens ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let drag = null;
  function pickBar(cx, cy) {
    if (view !== 'landscape') return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(bars.flatMap((b) => b.segs.map((s) => s.mesh)).filter((m) => m.visible), false)[0];
    if (hit) return hit.object.userData.i;
    // generous target: the column above and around each bar
    let best = -1, bd = 1e9;
    bars.forEach((b, i) => {
      const p = v3.set(b.x, Math.max(0.3, (b.top || 0) / 2), 0).project(camera);
      const sx = (p.x + 1) / 2 * r.width, sy = (1 - p.y) / 2 * r.height, dx = Math.abs(cx - r.left - sx);
      const top = v3.set(b.x, (b.top || 0) + 0.3, 0).project(camera), tyy = (1 - top.y) / 2 * r.height;
      const base = v3.set(b.x, 0, 1.2).project(camera), byy = (1 - base.y) / 2 * r.height;
      if (dx < 18 && cy - r.top > tyy - 14 && cy - r.top < byy + 14 && dx < bd) { bd = dx; best = i; }
      void sy;
    });
    return best;
  }
  function showTip(i, cx, cy) {
    if (i < 0 || !state) { tip.hidden = true; setHot(-1); return; }
    const b = bars[i], o = state.tip(b.row);
    tip.innerHTML = `<b>${esc(o.title)}</b><span class="v">${esc(o.value)}</span>${o.lines.map((l) => `<span class="h" style="margin-top:0">${esc(l)}</span>`).join('')}<span class="h">${esc(o.hint)}</span>`;
    tip.hidden = false; setHot(i);
    const sr = stage.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = cx - sr.left + 14, y = cy - sr.top - th - 10;
    if (x + tw > sr.width - 8) x = cx - sr.left - tw - 14;
    if (y < 8) y = cy - sr.top + 18;
    tip.style.transform = `translate(${Math.max(8, x).toFixed(0)}px,${Math.max(8, y).toFixed(0)}px)`;
  }
  function barScreen(i) {
    const r = canvas.getBoundingClientRect(), b = bars[i];
    const p = v3.set(b.x, (b.top || 0) + 0.1, 0).project(camera);
    return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height];
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, v: { ...views[view] }, moved: false, touch: e.pointerType !== 'mouse' }; });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      if (drag.moved) {
        if (drag.touch && Math.abs(dy) > Math.abs(dx)) return;
        if (!drag.touch && e.buttons) canvas.setPointerCapture(e.pointerId);
        const v = views[view];
        v.yaw = Math.max(-1.3, Math.min(1.3, drag.v.yaw - dx * 0.006));
        if (!drag.touch) v.pitch = Math.max(0.12, Math.min(1.25, drag.v.pitch + dy * 0.005));
        userMoved = true; sway = false; tip.hidden = true; keepDirty = true; kick(); return;
      }
    }
    if (e.pointerType === 'mouse') { const i = pickBar(e.clientX, e.clientY); canvas.classList.toggle('over', i >= 0); showTip(i, e.clientX, e.clientY); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      const i = pickBar(e.clientX, e.clientY);
      if (i >= 0) { showTip(i, e.clientX, e.clientY); onPick(bars[i].sid); }
    }
    drag = null;
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) { tip.hidden = true; setHot(-1); } });
  canvas.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey) return; e.preventDefault(); const v = views[view]; v.dist = Math.max(10, Math.min(300, v.dist * (1 + e.deltaY * 0.001))); userMoved = true; sway = false; kick(); }, { passive: false });
  // keyboard: arrows step through the bars, Enter opens the job cost sheet
  canvas.addEventListener('keydown', (e) => {
    if (view !== 'landscape' || !bars.length) return;
    let i = hot < 0 ? bars.findIndex((b) => state && b.sid === state.sel) : hot;
    if (e.key === 'ArrowRight') i = Math.min(bars.length - 1, i + 1); else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = bars.length - 1;
    else if ((e.key === 'Enter' || e.key === ' ') && hot >= 0) { e.preventDefault(); onPick(bars[hot].sid); return; }
    else if (e.key === 'Escape') { tip.hidden = true; setHot(-1); return; }
    else return;
    e.preventDefault(); if (i < 0) i = 0;
    const [sx, sy] = barScreen(i); showTip(i, sx, sy);
  });
  canvas.addEventListener('focus', () => stage.classList.add('kbd'));
  canvas.addEventListener('blur', () => { stage.classList.remove('kbd'); tip.hidden = true; setHot(-1); });

  /* ---------- theme follows the switch and the device; motion follows the device ---------- */
  function applyTheme() {
    readTheme(); renderer.setClearColor(T.panel, 1); mats.forEach(paint);
    hemi.intensity = T.dark ? 1.2 : 1.5; sun.intensity = T.dark ? 1.0 : 1.4; kick();
  }
  new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  const onScheme = () => { if (!root.hasAttribute('data-theme')) applyTheme(); };
  if (darkMQ.addEventListener) darkMQ.addEventListener('change', onScheme);
  const onMotion = () => { reduced = reduceMQ.matches; if (reduced) { sway = false; paused = true; } kick(); };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotion);
  applyTheme();

  /* ---------- the page talks to the view through these ---------- */
  const esc2 = esc;
  function update(st) {
    const first = !state; state = st; keepDirty = true;
    const key = st.lane + '|' + st.rows.map((r) => r.sid).join(',');
    if (key !== barsLane) { buildBars(st); setBars(st, false); if (view === 'landscape') frame(); }
    else setBars(st, !first);
    const fk = st.lane + '|' + st.sel + '|' + st.mode;
    if (fk !== facKey || !facParts.length) { buildFactory(st.factory); facKey = fk; }
    else { const big = labs.find((l) => l.group === 'fac' && l.el.classList.contains('big')); if (big) big.el.innerHTML = `${esc2(st.factory.unit)}<small>${esc2(st.factory.name)}</small>`; }
    kick();
  }
  function setView(v) {
    view = v === 'factory' ? 'factory' : 'landscape';
    landG.visible = view === 'landscape'; facG.visible = view === 'factory';
    tip.hidden = true; setHot(-1);
    if (state && view === 'factory' && !reduced && facParts.length) { const pc = state.factory.machines.find((m) => (m.id === 'pc5' || m.swap) && !m.dim); if (pc) buildFactory(state.factory); }
    frame(); kick();
  }
  function setPaused(b) { paused = !!b; if (!paused && !reduced && !userMoved) sway = true; kick(); }
  function reset() {
    userMoved = false; sway = !reduced && !paused;
    for (const k of Object.keys(views)) Object.assign(views[k], HOME[k]());
    frame(); tip.hidden = true; setHot(-1); kick();
  }
  // read-only hooks for the page's own tests: where a bar sits on screen, and what the view holds
  window.__jc3d = { get view() { return view; }, get bars() { return bars.length; }, get emitters() { return emitters.length; },
    point(sid) { const i = bars.findIndex((b) => b.sid === sid); if (i < 0) return null; const r = canvas.getBoundingClientRect(), b = bars[i]; const p = v3.set(b.x, Math.max(0.2, (b.top || 0) * 0.5), 0).project(camera); return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height]; } };
  return { update, setView, setPaused, reset };
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
