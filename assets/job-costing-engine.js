// Job costing engine. Plain ES module, no build step, no outside requests.
// The same formulas as model.py (the canonical Python version); test_engine.mjs checks that both agree.
// Kinds: M measured on the lab, O my own record, Q a seller's price, S a published figure, E an estimate, C computed.

export function fixedRate(p) {
  // A$ a year for each A$1 of machine cost: depreciation down to the resale value, cost of money on the average, upkeep
  return (1 - p.residual) / p.life + p.money * (1 + p.residual) / 2 + p.upkeep;
}

function mult(names, p) {
  let m = 1;
  for (const n of names || []) m *= n === '1+sw_gain' ? 1 + p.sw_gain : p[n];
  return m;
}

function assetCost(model, a, p) {
  const A = model.assets[a];
  return p.basis >= 0.5 ? A.resale : A.cost;   // 1: what today's machines would sell for; 0: replacement cost new
}

export function evaluate(model, r, p) {
  if (r.t === 'price') {
    const pair = r.api ? model.api[r.api] : [r.usd_in, r.usd_out];
    const out = pair[1] * p.fx * (1 + p.extra) / (r.kept ? p.keep : 1);
    return { out, in: pair[0] * p.fx * (1 + p.extra), cap: 0, en: 0, ext: out, rate: null, tps: null, rate_cap: 0, rate_en: 0, rate_ext: 0, cost: 0 };
  }
  const fr = fixedRate(p);
  const tariff = r.alt ? p.alt_tariff_c : p.tariff_c;
  let cost = 0;
  if (r.t === 'own') for (const [a, s] of r.assets) cost += assetCost(model, a, p) * s;
  if (r.cx) cost += model.capex[r.cx] * (r.cxs == null ? 1 : r.cxs) / (r.cxdiv ? p[r.cxdiv] : 1);
  let capH = 0, enH = 0, extH = 0;
  if (r.t === 'own' || r.t === 'add') {
    capH = cost * fr / p.hours;
    enH = r.kw * tariff / 100 * (1 + p.cooling);
  } else {
    extH = model.rent[r.card] * r.n * p.fx * (1 + p.extra);
  }
  const tps = r.tps * mult(r.mult, p);
  const mtph = tps * 3600 / 1e6;
  const rate = capH + enH + extH;
  const res = { out: rate / mtph, cap: capH / mtph, en: enH / mtph, ext: extH / mtph, rate,
    rate_cap: capH, rate_en: enH, rate_ext: extH, tps, cost };
  res.in = r.in ? rate / (r.in * mult(r.inmult, p) * 3600 / 1e6) : null;
  return res;
}

// The whole lab after a change: hourly costs and speeds added together.
export function combine(a, b) {
  const rc = a.rate_cap + b.rate_cap, re = a.rate_en + b.rate_en, rx = a.rate_ext + b.rate_ext;
  const tps = a.tps + b.tps, mtph = tps * 3600 / 1e6, rate = rc + re + rx;
  return { out: rate / mtph, cap: rc / mtph, en: re / mtph, ext: rx / mtph, rate, rate_cap: rc, rate_en: re, rate_ext: rx, tps };
}

export function compute(model, p) {
  const out = { lanes: {}, big: {} };
  for (const [lane, rs] of Object.entries(model.lanes)) {
    const L = out.lanes[lane] = {};
    for (const [sid, r] of Object.entries(rs)) {
      const e = evaluate(model, r, p);
      e.words = e.out / p.wpt;
      if (lane.startsWith('pretrain')) e.per_mparam = e.out * p.tpp;
      L[sid] = e;
    }
    // added capacity sits beside the reference: today's machines for training, today's machines batched otherwise
    const ref = L[lane.startsWith('pretrain') ? 'base' : 'sw'];
    for (const [sid, r] of Object.entries(rs)) {
      const e = L[sid];
      if (r.t === 'add' || r.t === 'rent') {
        const f = combine(ref, e);
        f.words = f.out / p.wpt;
        if (lane.startsWith('pretrain')) f.per_mparam = f.out * p.tpp;
        e.fleet = f;
      } else e.fleet = null;
    }
  }
  for (const [bid, b] of Object.entries(model.big)) {
    out.big[bid] = {};
    for (const [s, r] of Object.entries(b.rows)) {
      const e = evaluate(model, r, p);
      const n = parseFloat(s) * 1e9;
      e.per_mparam = e.out * p.tpp;
      e.run_cost = e.out * p.tpp * n / 1e6;
      e.run_days = p.tpp * n / e.tps / 86400;
      out.big[bid][s] = e;
    }
  }
  const fr = fixedRate(p);
  for (const cx of ['pc5', 'pc5l']) {
    const fixedYear = model.capex[cx] * fr;
    const enH = 0.8226 * p.tariff_c / 100 * (1 + p.cooling);
    const rentH = 2 * model.rent['5080'] * p.fx * (1 + p.extra);
    out['be_' + cx] = rentH > enH ? fixedYear / (rentH - enH) : null;
  }
  return out;
}

// Bridge from one result to another (A$ per million output tokens): capital, electricity, rent or API price, and speed.
// Order of substitution: the hourly cost parts at the new speed first, then the speed change at the old hourly cost.
export function bridge(from, to) {
  if (to.rate == null || from.rate == null) {
    // an API price has no hours: take away the owned costs, add the price
    return [['Machine cost', -from.cap], ['Electricity', -from.en], ['Rent', -from.ext], ['API price', to.out]];
  }
  const mt = to.tps * 3600 / 1e6, mf = from.tps * 3600 / 1e6;
  return [
    ['Machine cost', (to.rate_cap - from.rate_cap) / mt],
    ['Electricity', (to.rate_en - from.rate_en) / mt],
    ['Rent', (to.rate_ext - from.rate_ext) / mt],
    ['Speed', from.rate * (1 / mt - 1 / mf)],
  ];
}
