// Job costing page: live cost per token, job cost sheets and charts. Plain ES module, no build step, no outside requests.
// The same functions write the default numbers into job-costing.html when the page is built, and update them here
// when a setting moves, so the page reads correctly with scripts off. The formulas live in job-costing-engine.js.
import { compute, evaluate, bridge, fixedRate } from './job-costing-engine.js';

/* ------------------------------------------------------------------ words and numbers */
export const KIND = { M: 'Measured', O: 'My record', Q: 'Quoted', S: 'Published', E: 'Estimate', C: 'Computed' };
export const KIND_LONG = {
  M: 'measured on the lab by a meter, sensor or log', O: 'my own record: a bill, invoice or order',
  Q: "a seller's price on a date", S: 'a published figure: a benchmark, price list or paper',
  E: 'an estimate: an assumption, said so', C: 'computed from the other figures',
};
export const TYPE = { own: 'Owned machines', add: 'Added capacity', rent: 'Rented cards', price: 'Bought per token' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const group3 = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function num(v, d) {
  if (v == null || !isFinite(v)) return 'n/a';
  const r = Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v;
  const s = Math.abs(r).toFixed(d), i = s.indexOf('.');
  const body = i < 0 ? group3(s) : group3(s.slice(0, i)) + s.slice(i);
  return (r < 0 ? '-' : '') + body;
}
// 2 decimals from 0.1 up, else 2 significant figures (0.073, 0.0057)
export function smart(v) {
  const a = Math.abs(v);
  if (!isFinite(v)) return 'n/a';
  if (a >= 0.1 || a === 0) return num(v, 2);
  return num(v, Math.min(7, 1 - Math.floor(Math.log10(a))));
}
// 4 significant figures for the job cost sheets
export function precise(v) {
  const a = Math.abs(v);
  if (!isFinite(v)) return 'n/a';
  if (a === 0) return '0';
  if (a >= 1000) return num(v, 0);
  if (a >= 100) return num(v, 1);
  if (a >= 10) return num(v, 2);
  if (a >= 1) return num(v, 3);
  return num(v, Math.min(8, 3 - Math.floor(Math.log10(a))));
}
export const aud = (v, f = smart) => (v < 0 ? '-A$' + f(-v) : 'A$' + f(v));
export const signed = (v, f = smart) => (v > 0 ? '+' : '') + aud(v, f);
export const pct = (x, d = 0) => (x > 0 ? '+' : '') + num(100 * x, d) + '%';
export const kindChip = (k) => (k ? `<span class="jc-kind k-${k}">${KIND[k]}</span>` : '');
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const trim = (v, d) => num(v, d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/* ------------------------------------------------------------------ lanes, labels, measures */
export const GROUPS = [
  { id: 'train', name: 'Training' },
  { id: 'datagen', name: 'Writing training data' },
  { id: 'inference', name: 'Answering questions' },
];
export const laneOf = (g, size) => (g === 'train' ? (size === '1B' ? 'pretrain_1B' : 'pretrain_537M') : g);
export const groupOf = (lane) => (lane.startsWith('pretrain') ? 'train' : lane);
export const MEASURES = {
  train: [
    { id: 'btok', name: 'per billion tokens', unit: 'per billion tokens', k: 1000 },
    { id: 'words', name: 'per million words', unit: 'per million words', words: true },
    { id: 'mparam', name: 'per million parameters', unit: 'per million parameters', mparam: true },
  ],
  datagen: [
    { id: 'mtok', name: 'per million tokens', unit: 'per million kept tokens', k: 1 },
    { id: 'words', name: 'per million words', unit: 'per million kept words', words: true },
    { id: 'intok', name: 'per million input tokens', unit: 'per million input tokens', input: true },
  ],
  inference: [
    { id: 'mtok', name: 'per million tokens', unit: 'per million tokens', k: 1 },
    { id: 'words', name: 'per million words', unit: 'per million words', words: true },
    { id: 'intok', name: 'per million input tokens', unit: 'per million input tokens', input: true },
  ],
};
export const measureOf = (g, mid) => MEASURES[g].find((m) => m.id === mid) || MEASURES[g][0];
const SHORT = {
  train: { sw: 'FP8' },
  datagen: { sw: 'Batched', api: 'Llama API', api2: 'Haiku batch' },
  inference: { sw: '8 users', api: 'gpt-oss API', api2: 'Haiku API' },
};
const LONG = {
  train: { sw: 'FP8 training (software)' },
  datagen: { sw: 'Batch the requests (software)', api: 'API: Llama 3.1 8B', api2: 'API: Claude Haiku 5.5, batch' },
  inference: { sw: '8 users at once (software)', api: 'API: gpt-oss-20b', api2: 'API: Claude Haiku 5.5' },
};
export const shortLabel = (model, g, sid) => (SHORT[g] && SHORT[g][sid]) || model.scen[sid][0];
export const longLabel = (model, g, sid) => (LONG[g] && LONG[g][sid]) || model.scen[sid][1];
export const MODES = { fleet: 'Whole lab after the change', added: 'Added capacity only' };
// the input-token cost of a whole lab: hourly costs added, input speeds added
function fleetIn(a, b) { return a.in && b.in ? (a.rate + b.rate) / (a.rate / a.in + b.rate / b.in) : null; }
// the result a row shows: the whole lab after the change (default) or the added capacity alone
export function pickRes(L, sid, mode) {
  const e = L[sid];
  if (mode !== 'added' && e.fleet) {
    const ref = L.sw && e.fleet && L.base.per_mparam == null ? L.sw : L.base;
    return { ...e.fleet, in: fleetIn(ref, e), isFleet: true };
  }
  return e;
}
// the value of a result in a measure, straight from the engine's fields
export function value(m, e) {
  if (m.input) return e.in;
  if (m.words) return e.words;
  if (m.mparam) return e.per_mparam;
  return e.out * m.k;
}
// A$ per million output tokens into the measure's units (for parts and bridges)
export function factor(m, p, e) {
  if (m.words) return 1 / p.wpt;
  if (m.mparam) return p.tpp;
  if (m.input) return e && e.in != null && e.out ? e.in / e.out : 1;
  return m.k;
}
export function shares(e) {
  if (e.rate == null) return { cap: 0, en: 0, ext: 1 };
  return { cap: e.rate_cap / e.rate, en: e.rate_en / e.rate, ext: e.rate_ext / e.rate };
}
// hardware and rent rows for data and answers are batched: they compare with today, batched (the sw row)
export const refOf = (g, t) => (g !== 'train' && (t === 'add' || t === 'rent') ? 'sw' : 'base');
export function rowsData(model, p, res, g, lane, mid, mode = 'fleet') {
  const m = measureOf(g, mid), L = res.lanes[lane];
  const rows = Object.keys(model.lanes[lane]).map((sid) => {
    const r = model.lanes[lane][sid], e = pickRes(L, sid, mode), v = value(m, e), sh = shares(e);
    const rs = refOf(g, r.t), vr = value(m, L[rs]);
    const alt = L[sid].fleet ? { added: value(m, L[sid]), fleet: value(m, pickRes(L, sid, 'fleet')) } : null;
    return { sid, short: shortLabel(model, g, sid), long: longLabel(model, g, sid), v, vs: sid === rs ? 0 : v / vr - 1, ref: rs,
      k: r.k, t: r.t, alt, seg: { cap: v * sh.cap, en: v * sh.en, ext: v * sh.ext } };
  });
  return { m, rows, mode, max: Math.max(...rows.map((x) => x.v)), base: value(m, L.base), batched: g === 'train' ? null : value(m, L.sw) };
}
// today to this scenario, in A$ per million output tokens
export function bridgeSteps(model, res, g, lane, sid) {
  const L = res.lanes[lane], base = L.base, e = L[sid], r = model.lanes[lane][sid];
  if (sid === 'base') return null;
  let parts, to = e;
  if (r.t === 'add' || r.t === 'rent') {
    to = e.fleet;
    if (g === 'train') parts = bridge(base, to);
    else parts = [['Batching (software)', L.sw.out - base.out], ...bridge(L.sw, to)];
  } else parts = bridge(base, e);
  const tiny = 1e-9 * Math.max(base.out, to.out);
  return { from: base.out, to: to.out, toFleet: to !== e, parts: parts.filter((x) => Math.abs(x[1]) > tiny) };
}
const PART_CLS = { 'Machine cost': 'c-m', Electricity: 'c-e', Rent: 'c-x', 'API price': 'c-x' };

/* ------------------------------------------------------------------ waterfall rows (bridges, variances) */
// steps: [{label, v, total, cls, d}]: totals start at zero, steps float from the running total
export function waterfall(steps, opts = {}) {
  const f = opts.fmt || smart, cap = opts.caption || 'Waterfall';
  let run = 0;
  const segs = steps.map((s) => {
    if (s.total) { run = s.v; return { ...s, a: Math.min(0, s.v), b: Math.max(0, s.v) }; }
    const a = run, b = run + s.v; run = b;
    return { ...s, a: Math.min(a, b), b: Math.max(a, b) };
  });
  if (opts.from != null) segs.forEach((s) => { if (s.total) s.a = opts.from; });
  const lo = opts.from != null ? opts.from : Math.min(0, ...segs.map((s) => s.a)), hi = Math.max(...segs.map((s) => s.b));
  const span = hi - lo || 1, pc = (x) => (100 * (x - lo) / span);
  const zero = lo < 0 && opts.from == null ? `<s style="left:${pc(0).toFixed(2)}%"></s>` : '';
  const showD = steps.some((s) => s.d);
  let h = `<table class="jc-wf"><caption class="vh">${esc(cap)}</caption><tbody>`;
  for (const s of segs) {
    const left = pc(s.a), w = Math.max(0, pc(s.b) - pc(s.a));
    const val = s.total ? aud(s.v, f) : signed(s.v, f);
    h += `<tr class="${s.total ? 't' : 's'} ${s.cls || ''}"><th scope="row">${esc(s.label)}</th><td class="bar">${zero}<i style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%"></i></td><td class="v">${val}</td>${showD ? `<td class="d">${esc(s.d || '')}</td>` : ''}</tr>`;
  }
  return h + '</tbody></table>';
}

/* ------------------------------------------------------------------ the scenario list */
const segHtml = (x, R) => {
  const w = (v) => Math.max(0, 100 * v / (R.max || 1)).toFixed(2) + '%';
  return (x.seg.cap > 0 ? `<i class="s-m" style="width:${w(x.seg.cap)}"></i>` : '') + (x.seg.en > 0 ? `<i class="s-e" style="width:${w(x.seg.en)}"></i>` : '') + (x.seg.ext > 0 ? `<i class="s-x" style="width:${w(x.seg.ext)}"></i>` : '');
};
export const vsHtml = (x) => (x.vs === 0 && x.sid === x.ref ? (x.sid === 'base' ? 'today' : 'batched') : `${pct(x.vs)}<small>${x.ref === 'sw' ? 'vs batched' : 'vs today'}</small>`) + '<span class="vh">,</span>';
export const valHtml = (x, R) => `${aud(x.v)}<span class="vh"> ${esc(R.m.unit)}${x.alt ? (R.mode === 'added' ? ', added capacity only' : ', whole lab after the change') : ''},</span>`;
function rowHtml(x, R, body, open, sel, g) {
  const tag = x.sid === 'base' ? 'baseline' : g !== 'train' && x.sid === 'sw' ? 'today, batched' : '';
  return `<li class="jc-row${sel ? ' is-sel' : ''}" data-sid="${x.sid}"><details${open ? ' open' : ''}><summary>` +
    `<span class="jc-r-name">${esc(x.long)}${tag ? ` <em class="jc-tag">${tag}</em>` : ''}</span>` +
    `<span class="jc-r-bar" aria-hidden="true">${segHtml(x, R)}</span>` +
    `<b class="jc-r-val">${valHtml(x, R)}</b>` +
    `<span class="jc-r-vs">${vsHtml(x)}</span>${kindChip(x.k)}` +
    `</summary><div class="jc-r-body">${body || ''}</div></details></li>`;
}
export function updateRowHtml(li, x, R) {
  li.querySelector('.jc-r-bar').innerHTML = segHtml(x, R);
  li.querySelector('.jc-r-val').innerHTML = valHtml(x, R);
  li.querySelector('.jc-r-vs').innerHTML = vsHtml(x);
}
export function listHtml(model, p, res, g, lane, mid, opts = {}) {
  const mode = opts.mode || 'fleet', R = rowsData(model, p, res, g, lane, mid, mode), open = opts.open || [];
  return `<ol class="jc-list" data-lane="${lane}" data-measure="${R.m.id}" aria-label="${esc(R.m.unit)}">` +
    R.rows.map((x) => rowHtml(x, R, opts.sheets ? sheetHtml(model, p, res, g, lane, x.sid, mid, mode) : '', open.includes(x.sid), opts.sel === x.sid, g)).join('') + '</ol>';
}
export function rowTip(model, R, x) {
  const lines = [];
  if (x.alt) lines.push(`${MODES.fleet}: ${aud(x.alt.fleet)}`, `${MODES.added}: ${aud(x.alt.added)}`);
  const parts = [];
  if (x.seg.cap > 0) parts.push(`machine ${aud(x.seg.cap)}`);
  if (x.seg.en > 0) parts.push(`electricity ${aud(x.seg.en)}`);
  if (x.seg.ext > 0) parts.push(`${x.t === 'price' ? 'API price' : 'rent'} ${aud(x.seg.ext)}`);
  lines.push('Parts: ' + parts.join(', '));
  const vs = x.vs === 0 && x.sid === x.ref ? (x.sid === 'base' ? 'The baseline.' : 'Today, batched: the comparison for hardware rows.') : `${pct(x.vs)} against ${x.ref === 'sw' ? 'today, batched' : 'today'}.`;
  return { title: x.long, value: `${aud(x.v)} ${R.m.unit}${x.alt ? (R.mode === 'added' ? ' (added capacity only)' : ' (whole lab after the change)') : ''}`, lines, hint: vs + ' Open the row for its job cost sheet.' };
}

/* ------------------------------------------------------------------ the job cost sheet (layer 3) */
function assetsText(model, assets, p) {
  const how = p.basis >= 0.5 ? 'what it would sell for (indicative resale, 20 Aug 2026)' : 'replacement cost new (estimate, 20 Aug 2026)';
  return assets.map(([a, s]) => `${model.assets[a].name}${s < 1 ? (s === 0.5 ? ', half (one card)' : `, ${num(s * 100, 0)}%`) : ''}`).join(' and ') + ': ' + how;
}
const CAPEX_TXT = {
  pc5: ['PC5 parts list of 6 Oct 2026, cards from an online store, plus a A$1,089 system drive', 'Q'],
  pc5l: ['PC5 parts and drive, both RTX 5080 cards at the lowest local price', 'C'],
  pc5x: ['PC5 parts and drive with two RTX 5090 and a 1,600 W supply', 'C'],
  pc5p: ['PC5 parts and drive with one RTX PRO 6000', 'C'],
  pc5r: ['PC5 parts and drive with two Radeon AI PRO R9700', 'C'],
  wait: ['the same PC5 parts a year later, divided by any price fall', 'E'],
  swap: ['one RTX 5080 at the lowest local price', 'Q'],
};
const MULT_TXT = { '1+sw_gain': ['FP8 speed gain', 'E'], keep: ['kept after checks', 'M'] };
const multVal = (n, p) => (n === '1+sw_gain' ? 1 + p.sw_gain : p[n]);
function unitRows(model, ms, m, L, sid, e, ref, refName) {
  let h = '';
  for (const mm of ms) {
    const v = value(mm, e), vr = value(mm, L[ref]);
    if (v == null) continue;
    h += `<tr${mm.id === m.id ? ' class="hi"' : ''}><th scope="row">${esc(cap1(mm.unit))}</th><td class="w">${sid === ref ? (ref === 'base' ? 'baseline' : 'today, batched') : pct(v / vr - 1) + ' against ' + refName}</td><td class="n">${aud(v, precise)}</td></tr>`;
  }
  return h;
}
export function sheetHtml(model, p, res, g, lane, sid, mid, mode = 'fleet') {
  const r = model.lanes[lane][sid], e = res.lanes[lane][sid], L = res.lanes[lane], base = L.base;
  const ms = MEASURES[g], m = measureOf(g, mid), t = r.t, ref = refOf(g, t), refName = ref === 'sw' ? 'today, batched' : 'today';
  let note = [model.scen[sid][2], r.what].filter(Boolean).map(cap1).join('. ') + '.';
  if (sid === 'wait' && Math.abs(p.wait_gain - 1) < 1e-9) note += ' At the default (no price fall) it costs the same as PC5 as planned.';
  if (sid === 'm5') note += " The M5's hourly cost is its full cost per hour of use.";
  let h = `<div class="jc-sheet" data-sid="${sid}"><div class="jc-sh-head"><span class="jc-sh-t">${esc(longLabel(model, g, sid))}</span>${kindChip(r.k)}<span class="jc-type">${TYPE[t]}</span></div>`;
  h += `<p class="jc-sh-note">${esc(note)}</p><div class="jc-sh-grid">`;
  // 1. cost an hour, or the price
  const gst = `× ${num(1 + p.extra, 2)} GST and extras`;
  if (t === 'price') {
    const pair = r.api ? model.api[r.api] : [r.usd_in, r.usd_out];
    h += `<div class="jc-sh-block"><h4>Price</h4><table class="jc-mini"><thead><tr><th scope="col">Item</th><th scope="col">Working</th><th scope="col" class="n">A$ per million</th></tr></thead><tbody>`;
    h += `<tr><th scope="row">Output tokens ${kindChip(r.k)}</th><td class="w">US$${num(pair[1], 3)} × ${num(p.fx, 4)} A$ per US$ ${gst}${r.kept ? ` ÷ ${num(p.keep * 100, 0)}% kept` : ''}</td><td class="n">${aud(e.out, precise)}</td></tr>`;
    h += `<tr><th scope="row">Input tokens</th><td class="w">US$${num(pair[0], 4)} × ${num(p.fx, 4)} ${gst}</td><td class="n">${aud(e.in, precise)}</td></tr>`;
    h += `</tbody></table><p class="jc-note">No machine cost or electricity of mine: the price covers both. It includes ${num(p.extra * 100, 0)} percent GST and extras, but not storage while stopped or data transfer.${r.kept ? ' Kept tokens: the price is spread over the share kept after checks.' : ''}</p></div>`;
  } else {
    const dep = (1 - p.residual) / p.life, mon = p.money * (1 + p.residual) / 2, upk = p.upkeep, H = p.hours;
    h += `<div class="jc-sh-block"><h4>Cost an hour</h4><table class="jc-mini"><thead><tr><th scope="col">Item</th><th scope="col">Working</th><th scope="col" class="n">A$ an hour</th></tr></thead><tbody>`;
    if (t === 'own' || t === 'add') {
      let basis, bk;
      if (t === 'own') { basis = assetsText(model, r.assets, p); bk = 'E'; } else { [basis, bk] = CAPEX_TXT[r.cx] || [r.cx, 'Q']; if (r.cxs && r.cxs < 1) basis += ', half (one card of two)'; }
      h += `<tr><th scope="row">Machine cost ${kindChip(bk)}</th><td class="w">${esc(cap1(basis))}</td><td class="n">${aud(e.cost, (v) => num(v, 2))}</td></tr>`;
      h += `<tr><th scope="row">Depreciation</th><td class="w">to ${num(p.residual * 100, 0)}% resale over ${num(p.life, 0)} years, ${num(H, 0)} hours a year</td><td class="n">${aud(e.cost * dep / H, precise)}</td></tr>`;
      h += `<tr><th scope="row">Cost of money</th><td class="w">${num(p.money * 100, 0)}% a year on the average amount tied up</td><td class="n">${aud(e.cost * mon / H, precise)}</td></tr>`;
      h += `<tr><th scope="row">Upkeep</th><td class="w">${num(p.upkeep * 100, 0)}% of cost a year</td><td class="n">${aud(e.cost * upk / H, precise)}</td></tr>`;
      const tariff = r.alt ? p.alt_tariff_c : p.tariff_c;
      h += `<tr><th scope="row">Electricity ${kindChip(t === 'own' ? 'M' : r.k)}${kindChip(r.alt ? 'S' : 'O')}</th><td class="w">${trim(r.kw, 4)} kW × ${trim(tariff, 3)} cents a kWh${p.cooling > 0 ? ` × (1 + ${num(p.cooling * 100, 0)}% cooling)` : ''}</td><td class="n">${aud(e.rate_en, precise)}</td></tr>`;
    } else {
      h += `<tr><th scope="row">Rent ${kindChip('Q')}</th><td class="w">${r.n} × US$${num(model.rent[r.card], 3)} an hour × ${num(p.fx, 4)} A$ per US$ ${gst}</td><td class="n">${aud(e.rate_ext, precise)}</td></tr>`;
      h += `<tr><th scope="row">Electricity, machine cost</th><td class="w">in the rent</td><td class="n">A$0</td></tr>`;
    }
    h += `<tr class="tot"><th scope="row">Total an hour</th><td></td><td class="n">${aud(e.rate, precise)}</td></tr></tbody></table>`;
    if (t === 'own' || t === 'add') h += `<p class="jc-note">Machine cost an hour = cost × ${precise(fixedRate(p))} a year ÷ ${num(H, 0)} hours.</p>`;
    else h += `<p class="jc-note">The rent includes ${num(p.extra * 100, 0)} percent GST and extras, but not storage while stopped or data transfer.</p>`;
    h += '</div>';
  }
  // 2. speed and unit costs, both views for added capacity
  h += '<div class="jc-sh-block"><h4>Speed and unit costs</h4><table class="jc-mini"><tbody>';
  if (e.tps != null) {
    const ml = (r.mult || []).map((n) => ` × ${num(multVal(n, p), 2)} ${MULT_TXT[n][0]} ${kindChip(MULT_TXT[n][1])}`).join('');
    const what = g === 'datagen' ? 'kept tokens a second' : 'tokens a second';
    h += `<tr><th scope="row">Speed ${kindChip(r.k)}</th><td class="w">${num(r.tps, r.tps < 1000 ? 1 : 0)}${ml}</td><td class="n">${num(e.tps, e.tps < 1000 ? 1 : 0)} ${what}</td></tr>`;
    h += `<tr><th scope="row">An hour</th><td class="w">× 3,600 seconds</td><td class="n">${precise(e.tps * 3600 / 1e6)} million</td></tr>`;
    if (r.in) h += `<tr><th scope="row">Reading input</th><td class="w">prompt speed</td><td class="n">${num(r.in, 0)} tokens a second</td></tr>`;
  }
  if (e.fleet) {
    h += `<tr class="sub"><th scope="row" colspan="3">${esc(MODES.added)}</th></tr>` + unitRows(model, ms, m, L, sid, e, ref, refName);
    h += `<tr class="sub"><th scope="row" colspan="3">${esc(MODES.fleet)}: ${g === 'train' ? "today's machines" : "today's cards, batched"} plus this</th></tr>` + unitRows(model, ms, m, L, sid, pickRes(L, sid, 'fleet'), ref, refName);
  } else h += unitRows(model, ms, m, L, sid, e, ref, refName);
  if (g === 'train') {
    const size = lane === 'pretrain_1B' ? 1000 : 537, ee = mode === 'added' || !e.fleet ? e : e.fleet;
    h += `<tr><th scope="row">A compute optimal run</th><td class="w">${num(p.tpp, 0)} tokens per parameter, ${size === 1000 ? '1B' : '537M'} parameters${e.fleet ? (mode === 'added' ? ', added capacity' : ', whole lab') : ''}</td><td class="n">${aud(ee.per_mparam * size, (v) => num(v, 0))}</td></tr>`;
  }
  h += '</tbody></table></div>';
  // 3. bridge from today: to the whole lab after the change for added and rented capacity
  const br = bridgeSteps(model, res, g, lane, sid);
  if (br) {
    const f = m.input ? 1 : factor(m, p, e), unit = m.input ? (g === 'datagen' ? 'per million kept tokens' : 'per million tokens') : m.unit;
    const steps = [{ label: 'Today', v: br.from * f, total: true }];
    for (const [n, v] of br.parts) steps.push({ label: n, v: v * f, cls: PART_CLS[n] || '' });
    steps.push({ label: br.toFleet ? 'Whole lab after' : shortLabel(model, g, sid), v: br.to * f, total: true });
    h += `<div class="jc-sh-block jc-sh-wide"><h4>From today to ${br.toFleet ? 'the whole lab after the change' : 'this'}, A$ ${esc(unit)}</h4>${waterfall(steps, { caption: `Bridge from today to ${longLabel(model, g, sid)}`, fmt: precise })}`;
    if (m.input) h += '<p class="jc-note">The bridge is shown per output token; input tokens follow the same hourly cost.</p>';
    h += '</div>';
  }
  return h + '</div></div>';
}

/* ------------------------------------------------------------------ charts */
function niceCeil(v) {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v - 1e-12) return m * e;
  return 10 * e;
}
function niceStep(v) {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v - 1e-12) return m * e;
  return 10 * e;
}
const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
export const OR_SERIES = [
  ['base', "Today's machines", 'c1'], ['pc5', 'PC5 as planned (added)', 'c2'], ['pc5l', 'PC5 at the local price (added)', 'c3'],
  ['rent', 'Rent two RTX 5080 (flat)', 'c4'], ['h100', 'Rent an H100 (flat)', 'c5'],
];
export const OR_N = 172;
export function ownRentData(model, p) {
  const L = model.lanes.pretrain_537M, xs = [];
  for (let i = 0; i <= OR_N; i++) xs.push(200 + (8760 - 200) * i / OR_N);
  const S = OR_SERIES.map(([id, name, c]) => ({ id, name, c, y: xs.map((h) => evaluate(model, L[id], { ...p, hours: h }).out * 1000) }));
  const res = compute(model, p);
  return { xs, S, be: res.be_pc5, bel: res.be_pc5l, at: (h) => S.map((s) => evaluate(model, L[s.id], { ...p, hours: h }).out * 1000) };
}
export function ownRentSvg(model, p, W = 640) {
  const D = ownRentData(model, p), H = W < 520 ? 290 : 330, ml = 40, mr = 12, mt = 30, mb = 42;
  const pw = W - ml - mr, ph = H - mt - mb, x0 = 200, x1 = 8760;
  const flat = D.S[4].y[0], right = Math.max(...D.S.map((s) => s.y[s.y.length - 1]));
  const ymax = niceCeil(Math.max(2 * flat, 1.6 * right)), st = niceStep(ymax / 5);
  const X = (h) => ml + pw * (h - x0) / (x1 - x0), Y = (v) => mt + ph * (1 - v / ymax);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Line chart: A$ per billion tokens trained (537M model) against hours a year each machine works, for today's machines, PC5 as planned, PC5 at the local price, two rented RTX 5080 and a rented H100. The same numbers are in the table below." data-ymax="${ymax}">`;
  s += `<defs><clipPath id="jc-or-clip"><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}"/></clipPath></defs>`;
  for (let v = 0; v <= ymax + 1e-9; v += st) s += `<line class="gr" x1="${ml}" x2="${ml + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${ml - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${num(v, st < 1 ? 1 : 0)}</text>`;
  for (const h of [2000, 4000, 6000, 8000]) s += `<line class="ax" x1="${X(h).toFixed(1)}" x2="${X(h).toFixed(1)}" y1="${mt + ph}" y2="${mt + ph + 4}"/><text x="${X(h).toFixed(1)}" y="${mt + ph + 17}" text-anchor="middle">${num(h, 0)}</text>`;
  s += `<line class="ax" x1="${ml}" x2="${ml + pw}" y1="${mt + ph}" y2="${mt + ph}"/>`;
  s += `<text x="${ml}" y="14" text-anchor="start">A$ per billion tokens</text><text x="${ml + pw}" y="${H - 6}" text-anchor="end">hours a year each machine works</text>`;
  for (const [h, t, a, ty] of [[730, 'measured, about 730', 'start', mt + ph - 8], [7000, 'planned, 7,000', 'end', mt + 9]]) {
    const x = X(h);
    s += `<line class="mk" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${mt - 4}" y2="${mt + ph}"/><text class="mkt" x="${(x + (a === 'start' ? 5 : -5)).toFixed(1)}" y="${ty}" text-anchor="${a}">${t}</text>`;
  }
  s += `<g clip-path="url(#jc-or-clip)">`;
  for (const se of D.S) s += `<polyline class="ln ${se.c}${se.id === 'base' ? ' wide' : ''}" points="${pts(D.xs.map((h, i) => [X(h), Y(se.y[i])]))}"/>`;
  s += '</g>';
  // the flat rent lines carry their names at the right end
  for (const k of [3, 4]) { const yv = D.S[k].y[0]; if (yv < ymax) s += `<text class="mkt" x="${ml + pw - 4}" y="${(Y(yv) - 5).toFixed(1)}" text-anchor="end">${k === 3 ? 'Rent two RTX 5080' : 'Rent an H100'}</text>`; }
  for (const [be, c] of [[D.be, 'c2'], [D.bel, 'c3']]) if (be && be > x0 && be < x1) s += `<circle class="dot ring ${c}" cx="${X(be).toFixed(1)}" cy="${Y(D.S[3].y[0]).toFixed(1)}" r="5"/>`;
  s += `<g class="xh-g" style="display:none"><line class="xh" y1="${mt}" y2="${mt + ph}" x1="0" x2="0"/>${D.S.map((se) => `<circle class="dot ring ${se.c}" r="4.5" cx="0" cy="0"/>`).join('')}</g>`;
  s += `<rect class="hit" x="${ml}" y="${mt}" width="${pw}" height="${ph}"/>`;
  return s + '</svg>';
}
export function ownRentTable(model, p) {
  const D = ownRentData(model, p), hs = [730, 2000, 4000, 6000, 7000, 8760];
  let h = '<div class="tw"><table><thead><tr><th scope="col">Hours a year</th>' + D.S.map((s) => `<th scope="col" class="n">${esc(s.name)}</th>`).join('') + '</tr></thead><tbody>';
  for (const x of hs) h += `<tr><td>${num(x, 0)}${x === 730 ? ' (measured)' : x === 7000 ? ' (planned)' : ''}</td>` + D.at(x).map((v) => `<td class="n">${aud(v)}</td>`).join('') + '</tr>';
  return h + '</tbody></table></div>';
}
export function ownRentChips(model, p) {
  const res = compute(model, p), y = (b) => (b ? `${num(b, 0)} hours (${num(100 * b / 8760, 0)} percent of the year)` : 'never');
  return `<span class="jc-chip">PC5 as planned beats renting the same cards above <b>${y(res.be_pc5)}</b></span>` +
    `<span class="jc-chip">PC5 at the local price: above <b>${y(res.be_pc5l)}</b></span>`;
}
export const BIG_SERIES = [['today', 'c1', 'o'], ['merge', 'c3', 's'], ['pc5merge', 'c2', 'd'], ['pro', 'c6', 't'], ['h100', 'c5', 'x']];
export const SIZES_B = ['0.537', '1', '2', '3'];
export const SIZE_NAME = { '0.537': '537M', 1: '1B', 2: '2B', 3: '3B' };
function marker(shape, cx, cy, c, r = 4.5) {
  const a = (x) => x.toFixed(1);
  if (shape === 's') return `<rect class="dot ring ${c}" x="${a(cx - r)}" y="${a(cy - r)}" width="${a(2 * r)}" height="${a(2 * r)}"/>`;
  if (shape === 'd') return `<path class="dot ring ${c}" d="M${a(cx)} ${a(cy - r - 1)}L${a(cx + r + 1)} ${a(cy)}L${a(cx)} ${a(cy + r + 1)}L${a(cx - r - 1)} ${a(cy)}Z"/>`;
  if (shape === 't') return `<path class="dot ring ${c}" d="M${a(cx)} ${a(cy - r - 1)}L${a(cx + r + 1)} ${a(cy + r)}L${a(cx - r - 1)} ${a(cy + r)}Z"/>`;
  if (shape === 'x') { const k = r * 0.95; return `<path class="dot ring ${c}" d="M${a(cx - k)} ${a(cy - k)}L${a(cx + k)} ${a(cy + k)}M${a(cx + k)} ${a(cy - k)}L${a(cx - k)} ${a(cy + k)}" style="stroke:var(--c);stroke-width:2.6"/>`; }
  return `<circle class="dot ring ${c}" cx="${a(cx)}" cy="${a(cy)}" r="${r}"/>`;
}
export function legendHtml(items) {
  return '<ul class="jc-legend">' + items.map(([name, c, shape]) => `<li class="${c}"><svg viewBox="0 0 26 12" aria-hidden="true"><path d="M1 6h24"/>${shape ? marker(shape, 13, 6, c, 3.5) : ''}</svg>${esc(name)}</li>`).join('') + '</ul>';
}
export function bigSvg(model, p, res, W = 640) {
  const H = W < 520 ? 280 : 310, ml = 40, mr = 16, mt = 28, mb = 40, pw = W - ml - mr, ph = H - mt - mb;
  const all = BIG_SERIES.flatMap(([id]) => SIZES_B.map((s) => res.big[id][s].per_mparam));
  const ymax = niceCeil(1.1 * Math.max(...all)), st = niceStep(ymax / 5);
  const X = (b) => ml + pw * (b - 0.3) / (3.15 - 0.3), Y = (v) => mt + ph * (1 - v / ymax);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Line chart: A$ per million parameters for compute optimal runs of 537M, 1B, 2B and 3B models, for today's machines, the split and offload merge, PC5 with the merge, one RTX PRO 6000 build and a rented H100. The same numbers are in the table below.">`;
  for (let v = 0; v <= ymax + 1e-9; v += st) s += `<line class="gr" x1="${ml}" x2="${ml + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${ml - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${num(v, st < 0.1 ? 2 : st < 1 ? 1 : 0)}</text>`;
  for (const sz of SIZES_B) s += `<line class="ax" x1="${X(+sz).toFixed(1)}" x2="${X(+sz).toFixed(1)}" y1="${mt + ph}" y2="${mt + ph + 4}"/><text x="${X(+sz).toFixed(1)}" y="${mt + ph + 17}" text-anchor="middle">${SIZE_NAME[sz]}</text>`;
  s += `<line class="ax" x1="${ml}" x2="${ml + pw}" y1="${mt + ph}" y2="${mt + ph}"/>`;
  s += `<text x="${ml}" y="14">A$ per million parameters</text><text x="${ml + pw}" y="${H - 6}" text-anchor="end">model size, parameters</text>`;
  for (const [id, c] of BIG_SERIES) s += `<polyline class="ln ${c}" points="${pts(SIZES_B.map((sz) => [X(+sz), Y(res.big[id][sz].per_mparam)]))}"/>`;
  for (const [id, c, sh] of BIG_SERIES) for (const sz of SIZES_B) s += marker(sh, X(+sz), Y(res.big[id][sz].per_mparam), c);
  s += `<g class="xh-g" style="display:none"><line class="xh" y1="${mt}" y2="${mt + ph}" x1="0" x2="0"/></g>`;
  s += `<rect class="hit" x="${ml}" y="${mt}" width="${pw}" height="${ph}" data-x="${SIZES_B.map((sz) => X(+sz).toFixed(1)).join(',')}"/>`;
  return s + '</svg>';
}
export function bigTable(model, res) {
  let h = '<div class="tw"><table><thead><tr><th scope="col">Compute optimal run</th>' + SIZES_B.map((s) => `<th scope="col" class="n">${SIZE_NAME[s]}</th>`).join('') + '</tr></thead><tbody>';
  for (const [id] of BIG_SERIES) {
    h += `<tr><td>${esc(model.big[id].label)}</td>` + SIZES_B.map((s) => {
      const e = res.big[id][s];
      return `<td class="n">${aud(e.run_cost, (v) => num(v, 0))}<br><span class="muted">${num(e.run_days, e.run_days < 10 ? 1 : 0)} days</span></td>`;
    }).join('') + '</tr>';
  }
  return h + '</tbody></table></div>';
}

