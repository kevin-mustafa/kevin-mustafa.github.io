// Build timeline in 3D. Plain ES module, no build step. three.js release r170, saved in assets/vendor/three-r170/.
// Loaded only when the timeline section comes near the screen. Reads its numbers from the page itself
// (script#sky-data), so the 3D view and the flat heatmap below it always show the same counts.
import * as THREE from './vendor/three-r170/three.module.min.js';

const d = document, root = d.documentElement;
const $ = (id) => d.getElementById(id);
const sec = $('sky'), stage = $('sky-stage'), canvas = $('sky-canvas'), tip = $('sky-tip'), labels = $('sky-labels');
const DATA = JSON.parse($('sky-data').textContent);
const AREAS = DATA.areas;
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); } catch (e) { renderer = null; }
if (!renderer) sec.classList.add('sky-no3d');
else { sec.classList.add('sky-3d'); start(); }

function start() {
  const N = DATA.days.length, ROW = 1.7, GAP = 1.0, BAR = 0.74;
  const maxV = Math.max(1, ...DATA.days.flatMap((r) => AREAS.map((a) => r[a])));
  const H = 6.5 / Math.sqrt(maxV);   // square root scale, so quiet days still show; exact counts on hover
  const xOf = (i) => (i - (N - 1) / 2) * GAP;
  const zOf = (k) => (k - (AREAS.length - 1) / 2) * ROW;
  const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  /* theme */
  const T = {};
  function readTheme() {
    const cs = getComputedStyle(root);
    const g = (n) => new THREE.Color(cs.getPropertyValue(n).trim() || '#888888');
    T.canvas = g('--ds-canvas'); T.panel = g('--ds-panel'); T.ink = g('--ds-ink'); T.muted = g('--ds-muted');
    T.line = g('--ds-line'); T.accent = g('--ds-accent');
    T.area = AREAS.map((a) => g('--sky-' + a));
  }
  readTheme();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-30, 50, 40);
  scene.add(hemi, sun);

  /* ground plate and lane lines */
  const W = N * GAP + 2, D = AREAS.length * ROW + 3.2;
  const plateMat = new THREE.MeshLambertMaterial();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), plateMat);
  plate.position.set(0, -0.1, -0.6); scene.add(plate);
  const laneMat = new THREE.LineBasicMaterial();
  const laneG = new THREE.BufferGeometry();
  const lp = [];
  for (let k = 0; k <= AREAS.length; k++) { const z = zOf(k) - ROW / 2; lp.push(-W / 2 + 0.5, 0.01, z, W / 2 - 0.5, 0.01, z); }
  laneG.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  scene.add(new THREE.LineSegments(laneG, laneMat));

  /* bars: one instanced mesh, one instance per day and area */
  const cells = [];
  DATA.days.forEach((r, i) => AREAS.forEach((a, k) => cells.push({ i, k, v: r[a], day: r.d })));
  const geo = new THREE.BoxGeometry(BAR, 1, BAR); geo.translate(0, 0.5, 0);
  const barMat = new THREE.MeshLambertMaterial();
  const bars = new THREE.InstancedMesh(geo, barMat, cells.length);
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bars);
  const shown = AREAS.map(() => 1);          // area toggles, animated 0..1
  const want = AREAS.map(() => 1);
  let grow = reduceMQ.matches ? 1 : 0;        // 0..1 sweep across time on first view
  let hot = -1;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  function layout() {
    for (let n = 0; n < cells.length; n++) {
      const e = cells[n];
      const t = Math.min(1, Math.max(0, grow * (N + 12) - e.i) / 12);
      const ease = 1 - Math.pow(1 - t, 3);
      const h = e.v > 0 ? Math.max(0.18, Math.sqrt(e.v) * H) * ease * shown[e.k] : 0.05 * shown[e.k];
      s.set(1, Math.max(0.001, h), 1); p.set(xOf(e.i), 0, zOf(e.k));
      m4.compose(p, q, s); bars.setMatrixAt(n, m4);
    }
    bars.instanceMatrix.needsUpdate = true;
  }
  function colours() {
    for (let n = 0; n < cells.length; n++) {
      const e = cells[n];
      c.copy(e.v > 0 ? T.area[e.k] : T.line);
      if (n === hot) c.lerp(T.ink, 0.45);
      bars.setColorAt(n, c);
    }
    bars.instanceColor.needsUpdate = true;
  }

  /* milestones: thin poles with a flag, on a lane in front of the first row */
  const msMat = new THREE.MeshLambertMaterial(), flagMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const dayIndex = new Map(DATA.days.map((r, i) => [r.d, i]));
  const zMs = zOf(-1) + 0.2;
  const msObjs = [];
  const byDay = new Map();
  DATA.milestones.forEach((m) => { if (dayIndex.has(m.d)) { if (!byDay.has(m.d)) byDay.set(m.d, []); byDay.get(m.d).push(m); } });
  [...byDay.entries()].forEach(([day, list], j) => {
    const i = dayIndex.get(day);
    const hgt = 7.6 + (j % 3) * 0.9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hgt, 6), msMat);
    pole.position.set(xOf(i), hgt / 2, zMs);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), flagMat);
    flag.position.set(xOf(i) + 0.47, hgt - 0.3, zMs);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, hgt, 1.1), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(xOf(i) + 0.2, hgt / 2, zMs);
    hit.userData.ms = { d: day, list }; scene.add(pole, flag, hit);
    msObjs.push({ pole, flag, hit, i });
  });

  function applyTheme() {
    readTheme();
    renderer.setClearColor(T.panel, 1);
    plateMat.color.copy(T.canvas); laneMat.color.copy(T.line);
    msMat.color.copy(T.ink); flagMat.color.copy(T.accent);
    const dark = (() => { const h = {}; T.canvas.getHSL(h); return h.l < 0.3; })();
    hemi.intensity = dark ? 1.25 : 1.6; sun.intensity = dark ? 1.1 : 1.5;
    colours(); kick();
  }

  /* HTML labels: months along the front edge */
  const lab = [];
  // area names live on the colour toggles above the stage; rows sit too close in depth for labels
  let lastM = '';
  DATA.days.forEach((r, i) => { const mo = r.d.slice(0, 7); if (mo !== lastM) { lastM = mo; lab.push({ el: mk('sky-lab sky-mon', new Date(r.d + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short' })), at: new THREE.Vector3(xOf(i), 0, zOf(AREAS.length - 1) + ROW * 0.9) }); } });
  function mk(cls, txt) { const e = d.createElement('span'); e.className = cls; e.textContent = txt; labels.appendChild(e); return e; }
  const v3 = new THREE.Vector3();
  function placeLabels() {
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const l of lab) {
      v3.copy(l.at).project(camera);
      const hide = v3.z > 1 || (l.row !== undefined && shown[l.row] < 0.5);
      l.el.style.opacity = hide ? 0 : 1;
      l.el.style.transform = `translate(${((v3.x + 1) / 2) * w}px,${((1 - v3.y) / 2) * h}px)`;
    }
  }

  /* camera orbit; the view is fitted so the whole skyline fills the stage at any width */
  const narrow = () => stage.clientWidth < 560;
  const home = () => (narrow() ? { yaw: -0.95, pitch: 0.72 } : { yaw: -0.32, pitch: 0.7 });
  const view = Object.assign({ dist: 60 }, home());
  const target = new THREE.Vector3(0, 2.4, -0.4);
  const box = [];
  for (const x of [-W / 2, W / 2]) for (const y of [0, 7.2 * 1.25]) for (const z of [zOf(-1) - 0.4, zOf(AREAS.length - 1) + ROW / 2]) box.push(new THREE.Vector3(x, y, z));
  let sway = !reduceMQ.matches, swayT = 0, userMoved = false;
  function aim(dist, yaw) {
    const cp = Math.cos(view.pitch);
    camera.position.set(Math.sin(yaw) * cp * dist, Math.sin(view.pitch) * dist, Math.cos(yaw) * cp * dist).add(target);
    camera.lookAt(target); camera.updateMatrixWorld();
  }
  function frame() {
    const w = stage.clientWidth, h = stage.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    let lo = 8, hi = 400;
    for (let n = 0; n < 30; n++) {
      const mid = (lo + hi) / 2; aim(mid, view.yaw);
      const fits = box.every((v) => { const q2 = v.clone().project(camera); return Math.abs(q2.x) < 0.9 && Math.abs(q2.y) < 0.82 && q2.z < 1; });
      if (fits) hi = mid; else lo = mid;
    }
    view.dist = hi;
  }
  function place() { aim(view.dist, view.yaw + (sway ? Math.sin(swayT) * 0.1 : 0)); }

  /* render loop: runs only while something moves and the stage is on screen */
  let running = false, onScreen = true, visible = !d.hidden, last = 0;
  function kick() { if (!running && onScreen && visible) { running = true; last = performance.now(); requestAnimationFrame(tick); } }
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    let busy = false;
    if (grow < 1) { grow = Math.min(1, grow + dt / 3.2); busy = true; }
    for (let k = 0; k < AREAS.length; k++) {
      if (Math.abs(shown[k] - want[k]) > 0.001) { shown[k] += (want[k] - shown[k]) * Math.min(1, dt * 8); busy = true; } else shown[k] = want[k];
    }
    if (sway && !paused) { swayT += dt * 0.35; busy = true; }
    layout(); place(); renderer.render(scene, camera); placeLabels();
    if (busy && onScreen && visible) requestAnimationFrame(tick); else running = false;
  }
  d.addEventListener('visibilitychange', () => { visible = !d.hidden; kick(); });
  new IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; kick(); }, { threshold: 0 }).observe(stage);

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); if (!userMoved) Object.assign(view, home()); frame(); kick();
  }
  new ResizeObserver(resize).observe(stage);

  /* pointer: drag turns (sideways only on touch, so the page still scrolls), hover shows a day, tap pins it */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let drag = null;
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const ms = ray.intersectObjects(msObjs.map((o) => o.hit), false)[0];
    const hb = ray.intersectObject(bars, false).find((x) => shown[cells[x.instanceId].k] > 0.5);
    if (ms && (!hb || ms.distance < hb.distance)) return { ms: ms.object.userData.ms };
    return hb ? { n: hb.instanceId } : null;
  }
  function show(hit, x, y, pinned) {
    if (!hit) { tip.hidden = true; setHot(-1); return; }
    let html;
    if (hit.ms) {
      html = `<b>${fmt(hit.ms.d)}</b>` + hit.ms.list.map((m) => `<br>${esc(m.label)}` + (m.page ? ` <a href="${m.page}">Write-up</a>` : '')).join('');
      setHot(-1);
    } else {
      const e = cells[hit.n], r = DATA.days[e.i];
      const tot = AREAS.reduce((t, a) => t + r[a], 0);
      html = `<b>${fmt(r.d)}</b> ${tot} record${tot === 1 ? '' : 's'}<br>` + AREAS.filter((a) => r[a] > 0).map((a) => `${DATA.names[a]} ${r[a]}`).join(', ');
      setHot(hit.n);
    }
    tip.innerHTML = html; tip.hidden = false; tip.classList.toggle('pinned', !!pinned);
    const sr = stage.getBoundingClientRect();
    const tx = Math.min(Math.max(8, x - sr.left), sr.width - 8), ty = Math.max(8, y - sr.top);
    tip.style.transform = `translate(${tx}px,${ty}px)`;
  }
  function setHot(n) { if (n !== hot) { hot = n; colours(); kick(); } }
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false, touch: e.pointerType === 'touch' }; });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        if (drag.touch && Math.abs(dy) > Math.abs(dx)) return;
        if (!drag.touch && e.buttons) canvas.setPointerCapture(e.pointerId);
        view.yaw = Math.max(-1.4, Math.min(1.4, drag.yaw - dx * 0.006));
        if (!drag.touch) view.pitch = Math.max(0.15, Math.min(1.3, drag.pitch + dy * 0.005));
        stopSway(); kick(); return;
      }
    }
    if (e.pointerType === 'mouse' && !tip.classList.contains('pinned')) show(pick(e), e.clientX, e.clientY, false);
  });
  canvas.addEventListener('pointerup', (e) => { if (drag && !drag.moved) show(pick(e), e.clientX, e.clientY, true); drag = null; });
  canvas.addEventListener('pointerleave', () => { if (!tip.classList.contains('pinned')) show(null); });
  canvas.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey) return; e.preventDefault(); view.dist = Math.max(20, Math.min(180, view.dist * (1 + e.deltaY * 0.001))); stopSway(); kick(); }, { passive: false });
  function stopSway() { if (!userMoved) { userMoved = true; sway = false; syncPause(); } }

  /* controls */
  let paused = reduceMQ.matches;
  const pauseBtn = $('sky-pause'), resetBtn = $('sky-reset');
  function syncPause() { pauseBtn.setAttribute('aria-pressed', String(paused || !sway)); pauseBtn.querySelector('span').textContent = paused || !sway ? 'Play' : 'Pause'; }
  pauseBtn.addEventListener('click', () => { if (paused || !sway) { paused = false; sway = true; } else paused = true; syncPause(); kick(); });
  resetBtn.addEventListener('click', () => { Object.assign(view, home()); frame(); grow = reduceMQ.matches ? 1 : 0; tip.hidden = true; setHot(-1); kick(); });
  d.querySelectorAll('#sky-areas button').forEach((b) => {
    const k = AREAS.indexOf(b.dataset.area);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      if (!on && want.filter((x) => x).length === 1) return;   // keep at least one area on
      b.setAttribute('aria-pressed', String(on)); want[k] = on ? 1 : 0; d.querySelectorAll('.sky-hm tr.a-' + b.dataset.area).forEach((tr) => { tr.hidden = !on; }); tip.hidden = true; setHot(-1); kick();
    });
  });
  syncPause();

  /* theme follows the switch and the device */
  new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  const onScheme = () => { if (!root.hasAttribute('data-theme')) applyTheme(); };
  if (darkMQ.addEventListener) darkMQ.addEventListener('change', onScheme);
  const onMotion = () => { if (reduceMQ.matches) { sway = false; grow = 1; syncPause(); kick(); } };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotion);

  colours(); applyTheme(); resize();
  window.__sky3d = true;
}