/* ------------------------------------------------------------------ what the 3D view needs */
export function factoryInfo(model, p, res, g, lane, sid, mid, mode = 'fleet') {
  const r = model.lanes[lane][sid], L = res.lanes[lane], e = pickRes(L, sid, mode), m = measureOf(g, mid);
  const fleet = mode !== 'added', ref = refOf(g, r.t);
  const split = (list, kw, tps) => { const n = list.reduce((a, x) => a + x.on, 0) || 1; list.forEach((x) => { x.kw = kw * x.on / n; x.tps = tps * x.on / n; }); return list; };
  const today = () => (g === 'inference' ? [{ id: 'pc1', name: 'Server 1', cards: 2, on: 1 }] : [{ id: 'pc1', name: 'Server 1', cards: 2, on: 2 }, { id: 'pc2', name: 'Server 2', cards: 1, on: 1 }]);
  const todayRun = () => split(today(), model.lanes[lane][ref].kw || 0, L[ref].tps || 0);
  const todayDim = () => today().map((x) => ({ ...x, dim: true, kw: 0, tps: 0 }));
  let machines = [], cloud = null, api = false;
  if (r.t === 'own') {
    machines = split(r.assets.map(([a, s]) => (a === 'pc1' ? { id: 'pc1', name: 'Server 1', cards: 2, on: s < 1 ? 1 : 2 } : a === 'pc2' ? { id: 'pc2', name: 'Server 2', cards: 1, on: 1 } : { id: 'm5', name: 'M5 Max laptop', cards: 1, on: 1, laptop: true })), r.kw, L[sid].tps);
  } else if (r.t === 'add') {
    machines = fleet ? todayRun() : todayDim();
    const fresh = sid === 'swap' ? { id: 'pc3', name: 'Storage server', cards: 2, on: 1, swap: true } : { id: 'pc5', name: 'PC5', cards: sid === 'pc5p' ? 1 : 2, on: sid === 'pc5p' ? 1 : (r.cxs && r.cxs < 1 ? 1 : 2) };
    fresh.kw = r.kw; fresh.tps = L[sid].tps; machines.push(fresh);
  } else if (r.t === 'rent' || sid === 'h100') {
    machines = fleet && r.t === 'rent' ? todayRun() : todayDim();
    cloud = { n: r.n || 1, card: r.card === 'h100' || sid === 'h100' ? 'H100' : r.card === '5090' ? 'RTX 5090' : 'RTX 5080', tps: L[sid].tps };
  } else {
    machines = todayDim(); api = true;
  }
  const v = value(m, e);
  return { sid, type: r.t, name: longLabel(model, g, sid) + (L[sid].fleet ? (fleet ? ': whole lab after' : ': added capacity only') : ''), machines, cloud, api, unit: `${aud(v)} ${m.unit}` };
}
export function threeState(model, p, res, g, lane, mid, sel, mode) {
  const R = rowsData(model, p, res, g, lane, mid, mode);
  return { lane, g, mode, unit: R.m.unit, rows: R.rows, max: R.max, base: R.base, sel, fmt: (v) => aud(v), factory: factoryInfo(model, p, res, g, lane, sel, mid, mode), tip: (x) => rowTip(model, R, x) };
}

/* ------------------------------------------------------------------ the page, in the browser */
if (typeof document !== 'undefined' && document.getElementById('jc-model')) start();

function start() {
  const d = document, $ = (id) => d.getElementById(id);
  const model = JSON.parse($('jc-model').textContent);
  const DEF = { ...model.params };
  const S = { p: { ...DEF }, g: 'train', size: '537M', mid: { train: 'btok', datagen: 'mtok', inference: 'mtok' }, sel: {}, open: {}, view: 'landscape', mode: 'fleet' };
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let res = compute(model, S.p);
  const app = $('jc-app');
  app.classList.add('jc-js');
  const lane = () => laneOf(S.g, S.size);
  const selOf = (ln) => S.sel[ln] || 'base';

  /* tooltip (layer 2), shared */
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.style.display = 'block';
    const w = tip.offsetWidth, hh = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
    const left = Math.min(Math.max(8, x + 14), vw - w - 8); let top = y + 16; if (top + hh > vh - 8) top = Math.max(8, y - hh - 12);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.style.display = 'none'; };
  addEventListener('scroll', hideTip, { passive: true });
  const tipHtml = (o) => `<b>${esc(o.title)}</b>${o.value ? `<div>${esc(o.value)}</div>` : ''}${o.lines && o.lines.length ? '<ul>' + o.lines.map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>' : ''}${o.hint ? `<div class="muted">${esc(o.hint)}</div>` : ''}`;
  function hoverTip(el, html) {
    el.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') showTip(html(), ev.clientX, ev.clientY); });
    el.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') showTip(html(), ev.clientX, ev.clientY); });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(html(), r.left + 16, r.bottom - 6); });
    el.addEventListener('blur', hideTip);
  }
  d.querySelectorAll('.jc-glance a[title], [data-tip]').forEach((el) => {
    if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
    hoverTip(el, () => tipHtml({ title: el.dataset.tipTitle || el.querySelector('b')?.textContent || '', hint: el.dataset.tip }));
  });
  // chips that open a job cost sheet
  d.querySelectorAll('.jc-glance a[data-open]').forEach((a) => a.addEventListener('click', (ev) => {
    const [ln, sid, mid] = a.dataset.open.split(':');
    const g = groupOf(ln); S.g = g; if (g === 'train') S.size = ln === 'pretrain_1B' ? '1B' : '537M'; if (mid) S.mid[g] = mid;
    S.sel[ln] = sid; S.open[ln] = [sid]; syncSwitches(); buildAll();
    ev.preventDefault(); hideTip();
    const row = d.querySelector(`#jc-lists .jc-row[data-sid="${sid}"]`);
    (row || $('cost')).scrollIntoView({ block: 'start', behavior: reduceMQ.matches ? 'auto' : 'smooth' });
  }));

  /* lane tabs: sideways scroll only, never moves the page */
  const tabs = [...d.querySelectorAll('#jc-tabs [role="tab"]')];
  const tablist = $('jc-tabs');
  function keepTabVisible(t) {
    const L = tablist.scrollLeft, W = tablist.clientWidth, a = t.offsetLeft - tablist.offsetLeft, b = a + t.offsetWidth;
    if (a < L) tablist.scrollTo({ left: a - 8 }); else if (b > L + W) tablist.scrollTo({ left: b - W + 8 });
  }
  function selectTab(t, focus) {
    S.g = t.dataset.g; syncSwitches(); buildAll();
    if (focus) t.focus({ preventScroll: true });
    keepTabVisible(t);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t, false));
    t.addEventListener('keydown', (ev) => {
      let j = null;
      if (ev.key === 'ArrowRight') j = (i + 1) % tabs.length; else if (ev.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = tabs.length - 1;
      if (j != null) { ev.preventDefault(); selectTab(tabs[j], true); }
    });
  });
  const seg = (id, fn) => $(id).addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) fn(b); });
  seg('jc-size', (b) => { S.size = b.dataset.size; syncSwitches(); buildAll(); });
  seg('jc-measure', (b) => { S.mid[S.g] = b.dataset.m; syncSwitches(); buildAll(); });
  seg('jc-mode', (b) => { S.mode = b.dataset.mode; syncSwitches(); buildAll(); });
  seg('jc-use', (b) => { S.p.hours = +b.dataset.h; syncControls(); refresh(); });
  seg('jc-basis', (b) => { S.p.basis = +b.dataset.b; syncControls(); refresh(); });
  function syncSwitches() {
    tabs.forEach((t) => { const on = t.dataset.g === S.g; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    $('jc-panel').setAttribute('aria-labelledby', 'jc-tab-' + S.g);
    $('jc-size-g').hidden = S.g !== 'train';
    $('jc-size').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === S.size)));
    $('jc-mode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    const ms = MEASURES[S.g], cur = measureOf(S.g, S.mid[S.g]).id;
    $('jc-measure').innerHTML = ms.map((m) => `<button type="button" data-m="${m.id}" aria-pressed="${m.id === cur}">${esc(m.name)}</button>`).join('');
    d.querySelectorAll('.jc-lanenote').forEach((u) => { u.hidden = u.dataset.g !== S.g; });
  }

  /* controls */
  const ctlKeys = ['tariff_c', 'hours', 'life', 'residual', 'cooling', 'money', 'upkeep', 'sw_gain', 'wait_gain', 'fx', 'extra'];
  const show = {
    tariff_c: (v) => `${num(v, 2)} c`, hours: (v) => `${num(v, 0)} h`, life: (v) => `${num(v, 0)} years`, residual: (v) => `${num(v * 100, 0)}%`,
    cooling: (v) => `${num(v * 100, 0)}%`, money: (v) => `${num(v * 100, 0)}%`, upkeep: (v) => `${num(v * 100, 0)}%`, sw_gain: (v) => `+${num(v * 100, 0)}%`,
    wait_gain: (v) => `${num(v, 2)} times`, fx: (v) => `A$${num(v, 4)}`, extra: (v) => `+${num(v * 100, 0)}%`,
  };
  let pending = false;
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; refresh(); }); } }
  for (const k of ctlKeys) {
    const inp = $('jc-' + k); if (!inp) continue;
    inp.addEventListener('input', () => { S.p[k] = parseFloat(inp.value); $('jc-o-' + k).textContent = show[k](S.p[k]); syncUse(); schedule(); });
  }
  function syncUse() {
    $('jc-use').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.h === S.p.hours)));
    $('jc-basis').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.b === (S.p.basis >= 0.5 ? 1 : 0))));
  }
  function syncControls() {
    for (const k of ctlKeys) { const inp = $('jc-' + k); if (!inp) continue; inp.value = String(S.p[k]); $('jc-o-' + k).textContent = show[k](S.p[k]); }
    syncUse();
  }
  $('jc-reset').addEventListener('click', () => { S.p = { ...DEF }; syncControls(); refresh(); });

  /* the list, its sheets and the 3D view */
  const lists = $('jc-lists');
  const sheetFor = (ln, sid) => sheetHtml(model, S.p, res, S.g, ln, sid, S.mid[S.g], S.mode);
  function buildList() {
    const ln = lane(), open = S.open[ln] || [];
    lists.innerHTML = listHtml(model, S.p, res, S.g, ln, S.mid[S.g], { open, sel: selOf(ln), mode: S.mode });
    lists.querySelectorAll('.jc-row').forEach((li) => {
      const det = li.querySelector('details'), sid = li.dataset.sid;
      if (det.open) det.querySelector('.jc-r-body').innerHTML = sheetFor(ln, sid);
      det.addEventListener('toggle', () => {
        const o = new Set(S.open[ln] || []);
        if (det.open) { o.add(sid); det.querySelector('.jc-r-body').innerHTML = sheetFor(ln, sid); select(sid, false); hideTip(); } else o.delete(sid);
        S.open[ln] = [...o];
      });
      hoverTip(det.querySelector('summary'), () => { const R = rowsData(model, S.p, res, S.g, ln, S.mid[S.g], S.mode); return tipHtml(rowTip(model, R, R.rows.find((x) => x.sid === sid))); });
    });
  }
  function updateList() {
    const ln = lane(), R = rowsData(model, S.p, res, S.g, ln, S.mid[S.g], S.mode);
    lists.querySelectorAll('.jc-row').forEach((li) => {
      const x = R.rows.find((r) => r.sid === li.dataset.sid); if (!x) return;
      updateRowHtml(li, x, R);
      const det = li.querySelector('details');
      if (det.open) det.querySelector('.jc-r-body').innerHTML = sheetFor(ln, x.sid);
    });
  }
  function select(sid, fromStage) {
    const ln = lane(); S.sel[ln] = sid;
    lists.querySelectorAll('.jc-row').forEach((li) => li.classList.toggle('is-sel', li.dataset.sid === sid));
    const pick = $('jc-pick-s'); if (pick && pick.value !== sid) pick.value = sid;
    if (fromStage) {
      const li = lists.querySelector(`.jc-row[data-sid="${sid}"]`);
      if (li) {
        const det = li.querySelector('details');
        if (!det.open) det.open = true;
        const r = li.getBoundingClientRect();
        if (r.top > innerHeight - 60 || r.bottom < 60) li.scrollIntoView({ block: 'nearest', behavior: reduceMQ.matches ? 'auto' : 'smooth' });
      }
    }
    push3d();
  }
  function fillPicker() {
    const sel = $('jc-pick-s'), ln = lane();
    sel.innerHTML = Object.keys(model.lanes[ln]).map((sid) => `<option value="${sid}">${esc(longLabel(model, S.g, sid))}</option>`).join('');
    sel.value = selOf(ln);
  }
  $('jc-pick-s').addEventListener('change', (ev) => select(ev.target.value, false));

  /* charts */
  const orBox = $('jc-or-chart'), bigBox = $('jc-big-chart');
  const chartW = (box) => Math.max(300, Math.round(box.clientWidth - 16));
  function drawCharts() {
    orBox.querySelector('.jc-svg').innerHTML = ownRentSvg(model, S.p, chartW(orBox));
    $('jc-or-table').innerHTML = ownRentTable(model, S.p);
    $('jc-or-chips').innerHTML = ownRentChips(model, S.p);
    bigBox.querySelector('.jc-svg').innerHTML = bigSvg(model, S.p, res, chartW(bigBox));
    $('jc-big-table').innerHTML = bigTable(model, res);
  }
  function chartHover(box, kind) {
    const tipEl = box.querySelector('.jc-tip-chart');
    let idx = null;
    const svgX = (clientX) => { const svg = box.querySelector('svg'), r = svg.getBoundingClientRect(); return (clientX - r.left) * svg.viewBox.baseVal.width / r.width; };
    function render(i, clientY) {
      const svg = box.querySelector('svg'); if (!svg) return;
      const g = svg.querySelector('.xh-g'), hit = svg.querySelector('.hit');
      const hx = +hit.getAttribute('x'), hw = +hit.getAttribute('width'), top = +hit.getAttribute('y'), ph = +hit.getAttribute('height');
      let html, px;
      if (kind === 'or') {
        const D = ownRentData(model, S.p), h = D.xs[i], ymax = +svg.getAttribute('data-ymax');
        px = hx + hw * (h - 200) / (8760 - 200);
        const vals = D.S.map((s) => s.y[i]);
        g.querySelectorAll('circle').forEach((c, k) => { c.setAttribute('cx', px.toFixed(1)); c.setAttribute('cy', (top + ph * (1 - Math.min(vals[k], ymax) / ymax)).toFixed(1)); c.style.display = vals[k] > ymax ? 'none' : ''; });
        html = `<b>${num(h, 0)} hours a year (${num(100 * h / 8760, 0)}% of the year)</b><ul>` + D.S.map((s, k) => `<li class="${s.c}"><i></i><strong>${aud(vals[k])}</strong> ${esc(s.name)}</li>`).join('') + '</ul>';
      } else {
        const xs = hit.dataset.x.split(',').map(Number), sz = SIZES_B[i]; px = xs[i];
        html = `<b>${SIZE_NAME[sz]} parameters, a compute optimal run</b><ul>` + BIG_SERIES.map(([id, c]) => { const e = res.big[id][sz]; return `<li class="${c}"><i></i><strong>${aud(e.per_mparam, (v) => num(v, 3))}</strong> per million, ${num(e.run_days, e.run_days < 10 ? 1 : 0)} days: ${esc(model.big[id].label)}</li>`; }).join('') + '</ul>';
      }
      g.style.display = ''; g.querySelector('line').setAttribute('x1', px.toFixed(1)); g.querySelector('line').setAttribute('x2', px.toFixed(1));
      tipEl.innerHTML = html; tipEl.hidden = false;
      const br = box.getBoundingClientRect(), sr = svg.getBoundingClientRect(), scale = sr.width / svg.viewBox.baseVal.width;
      const ax = sr.left - br.left + px * scale, tw = tipEl.offsetWidth;
      const left = ax + 14 + tw > br.width ? ax - 14 - tw : ax + 14;
      tipEl.style.transform = `translate(${Math.max(4, left).toFixed(0)}px,${Math.max(4, clientY != null ? clientY - br.top - 30 : 30).toFixed(0)}px)`;
    }
    function nearest(clientX) {
      const svg = box.querySelector('svg'); if (!svg) return null;
      const hit = svg.querySelector('.hit'), x = svgX(clientX), hx = +hit.getAttribute('x'), hw = +hit.getAttribute('width');
      if (kind === 'or') return Math.max(0, Math.min(OR_N, Math.round((x - hx) / hw * OR_N)));
      const xs = hit.dataset.x.split(',').map(Number);
      let best = 0; xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i; }); return best;
    }
    const hide = () => { tipEl.hidden = true; const g = box.querySelector('.xh-g'); if (g) g.style.display = 'none'; };
    const home = () => (kind === 'or' ? Math.round(OR_N * (7000 - 200) / 8560) : 0);
    box.addEventListener('pointermove', (ev) => { const i = nearest(ev.clientX); if (i == null) return; idx = i; render(i, ev.clientY); });
    box.addEventListener('pointerleave', hide);
    box.addEventListener('keydown', (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(ev.key)) return;
      ev.preventDefault();
      if (ev.key === 'Escape') { hide(); return; }
      const n = kind === 'or' ? OR_N : SIZES_B.length - 1, step = kind === 'or' ? (ev.shiftKey ? 20 : 4) : 1;
      if (idx == null) idx = home();
      idx = ev.key === 'Home' ? 0 : ev.key === 'End' ? n : Math.max(0, Math.min(n, idx + (ev.key === 'ArrowRight' ? step : -step)));
      render(idx, null);
    });
    box.addEventListener('focus', () => { if (idx == null) idx = home(); render(idx, null); });
    box.addEventListener('blur', hide);
  }
  chartHover(orBox, 'or'); chartHover(bigBox, 'big');
  let lastW = 0;
  new ResizeObserver(() => { const w = orBox.clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; drawCharts(); } }).observe(orBox);

  /* 3D: loaded only when its section comes near the screen */
  let three = null;
  const stage = $('jc-stage');
  function push3d() { if (three) three.update(threeState(model, S.p, res, S.g, lane(), S.mid[S.g], selOf(lane()), S.mode)); }
  function load3d() {
    import('./job-costing-3d.js').then((mod) => {
      three = mod.init({ stage, canvas: $('jc-canvas'), labels: $('jc-labs'), tip: $('jc-3tip'), onPick: (sid) => select(sid, true) });
      if (!three) { app.classList.add('jc-no3d'); return; }
      app.classList.add('jc-3d');
      three.setView(S.view); push3d();
      if (pauseBtn.getAttribute('aria-pressed') === 'true') three.setPaused(true);
    }).catch(() => { app.classList.add('jc-no3d'); });
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); load3d(); } }, { rootMargin: '400px' });
    io.observe($('cost'));
  } else load3d();
  const viewBtns = [...d.querySelectorAll('#jc-views button')];
  viewBtns.forEach((b) => b.addEventListener('click', () => {
    S.view = b.dataset.view; viewBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    stage.classList.toggle('jc-view-factory', S.view === 'factory');
    if (three) three.setView(S.view);
  }));
  const pauseBtn = $('jc-pause');
  pauseBtn.addEventListener('click', () => {
    const on = pauseBtn.getAttribute('aria-pressed') !== 'true';
    pauseBtn.setAttribute('aria-pressed', String(on)); pauseBtn.querySelector('span').textContent = on ? 'Play' : 'Pause';
    if (three) three.setPaused(on);
  });
  if (reduceMQ.matches) { pauseBtn.setAttribute('aria-pressed', 'true'); pauseBtn.querySelector('span').textContent = 'Play'; }
  $('jc-resetview').addEventListener('click', () => { if (three) three.reset(); });

  function buildAll() { res = compute(model, S.p); buildList(); fillPicker(); push3d(); }
  function refresh() {
    res = compute(model, S.p); updateList(); drawCharts(); push3d();
    $('jc-dirty').hidden = !Object.keys(DEF).some((k) => Math.abs(S.p[k] - DEF[k]) > 1e-9);
  }
  syncSwitches(); syncControls(); buildAll(); drawCharts();
  window.__jc = { S, model, get res() { return res; }, get three() { return three; } };
}
