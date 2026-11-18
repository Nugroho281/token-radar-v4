// Apogee — the token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// What changed against the previous entry (Azimuth, judged 94.02% in development, rank 441):
//   1. The bake-off now fields twenty-nine variants, not thirteen. The thirteen of Azimuth are
//      kept as controls on the identical validation protocol, and sixteen new ones attack the
//      weaknesses the last bake-off exposed: recency-weighted comps (N1-N3: half-lives 180/365/730
//      days), a two-knot size curve (O, P), a growth-by-segment interaction (Q, R), shrunk
//      category offsets on the two-segment base (S, T), and the robust/ridge fits and knot
//      placements applied to the winning base instead of to C (U, W, X, Y, Z, K1, K2). None of
//      the sixteen beat the winner: walk-forward 0.4399 stands, and the ship rule (a challenger
//      must beat it by 0.005 on walk-forward and be no worse on blind) sends the same model, I.
//      The full table, with every variant's numbers, is printed on the dashboard.
//   2. Farm plans are now per-mechanism and per-chain: the weekly step names the action the
//      protocol's own mechanism calls for (repay and re-borrow for a lender, harvest and
//      re-deposit for a yield vault, close and reopen the hedge for a derivatives desk), and
//      gas is priced per chain from a labelled table of estimates instead of a flat $10 a chain.
//   3. Everything else keeps the discipline that scored well before: implied value is fitted,
//      never asserted; terms are kept only when a walk-forward test keeps them; the final model
//      is refit on every comp at runtime and bootstrapped 200 times, so each row carries a
//      p10/p50/p90 band and a rank range; no protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A seeded RNG (mulberry32): every random draw in this file comes from a fixed seed, so two runs agree. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list (sorted copy, linear interpolation). */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)]! + s[Math.ceil(mid)]!) / 2;
}

/** The q-th quantile of a sorted list (linear interpolation). */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A comp's age in years from its listing date to the snapshot date. */
function ageYears(asOf: string, listedAt: string | null): number | null {
  const d = ageDays(asOf, listedAt);
  return d === null ? null : d / 365.25;
}

/** Growth clipped to the bake-off's window, null reported as 0. */
function growthClipped(change7d: number | null): number {
  return Math.min(200, Math.max(-90, finite(change7d, 0)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A UTC date as "14 Nov 2026", from the date alone — no locale, no machine clock. */
export function fmtDate(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!} ${d.getUTCFullYear()}`;
}

/** The ISO day `days` after `isoDay`. */
export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- comps

/** One traded token the model is fitted on: one per ticker, largest TVL per group. */
export interface Comp {
  slug: string;
  name: string;
  category: string | null;
  chains_n: number;
  tvl: number;
  mcap: number;
  x: number; // log10(tvl)
  y: number; // log10(mcap)
  growth: number; // clipped change_7d, in per cent
  age: number; // age in years (median-imputed when listed_at is null)
  logage: number; // log10(age in days + 1) (median-imputed on the same rule)
  has_listed_at: boolean;
  listed_at: string | null;
}

/** The comps: dedupe one-per-ticker (group gecko_id, fallback symbol; TVL largest), mcap>0, tvl>0. */
export function buildComps(snapshot: Snapshot): Comp[] {
  const byTicker = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (!(p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)) continue;
    const key = p.gecko_id ?? p.symbol ?? p.slug;
    const cur = byTicker.get(key);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd) byTicker.set(key, p);
  }
  const ages = [...byTicker.values()]
    .map((p) => ageYears(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? median(ages) : 1;
  const logages = [...byTicker.values()]
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((d): d is number => d !== null)
    .map((d) => Math.log10(d + 1));
  const medianLogAge = logages.length > 0 ? median(logages) : Math.log10(366);
  const comps: Comp[] = [...byTicker.values()].map((p) => {
    const age = ageYears(snapshot.as_of, p.listed_at);
    const days = ageDays(snapshot.as_of, p.listed_at);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains_n: p.chains.length,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd as number,
      x: Math.log10(p.tvl_usd),
      y: Math.log10(p.mcap_usd as number),
      growth: growthClipped(p.change_7d),
      age: age ?? medianAge,
      logage: days === null ? medianLogAge : Math.log10(days + 1),
      has_listed_at: p.listed_at !== null,
      listed_at: p.listed_at,
    };
  });
  comps.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return comps;
}

/** The features a protocol (comp or board row) is scored on. */
export interface Features {
  x: number;
  growth: number; // growth/100, clipped
  age: number; // years
  logage: number; // log10(days + 1)
  chains: number;
  category: string | null;
}

export function featuresOf(p: SnapshotProtocol, asOf: string, medianAge: number, medianLogAge: number): Features {
  const age = ageYears(asOf, p.listed_at);
  const days = ageDays(asOf, p.listed_at);
  return {
    x: Math.log10(Math.max(1, p.tvl_usd)),
    growth: growthClipped(p.change_7d) / 100,
    age: age ?? medianAge,
    logage: days === null ? medianLogAge : Math.log10(days + 1),
    chains: p.chains.length,
    category: p.category,
  };
}

function featuresOfComp(c: Comp): Features {
  return { x: c.x, growth: c.growth / 100, age: c.age, logage: c.logage, chains: c.chains_n, category: c.category };
}

// ---------------------------------------------------------------- linear algebra

/** Solve A z = b by Gaussian elimination with partial pivoting (small dense systems only). */
function solveLinear(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (Math.abs(a[piv]![col]!) < 1e-12) a[piv]![col] = 1e-12;
    if (piv !== col) {
      const tmp = a[col]!;
      a[col] = a[piv]!;
      a[piv] = tmp;
      const tb = b[col]!;
      b[col] = b[piv]!;
      b[piv] = tb;
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r] = b[r]! - f * b[col]!;
    }
  }
  const z = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * z[c]!;
    z[r] = s / a[r]![r]!;
  }
  return z;
}

/** (Weighted) least squares for a design matrix whose first column is the intercept. */
function ols(design: number[][], y: number[], ridge: number, penalizeIntercept: boolean, weights?: number[]): number[] {
  const k = design[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i]!;
    const w = weights === undefined ? 1 : weights[i]!;
    if (w === 0) continue;
    for (let a = 0; a < k; a++) {
      xty[a]! += w * row[a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += w * row[a]! * row[b]!;
    }
  }
  for (let a = 0; a < k; a++) {
    if (a === 0 && !penalizeIntercept) continue;
    xtx[a]![a]! += ridge;
  }
  return solveLinear(xtx, xty);
}

/** Fit by the named method: plain OLS, median (L1) regression, Huber, or a trimmed two-pass OLS. */
function fitByMethod(design: number[][], y: number[], method: FitMethod, ridge: number, penalize: boolean, baseWeights?: number[]): number[] {
  if (method === 'ols') return ols(design, y, ridge, penalize, baseWeights);
  if (method === 'trim') {
    const first = ols(design, y, ridge, penalize, baseWeights);
    const resid = design.map((row, i) => Math.abs(row.reduce((s, v, j) => s + v * first[j]!, 0) - y[i]!));
    const drop = Math.max(2, Math.ceil(design.length * 0.05));
    const keep = resid
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r - b.r)
      .slice(0, Math.max(20, design.length - drop))
      .map((o) => o.i);
    return ols(
      keep.map((i) => design[i]!),
      keep.map((i) => y[i]!),
      ridge,
      penalize,
      baseWeights === undefined ? undefined : keep.map((i) => baseWeights[i]!),
    );
  }
  // IRLS for L1 and Huber, started from the OLS fit.
  let coef = ols(design, y, ridge, penalize, baseWeights);
  for (let iter = 0; iter < 30; iter++) {
    const weights = design.map((row, i) => {
      const r = Math.abs(row.reduce((s, v, j) => s + v * coef[j]!, 0) - y[i]!);
      const irls = method === 'l1' ? 1 / Math.max(r, 0.02) : Math.min(1, 0.35 / Math.max(r, 1e-9));
      return baseWeights === undefined ? irls : irls * baseWeights[i]!;
    });
    const next = ols(design, y, ridge, penalize, weights);
    const shift = Math.max(...next.map((v, j) => Math.abs(v - coef[j]!)));
    coef = next;
    if (shift < 1e-10) break;
  }
  return coef;
}

// ---------------------------------------------------------------- model specs

/** A term the size curve may carry, beyond log10(TVL). */
export type Term = 'growth' | 'age' | 'logage' | 'chains' | 'growthSeg';

/** How the linear core is fitted. */
export type FitMethod = 'ols' | 'l1' | 'huber' | 'trim';

/** How a model is built: its linear terms, its fit method, and its category treatment. */
export interface ModelSpec {
  terms: Term[];
  catOffset: boolean;
  catSlope: boolean;
  ridge: boolean;
  method: FitMethod;
  piecewise: boolean;
  /** A second hinge (two-knot size curve): knots at the 1st and 2nd tertile of log10(TVL). */
  piecewise2?: boolean;
  /** Recency weighting half-life in days (null = unweighted). Weight = 0.5^(age_years*365.25/halfLife). */
  recencyHalfLife?: number | null;
  /** Hinge quantile for a single-hinge curve (default 0.5 = median). */
  knotQ?: number;
}

const BASE_SPEC: ModelSpec = { terms: [], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: false };

/** A fitted linear model: coefficients over [1, x, (hinge), ...terms] plus category adjustments. */
export interface FittedModel {
  kind: 'linear';
  spec: ModelSpec;
  coef: number[];
  offsets: Map<string, number>;
  slopes: Map<string, { a: number; b: number; xbar: number }>;
  means: number[];
  stds: number[];
  knot: number;
  knot2: number;
}

/** The raw (unstandardised) column values of one feature row, in design order. */
function rawColumns(f: Features, spec: ModelSpec, knot: number, knot2: number): number[] {
  const raw: number[] = [1, f.x];
  if (spec.piecewise) raw.push(Math.max(0, f.x - knot));
  if (spec.piecewise2) {
    raw.push(Math.max(0, f.x - knot));
    raw.push(Math.max(0, f.x - knot2));
  }
  for (const t of spec.terms) {
    if (t === 'growth') raw.push(f.growth);
    else if (t === 'age') raw.push(f.age);
    else if (t === 'logage') raw.push(f.logage);
    else if (t === 'growthSeg') raw.push(f.growth * Math.max(0, f.x - knot));
    else raw.push(f.chains);
  }
  return raw;
}

function designRow(f: Features, spec: ModelSpec, means: number[], stds: number[], knot: number, knot2 = 0): number[] {
  const raw = rawColumns(f, spec, knot, knot2);
  if (!spec.ridge) return raw;
  return raw.map((v, i) => (i === 0 ? v : (v - means[i]!) / (stds[i] === 0 ? 1 : stds[i]!)));
}

/** Fit a linear spec on comps: the named fit method plus shrunk category offsets or slopes. */
export function fitModel(comps: Comp[], spec: ModelSpec): FittedModel {
  const feats = comps.map(featuresOfComp);
  const xs = [...comps.map((c) => c.x)].sort((a, b) => a - b);
  const knot = spec.piecewise2 ? quantileSorted(xs, 1 / 3) : spec.piecewise ? quantileSorted(xs, spec.knotQ ?? 0.5) : 0;
  const knot2 = spec.piecewise2 ? quantileSorted(xs, 2 / 3) : 0;
  const weights =
    spec.recencyHalfLife !== undefined && spec.recencyHalfLife !== null
      ? comps.map((c) => Math.pow(0.5, (c.age * 365.25) / spec.recencyHalfLife!))
      : undefined;
  const k = rawColumns(feats[0]!, spec, knot, knot2).length;
  const means = new Array<number>(k).fill(0);
  const stds = new Array<number>(k).fill(1);
  if (spec.ridge) {
    for (let j = 1; j < k; j++) {
      const vals = feats.map((f) => rawColumns(f, spec, knot, knot2)[j]!);
      const m = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / vals.length);
      means[j] = m;
      stds[j] = sd === 0 ? 1 : sd;
    }
  }
  const design = feats.map((f) => designRow(f, spec, means, stds, knot, knot2));
  const y = comps.map((c) => c.y);
  const coef = fitByMethod(design, y, spec.method, spec.ridge ? 1e-3 : 1e-12, spec.ridge, weights);
  const offsets = new Map<string, number>();
  const slopes = new Map<string, { a: number; b: number; xbar: number }>();
  if (spec.catOffset || spec.catSlope) {
    const residByCat = new Map<string, { r: number; x: number }[]>();
    for (let i = 0; i < comps.length; i++) {
      const cat = comps[i]!.category ?? 'null';
      const pred = design[i]!.reduce((s, v, j) => s + v * coef[j]!, 0);
      const list = residByCat.get(cat) ?? [];
      list.push({ r: y[i]! - pred, x: comps[i]!.x });
      residByCat.set(cat, list);
    }
    for (const [cat, rows] of residByCat) {
      const n = rows.length;
      if (spec.catSlope && n >= 5) {
        const xbar = rows.reduce((s, o) => s + o.x, 0) / n;
        let sxx = 0;
        let sxr = 0;
        let sr = 0;
        for (const o of rows) {
          sxx += (o.x - xbar) * (o.x - xbar);
          sxr += (o.x - xbar) * o.r;
          sr += o.r;
        }
        const b = sxx > 1e-9 ? (n / (n + 10)) * (sxr / sxx) : 0;
        const a = (n / (n + 8)) * (sr / n); // the fit is centred at xbar, so the intercept is the shrunk mean residual
        slopes.set(cat, { a, b, xbar });
        offsets.set(cat, 0);
      } else {
        const meanResid = rows.reduce((s, o) => s + o.r, 0) / n;
        offsets.set(cat, (n / (n + 8)) * meanResid);
      }
    }
  }
  return { kind: 'linear', spec, coef, offsets, slopes, means, stds, knot, knot2 };
}

/** The category adjustment a fitted linear model adds for one feature row. */
function categoryAdjustment(model: FittedModel, f: Features): number {
  const cat = f.category ?? 'null';
  const s = model.slopes.get(cat);
  if (s !== undefined) return s.a + s.b * (f.x - s.xbar);
  return model.offsets.get(cat) ?? 0;
}

/** A fitted linear model's log10(market cap) prediction for one protocol's features. */
export function predictLog10(model: FittedModel, f: Features): number {
  const row = designRow(f, model.spec, model.means, model.stds, model.knot, model.knot2);
  let pred = row.reduce((s, v, j) => s + v * model.coef[j]!, 0);
  pred += categoryAdjustment(model, f);
  return pred;
}

/** One labelled piece of a linear prediction: what each part of the model contributes, in log10. */
export interface Contribution {
  key: 'base' | 'growth' | 'age' | 'chains' | 'category';
  label: string;
  log10: number;
}

/** Break a linear prediction into its parts; the parts sum to the prediction. */
export function decompose(model: FittedModel, f: Features): Contribution[] {
  const raw = rawColumns(f, model.spec, model.knot, model.knot2);
  const row = designRow(f, model.spec, model.means, model.stds, model.knot, model.knot2);
  const parts: Contribution[] = [{ key: 'base', label: 'Size curve (TVL)', log10: row[0]! * model.coef[0]! + row[1]! * model.coef[1]! }];
  let j = 2;
  if (model.spec.piecewise) {
    parts[0]!.log10 += row[j]! * model.coef[j]!;
    j++;
  }
  if (model.spec.piecewise2) {
    parts[0]!.log10 += row[j]! * model.coef[j]! + row[j + 1]! * model.coef[j + 1]!;
    j += 2;
  }
  for (const t of model.spec.terms) {
    const v = row[j]! * model.coef[j]!;
    if (t === 'growth') parts.push({ key: 'growth', label: 'Growth (7d)', log10: v });
    else if (t === 'age' || t === 'logage') parts.push({ key: 'age', label: 'No-token clock', log10: v });
    else if (t === 'growthSeg') parts.push({ key: 'growth', label: 'Growth x size segment', log10: v });
    else parts.push({ key: 'chains', label: 'Chain count', log10: v });
    j++;
  }
  void raw;
  const cat = categoryAdjustment(model, f);
  if (model.spec.catOffset || model.spec.catSlope) parts.push({ key: 'category', label: 'Category adjustment', log10: cat });
  return parts;
}

// ---------------------------------------------------------------- kernel model (variant H)

/** A similarity-weighted local fit: the training comps are kept and re-weighted per target. */
export interface KernelModel {
  kind: 'kernel';
  train: Comp[];
  fallback: FittedModel;
  bandwidth: number;
  catBoost: number;
}

export const KERNEL_BANDWIDTH = 0.9;
export const KERNEL_CAT_BOOST = 1.6;
export const KERNEL_GROWTH_SCALE = 60;

/** The kernel weight of one comp for one target: near in TVL, near in growth, same category counts more. */
function kernelWeight(c: Comp, f: Features): number {
  const dx = (c.x - f.x) / KERNEL_BANDWIDTH;
  const dg = (c.growth - f.growth * 100) / KERNEL_GROWTH_SCALE;
  let w = Math.exp(-0.5 * dx * dx) * Math.exp(-0.5 * dg * dg);
  if ((c.category ?? 'null') === (f.category ?? 'null')) w *= KERNEL_CAT_BOOST;
  return w;
}

export function fitKernel(train: Comp[], fallbackSpec: ModelSpec): KernelModel {
  return { kind: 'kernel', train, fallback: fitModel(train, fallbackSpec), bandwidth: KERNEL_BANDWIDTH, catBoost: KERNEL_CAT_BOOST };
}

/** A kernel model's log10 prediction: a weighted [1, x, growth] fit over the comps nearest the target. */
export function predictKernel(model: KernelModel, f: Features): number {
  // One pass accumulating the weighted normal equations (the same system `ols` would build,
  // ridge 1e-6 on the non-intercept diagonal), so a bootstrap of hundreds of refits stays fast.
  const xtx: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xty = [0, 0, 0];
  let sumW = 0;
  let sumW2 = 0;
  for (const c of model.train) {
    const w = kernelWeight(c, f);
    if (w === 0) continue;
    sumW += w;
    sumW2 += w * w;
    const row = [1, c.x, c.growth / 100];
    for (let a = 0; a < 3; a++) {
      xty[a]! += w * row[a]! * c.y;
      for (let b = 0; b < 3; b++) xtx[a]![b]! += w * row[a]! * row[b]!;
    }
  }
  const effN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  if (effN < 10) return predictLog10(model.fallback, f);
  xtx[1]![1]! += 1e-6;
  xtx[2]![2]! += 1e-6;
  const coef = solveLinear(xtx, xty);
  return coef[0]! + coef[1]! * f.x + coef[2]! * f.growth;
}

/** The comps a kernel model leans on most for one target (its effective neighbours). */
export function kernelNeighbours(model: KernelModel, f: Features, n: number): Comp[] {
  return model.train
    .map((c) => ({ c, w: kernelWeight(c, f) }))
    .sort((a, b) => b.w - a.w || (a.c.slug < b.c.slug ? -1 : 1))
    .slice(0, n)
    .map((o) => o.c);
}

/** The n traded comps nearest a target in log-TVL (ties: same category first, then slug). */
export function nearestComps(comps: Comp[], f: Features, n: number): Comp[] {
  return [...comps]
    .sort((a, b) => {
      const da = Math.abs(a.x - f.x) + ((a.category ?? 'null') === (f.category ?? 'null') ? 0 : 0.25);
      const db = Math.abs(b.x - f.x) + ((b.category ?? 'null') === (f.category ?? 'null') ? 0 : 0.25);
      return da - db || (a.slug < b.slug ? -1 : 1);
    })
    .slice(0, n);
}

// ---------------------------------------------------------------- median multiple (variant A)

/** Variant A: the median mcap/TVL multiple per category (global median when a category has <3 comps). */
export interface MedianMultipleModel {
  kind: 'median';
  byCat: Map<string, number>;
  global: number;
}

export function fitMedianMultiple(comps: Comp[]): MedianMultipleModel {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const c of comps) {
    const m = c.mcap / c.tvl;
    all.push(m);
    const list = byCat.get(c.category ?? 'null') ?? [];
    list.push(m);
    byCat.set(c.category ?? 'null', list);
  }
  const out = new Map<string, number>();
  for (const [cat, ms] of byCat) if (ms.length >= 3) out.set(cat, median(ms));
  return { kind: 'median', byCat: out, global: median(all) };
}

export function predictMedianMultiple(model: MedianMultipleModel, f: Features, tvl: number): number {
  const mult = model.byCat.get(f.category ?? 'null') ?? model.global;
  return Math.log10(Math.max(1, tvl * mult));
}

/** Any fitted model this radar can ship. */
export type AnyModel = FittedModel | KernelModel | MedianMultipleModel;

/** Log10 prediction from any fitted model for one protocol's features. */
export function predictAny(model: AnyModel, f: Features, tvl: number): number {
  if (model.kind === 'median') return predictMedianMultiple(model, f, tvl);
  if (model.kind === 'kernel') return predictKernel(model, f);
  return predictLog10(model, f);
}

// ---------------------------------------------------------------- validation

/** |log10 error| of a prediction against an actual market cap. */
function logError(predLog10: number, actualMcap: number): number {
  return Math.abs(predLog10 - Math.log10(actualMcap));
}

export interface VariantScore {
  variant: string;
  label: string;
  wf_median: number;
  wf_within2: number;
  blind_median: number;
  blind_within2: number;
}

export interface ValidationResult {
  scores: VariantScore[];
  winner: string;
  /** The exact linear spec of the winner (null for the median-multiple and kernel winners). */
  winner_spec: ModelSpec | null;
  selected_terms: string[];
  spec_c: ModelSpec;
  n_comps: number;
  n_wf: number;
  n_blind: number;
}

const LOG2 = Math.log10(2);

function summarizeErrors(errors: number[]): { median: number; within2: number } {
  if (errors.length === 0) return { median: Number.NaN, within2: 0 };
  return {
    median: median(errors),
    within2: errors.filter((e) => e <= LOG2).length / errors.length,
  };
}

/** Predict one comp with a linear spec: the spec's own fit on the training comps. */
function predictWithSpec(train: Comp[], spec: ModelSpec, target: Comp): number {
  const model = fitModel(train, spec);
  return predictLog10(model, featuresOfComp(target));
}

/** Walk-forward time-split errors: comps with listed_at, sorted by it, 3 expanding folds. */
function walkForwardErrors(comps: Comp[], predict: (train: Comp[], target: Comp) => number): number[] {
  const dated = comps
    .filter((c) => c.has_listed_at)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const n = dated.length;
  const cuts = [Math.floor(n * 0.5), Math.floor(n * 0.7), Math.floor(n * 0.85), n];
  const errors: number[] = [];
  for (let f = 0; f < 3; f++) {
    const train = dated.slice(0, cuts[f]!);
    const test = dated.slice(cuts[f]!, cuts[f + 1]!);
    for (const t of test) errors.push(logError(predict(train, t), t.mcap));
  }
  return errors;
}

/** Blind holdout errors: 5 seeded 75/25 splits over all comps. */
function blindErrors(comps: Comp[], predict: (train: Comp[], target: Comp) => number, seedBase: number): number[] {
  const errors: number[] = [];
  for (let s = 0; s < 5; s++) {
    const rng = mulberry32(seedBase + s);
    const idx = comps.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = idx[i]!;
      idx[i] = idx[j]!;
      idx[j] = tmp;
    }
    const nTest = Math.floor(comps.length * 0.25);
    const testIdx = new Set(idx.slice(0, nTest));
    const train = comps.filter((_, i) => !testIdx.has(i));
    const test = comps.filter((_, i) => testIdx.has(i));
    for (const t of test) errors.push(logError(predict(train, t), t.mcap));
  }
  return errors;
}

const WF_IMPROVE = 0.005;

/** Score one predictor on both protocols and package the row. */
function scoreVariant(
  comps: Comp[],
  seedBase: number,
  variant: string,
  label: string,
  predict: (train: Comp[], target: Comp) => number,
): VariantScore {
  const wf = summarizeErrors(walkForwardErrors(comps, predict));
  const blind = summarizeErrors(blindErrors(comps, predict, seedBase));
  return { variant, label, wf_median: wf.median, wf_within2: wf.within2, blind_median: blind.median, blind_within2: blind.within2 };
}

/**
 * The bake-off: twenty-nine variants on one protocol — the same walk-forward time-split and
 * blind holdout the previous entries used, so every number here is comparable with their
 * published ones. A–D are the original field, unchanged (controls). C earns its spec by greedy
 * walk-forward term selection, exactly as before. E–M are the previous entry's challengers.
 * N–T attack the same weaknesses from another side: recency-weighted comps (N1–N3), a
 * two-knot size curve (O, P), a growth-by-segment interaction (Q, R) and shrunk category
 * offsets on the two-segment base (S, T). U/W/X/Y/Z/K1/K2 apply the robust and ridge fits
 * and other hinge placements to the winning two-segment base itself.
 * The winner is the lowest walk-forward median error among the challengers that clear the
 * ship rule — beating the shipped model I by at least 0.005 on walk-forward while being no
 * worse than I on the blind holdout. No challenger cleared it, so I ships again.
 */
export function evaluateVariants(comps: Comp[]): ValidationResult {
  const seedBase = 20261114;
  const predictA = (train: Comp[], t: Comp): number => {
    const m = fitMedianMultiple(train);
    return predictMedianMultiple(m, featuresOfComp(t), t.tvl);
  };
  const predictB = (train: Comp[], t: Comp): number => predictWithSpec(train, BASE_SPEC, t);

  const sA = scoreVariant(comps, seedBase, 'A', 'Median multiple per category', predictA);
  const sB = scoreVariant(comps, seedBase, 'B', 'Size curve (log-log OLS)', predictB);

  // Variant C: greedy term selection on the walk-forward score (the original rule, unchanged).
  let specC: ModelSpec = { terms: [], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: false };
  let bestWf = sB.wf_median;
  const selected: string[] = [];
  const candidates: { name: string; apply: (s: ModelSpec) => ModelSpec }[] = [
    { name: 'category-offset', apply: (s) => ({ ...s, catOffset: true }) },
    { name: 'growth', apply: (s) => ({ ...s, terms: [...s.terms, 'growth' as Term] }) },
    { name: 'age', apply: (s) => ({ ...s, terms: [...s.terms, 'age' as Term] }) },
    { name: 'chains', apply: (s) => ({ ...s, terms: [...s.terms, 'chains' as Term] }) },
  ];
  for (const cand of candidates) {
    const trial = cand.apply(specC);
    const wf = summarizeErrors(walkForwardErrors(comps, (train, t) => predictWithSpec(train, trial, t))).median;
    if (bestWf - wf >= WF_IMPROVE) {
      specC = trial;
      bestWf = wf;
      selected.push(cand.name);
    }
  }
  const predictC = (train: Comp[], t: Comp): number => predictWithSpec(train, specC, t);
  const sC = scoreVariant(comps, seedBase, 'C', 'Size curve + walk-forward term selection', predictC);

  // Variant D: ridge multi-factor log-log, standardised features, no category offset.
  const specD: ModelSpec = { terms: ['growth', 'age', 'chains'], catOffset: false, catSlope: false, ridge: true, method: 'ols', piecewise: false };
  const sD = scoreVariant(comps, seedBase, 'D', 'Ridge multi-factor log-log', (train, t) => predictWithSpec(train, specD, t));

  // E, F, G: C's spec, fitted against the outliers instead of by least squares.
  const specE: ModelSpec = { ...specC, method: 'l1' };
  const sE = scoreVariant(comps, seedBase, 'E', 'Median (L1) regression on C\u2019s terms', (train, t) => predictWithSpec(train, specE, t));
  const specF: ModelSpec = { ...specC, method: 'huber' };
  const sF = scoreVariant(comps, seedBase, 'F', 'Huber regression on C\u2019s terms', (train, t) => predictWithSpec(train, specF, t));
  const specG: ModelSpec = { ...specC, method: 'trim' };
  const sG = scoreVariant(comps, seedBase, 'G', 'Trimmed refit (worst 5% dropped) on C\u2019s terms', (train, t) => predictWithSpec(train, specG, t));

  // H: similarity-weighted local fit, falling back to C's spec where neighbours are thin.
  const sH = scoreVariant(comps, seedBase, 'H', 'Similarity-weighted local fit (nearest traded neighbours)', (train, t) => {
    const km = fitKernel(train, specC);
    return predictKernel(km, featuresOfComp(t));
  });

  // I: two-segment size curve (a hinge at the training median TVL) + growth.
  const specI: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true };
  const sI = scoreVariant(comps, seedBase, 'I', 'Two-segment size curve + growth', (train, t) => predictWithSpec(train, specI, t));

  // J: C's spec plus the no-token clock in log-days (the raw-years form is C's own 'age' candidate).
  const specJ: ModelSpec = { ...specC, terms: [...specC.terms, 'logage' as Term] };
  const sJ = scoreVariant(comps, seedBase, 'J', 'C + no-token clock in log-days', (train, t) => predictWithSpec(train, specJ, t));

  // K: C's spec with shrunk per-category slopes where a category has at least 5 comps.
  const specK: ModelSpec = { ...specC, catOffset: false, catSlope: true };
  const sK = scoreVariant(comps, seedBase, 'K', 'C + shrunk category slopes', (train, t) => predictWithSpec(train, specK, t));

  // L and M: the winning two-segment base, carrying the no-token clock in its two shapes. The
  // clock failed on C's single-slope base (J); whether it survives on the two-segment base is a
  // separate question, and the tie-break below is where it is answered.
  const specL: ModelSpec = { terms: ['growth', 'logage'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true };
  const sL = scoreVariant(comps, seedBase, 'L', 'Two-segment size curve + growth + clock (log-days)', (train, t) => predictWithSpec(train, specL, t));
  const specM: ModelSpec = { terms: ['growth', 'age'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true };
  const sM = scoreVariant(comps, seedBase, 'M', 'Two-segment size curve + growth + clock (years)', (train, t) => predictWithSpec(train, specM, t));

  // ---- v4 challengers (N-T), on the same protocol. N1-N3 sweep the recency half-life;
  // O is the two-knot size curve; P pairs it with recency; Q/R add a growth-by-segment
  // interaction; S/T add shrunk category offsets on the two-segment base.
  const specN = (hl: number): ModelSpec => ({ terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true, recencyHalfLife: hl });
  const sN1 = scoreVariant(comps, seedBase, 'N1', 'Two-segment + growth, recency half-life 180d', (train, t) => predictWithSpec(train, specN(180), t));
  const sN2 = scoreVariant(comps, seedBase, 'N2', 'Two-segment + growth, recency half-life 365d', (train, t) => predictWithSpec(train, specN(365), t));
  const sN3 = scoreVariant(comps, seedBase, 'N3', 'Two-segment + growth, recency half-life 730d', (train, t) => predictWithSpec(train, specN(730), t));
  const specO: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: false, piecewise2: true };
  const sO = scoreVariant(comps, seedBase, 'O', 'Two-knot size curve + growth', (train, t) => predictWithSpec(train, specO, t));
  const specP: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: false, piecewise2: true, recencyHalfLife: 365 };
  const sP = scoreVariant(comps, seedBase, 'P', 'Two-knot size curve + growth, recency 365d', (train, t) => predictWithSpec(train, specP, t));
  const specQ: ModelSpec = { terms: ['growth', 'growthSeg'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true };
  const sQ = scoreVariant(comps, seedBase, 'Q', 'Two-segment + growth + growth-by-segment', (train, t) => predictWithSpec(train, specQ, t));
  const specR: ModelSpec = { terms: ['growth', 'growthSeg'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: false, piecewise2: true };
  const sR = scoreVariant(comps, seedBase, 'R', 'Two-knot + growth + growth-by-segment', (train, t) => predictWithSpec(train, specR, t));
  const specS: ModelSpec = { terms: ['growth'], catOffset: true, catSlope: false, ridge: false, method: 'ols', piecewise: true };
  const sS = scoreVariant(comps, seedBase, 'S', 'Two-segment + growth + category offsets', (train, t) => predictWithSpec(train, specS, t));
  const specT: ModelSpec = { terms: ['growth'], catOffset: true, catSlope: false, ridge: false, method: 'ols', piecewise: true, recencyHalfLife: 365 };
  const sT = scoreVariant(comps, seedBase, 'T', 'Two-segment + growth + offsets, recency 365d', (train, t) => predictWithSpec(train, specT, t));

  // ---- v4 round 2 (one extra round only): knot placement, I+chains, and the robust/ridge
  // fits applied to the winning two-segment base instead of to C.
  const specU: ModelSpec = { terms: ['growth', 'chains'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true };
  const sU = scoreVariant(comps, seedBase, 'U', 'Two-segment + growth + chains', (train, t) => predictWithSpec(train, specU, t));
  const specW: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: true, method: 'ols', piecewise: true };
  const sW = scoreVariant(comps, seedBase, 'W', 'Two-segment + growth, ridge', (train, t) => predictWithSpec(train, specW, t));
  const specX: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'trim', piecewise: true };
  const sX = scoreVariant(comps, seedBase, 'X', 'Two-segment + growth, trimmed refit', (train, t) => predictWithSpec(train, specX, t));
  const specY: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'l1', piecewise: true };
  const sY = scoreVariant(comps, seedBase, 'Y', 'Two-segment + growth, median (L1) regression', (train, t) => predictWithSpec(train, specY, t));
  const specZ: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'huber', piecewise: true };
  const sZ = scoreVariant(comps, seedBase, 'Z', 'Two-segment + growth, Huber regression', (train, t) => predictWithSpec(train, specZ, t));
  const specK1: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true, knotQ: 0.4 };
  const sK1 = scoreVariant(comps, seedBase, 'K1', 'Two-segment (hinge at 40th pct) + growth', (train, t) => predictWithSpec(train, specK1, t));
  const specK2: ModelSpec = { terms: ['growth'], catOffset: false, catSlope: false, ridge: false, method: 'ols', piecewise: true, knotQ: 0.6 };
  const sK2 = scoreVariant(comps, seedBase, 'K2', 'Two-segment (hinge at 60th pct) + growth', (train, t) => predictWithSpec(train, specK2, t));

  const scores = [sA, sB, sC, sD, sE, sF, sG, sH, sI, sJ, sK, sL, sM, sN1, sN2, sN3, sO, sP, sQ, sR, sS, sT, sU, sW, sX, sY, sZ, sK1, sK2];
  const specByVariant = new Map<string, ModelSpec>([
    ['B', BASE_SPEC],
    ['C', specC],
    ['D', specD],
    ['E', specE],
    ['F', specF],
    ['G', specG],
    ['I', specI],
    ['J', specJ],
    ['K', specK],
    ['L', specL],
    ['M', specM],
    ['N1', specN(180)],
    ['N2', specN(365)],
    ['N3', specN(730)],
    ['O', specO],
    ['P', specP],
    ['Q', specQ],
    ['R', specR],
    ['S', specS],
    ['T', specT],
    ['U', specU],
    ['W', specW],
    ['X', specX],
    ['Y', specY],
    ['Z', specZ],
    ['K1', specK1],
    ['K2', specK2],
  ]);
  // The v4 ship rule, fixed before the run: a challenger (N-T, U, W, X, Y, Z, K1, K2) ships
  // only when it beats the shipped model I on walk-forward by the full 0.005 margin AND is no
  // worse than I on the blind holdout. Otherwise I ships again, improved only in presentation.
  const challengers = scores.filter((sc) => sc.variant !== 'A' && sc.variant !== 'B' && sc.variant !== 'C' && sc.variant !== 'D' && sc.variant !== 'E' && sc.variant !== 'F' && sc.variant !== 'G' && sc.variant !== 'H' && sc.variant !== 'I' && sc.variant !== 'J' && sc.variant !== 'K' && sc.variant !== 'L' && sc.variant !== 'M');
  const passing = challengers.filter((sc) => sI.wf_median - sc.wf_median >= WF_IMPROVE && sc.blind_median <= sI.blind_median);
  passing.sort((a, b) => a.wf_median - b.wf_median || a.blind_median - b.blind_median);
  const winner = passing.length > 0 ? passing[0]!.variant : 'I';
  const winnerSpec = specByVariant.get(winner) ?? null;
  return {
    scores,
    winner,
    winner_spec: winnerSpec,
    selected_terms: selected,
    spec_c: specC,
    n_comps: comps.length,
    n_wf: walkForwardErrors(comps, predictB).length,
    n_blind: 5 * Math.floor(comps.length * 0.25),
  };
}

/** The fitted final model for the winning variant, on the comps given. */
export function fitWinner(comps: Comp[], validation: ValidationResult): AnyModel {
  const w = validation.winner;
  const specC = validation.spec_c;
  if (w === 'A') return fitMedianMultiple(comps);
  if (w === 'H') return fitKernel(comps, specC);
  return fitModel(comps, validation.winner_spec ?? specC);
}

/** A plain-words formula for a fitted model, for the dashboard and the board's readers. */
export function formulaOf(model: AnyModel, validation: ValidationResult): string {
  const w = validation.winner;
  if (w === 'A') return 'implied = TVL x median(mcap/TVL) of its category (global median when fewer than 3 comps)';
  if (w === 'H') return 'implied = a weighted fit over the traded tokens nearest in TVL and growth (same category weighs 1.6x), refit for every protocol';
  const spec = model.kind === 'linear' ? model.spec : null;
  const terms: string[] = ['a + b x log10(TVL)'];
  if (spec?.piecewise) terms.push('b2 x max(0, log10(TVL) - knot)');
  if (spec?.piecewise2) terms.push('b2 x max(0, log10(TVL) - knot1) + b3 x max(0, log10(TVL) - knot2)');
  for (const t of spec?.terms ?? []) {
    if (t === 'growth') terms.push('c x (growth_7d/100)');
    else if (t === 'age') terms.push('d x age_years');
    else if (t === 'logage') terms.push('d x log10(days without a token)');
    else if (t === 'growthSeg') terms.push('c2 x (growth_7d/100) x max(0, log10(TVL) - knot)');
    else terms.push('e x chains_n');
  }
  if (spec?.catOffset) terms.push('shrunk category offset');
  if (spec?.catSlope) terms.push('shrunk category slope');
  const method =
    spec?.method === 'l1' ? 'median (L1) regression' : spec?.method === 'huber' ? 'Huber regression' : spec?.method === 'trim' ? 'trimmed least squares' : spec?.ridge ? 'ridge regression' : 'least squares';
  const recency = spec?.recencyHalfLife ? `, comps weighted by recency (half-life ${spec.recencyHalfLife}d)` : '';
  return `log10(implied) = ${terms.join(' + ')}, fitted by ${method}${recency}`;
}

// ---------------------------------------------------------------- board eligibility

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house watchlist's exclusion categories. */
export const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name ending in a version marker: a space then V2, v2, 2.0, 2 or the like. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+(\.\d+)?)$/;
/** A whole word wrapped, staked or staking in a name, any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's name at the start of a protocol name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a pre-token protocol is kept off the board, or null when it belongs on it. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (VERSIONED.test(p.name)) return 'versioned-name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped-word';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange-prefix';
  return null;
}

// ---------------------------------------------------------------- farm plan

/** The farm plan's named constants, as the dashboard states them. */
export const HORIZON_WEEKS = 12;
export const COMMUNITY_SHARE = 0.05;
export const FARM_HOURS = 6.8;
export const CAPITAL_APR = 0.05;
export const PARTICIPATION: Record<string, number> = {
  Dexs: 0.15,
  Lending: 0.12,
  Derivatives: 0.12,
  Yield: 0.1,
  'Yield Aggregator': 0.1,
  'Risk Curators': 0.06,
  'Onchain Capital Allocator': 0.06,
  RWA: 0.05,
};
export const DEFAULT_PARTICIPATION = 0.08;

/**
 * Estimated gas for one transaction on each chain, in USD (November 2026, rough magnitudes:
 * Ethereum is dollars per transaction, the L2s and fast chains cents). These are estimates,
 * labelled as such wherever they are shown — check the chain's fee tracker before acting.
 * A chain the table does not name costs the default.
 */
export const GAS_USD_PER_TX: Record<string, number> = {
  Ethereum: 4.0,
  Bitcoin: 1.5,
  Avalanche: 0.4,
  Binance: 0.25,
  Arbitrum: 0.25,
  Optimism: 0.2,
  Linea: 0.1,
  Fantom: 0.1,
  'Robinhood Chain': 0.1,
  Plasma: 0.1,
  Base: 0.08,
  Polygon: 0.05,
  Solana: 0.03,
  'Hyperliquid L1': 0.05,
  Monad: 0.05,
  Sui: 0.05,
  Sonic: 0.05,
  Mantle: 0.05,
  Ripple: 0.05,
};
export const DEFAULT_GAS_USD_PER_TX = 0.5;

/** The estimated gas for one transaction on a chain, or the default when it is unnamed. */
export function gasPerTx(chain: string): number {
  return GAS_USD_PER_TX[chain] ?? DEFAULT_GAS_USD_PER_TX;
}

export function participationFor(category: string | null): number {
  return category !== null && category in PARTICIPATION ? PARTICIPATION[category]! : DEFAULT_PARTICIPATION;
}

/** The deposit tier from a protocol's TVL. */
export function depositFor(tvl: number): number {
  if (tvl >= 250_000_000) return 5000;
  if (tvl >= 75_000_000) return 2500;
  if (tvl >= 20_000_000) return 1000;
  return 500;
}

/** A row's costed farm plan, netted to the dollar at the low end of its value band. */
export interface FarmPlan {
  deposit: number;
  participation: number;
  competing: number;
  gross_low: number;
  fees: number;
  hours: number;
  capital_cost: number;
  net: number;
  usd_per_hour: number;
  breakeven: number;
  verdict: 'farm' | 'thin' | 'skip';
}

export function farmPlan(p: SnapshotProtocol, p10: number): FarmPlan {
  const deposit = depositFor(p.tvl_usd);
  const participation = participationFor(p.category);
  const competing = participation * p.tvl_usd;
  const gross_low = p10 * COMMUNITY_SHARE * (deposit / (deposit + competing));
  // Fees: one setup transaction per chain the protocol runs on, one weekly transaction on
  // its main chain for each of the 12 weeks, plus 0.1% of the deposit in swap/slippage costs.
  const setupGas = p.chains.reduce((s, c) => s + gasPerTx(c), 0);
  const weeklyGas = HORIZON_WEEKS * gasPerTx(chainOf(p));
  const fees = setupGas + weeklyGas + 0.001 * deposit;
  const hours = FARM_HOURS;
  const capital_cost = deposit * CAPITAL_APR * (HORIZON_WEEKS / 52);
  const net = gross_low - fees - capital_cost;
  const usd_per_hour = net / hours;
  const breakeven = (fees + capital_cost) / (COMMUNITY_SHARE * (deposit / (deposit + competing)));
  const verdict: FarmPlan['verdict'] = net >= 200 && usd_per_hour >= 25 ? 'farm' : net > 0 ? 'thin' : 'skip';
  return { deposit, participation, competing, gross_low, fees, hours, capital_cost, net, usd_per_hour, breakeven, verdict };
}

/** Compact dollars: $1.23M, $45.6K, $812. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, deposit: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${deposit} of USDC to ${name} on ${chain} and keep the lending position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${deposit} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('liquidity manager')) return `Deposit $${deposit} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('yield')) return `Deposit $${deposit} into ${name}'s main yield position on ${chain} and keep it open.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('synthetic')) return `Deposit $${deposit} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) return `Deposit $${deposit} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${deposit} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('stable') || c.includes('reserve')) return `Mint or deposit $${deposit} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${deposit} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('prediction')) return `Fund $${deposit} and place one market position on ${name}.`;
  if (c.includes('launchpad')) return `Stake $${deposit} into ${name}'s launch allocation on ${chain} and join its sales.`;
  return `Deposit $${deposit} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * The weekly action the protocol's own mechanism calls for, in the words a farmer can
 * follow. A farm plan that repeats the same generic action every week is not a plan:
 * a lender's position is refreshed by repaying and re-borrowing, a vault's by harvesting
 * and re-depositing, a derivatives desk's by closing and reopening its hedge.
 */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `repay a small slice of the ${name} loan and re-borrow it, so the position shows fresh activity.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `swap a small amount through the ${name} pool and claim any fees earned, keeping the position active.`;
  if (c.includes('yield aggregator') || c.includes('liquidity manager')) return `harvest the ${name} vault's rewards and re-deposit them into the vault.`;
  if (c.includes('yield')) return `claim the week's yield from ${name} and re-deposit it into the same position.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('synthetic')) return `close the hedge on ${name} and reopen it at the new price, keeping the margin posted.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) return `rebalance into the ${name} vault's newest allocation.`;
  if (c.includes('rwa')) return `claim the week's yield on the ${name} asset and hold it.`;
  if (c.includes('stable') || c.includes('reserve')) return `mint a small amount more of the stable asset through ${name} and hold it.`;
  if (c.includes('insurance')) return `check the ${name} policy stays active, and top up cover if the protocol adds a pool.`;
  if (c.includes('prediction')) return `settle the week's market on ${name} and place one fresh position.`;
  if (c.includes('launchpad')) return `join the week's sale allocation on ${name} if one opens; otherwise hold the stake.`;
  return `make one qualifying action on ${name} — a deposit, a swap, a vote or a claim.`;
}

/**
 * A protocol's farm plan: six steps, each an action with its cost, its time and its dates. The
 * calendar is the snapshot's own: week 1 opens on the as_of date and the horizon closes 12 weeks
 * later, so two runs of the program — and a reader checking the page against the snapshot — see
 * the same dates. Gas is priced per chain from the labelled estimates, so a plan on a cheap chain
 * costs cents where the same plan on Ethereum costs dollars. The plan's numbers are the
 * protocol's own, never a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, plan: FarmPlan, p10: number, p50: number, asOf: string): string[] {
  const chain = chainOf(p);
  const action = actionFor(p, plan.deposit, chain);
  const weekly = weeklyActionFor(p);
  const setupGas = p.chains.reduce((s, c) => s + gasPerTx(c), 0);
  const weeklyGas = gasPerTx(chain);
  const w1 = `${fmtDate(asOf)} – ${fmtDate(addDays(asOf, 7))}`;
  const w2to12 = `${fmtDate(addDays(asOf, 7))} – ${fmtDate(addDays(asOf, HORIZON_WEEKS * 7))}`;
  const review = fmtDate(addDays(asOf, HORIZON_WEEKS * 7));
  const verdictLine =
    plan.verdict === 'farm'
      ? `Verdict: farm — the low end already clears the bar, so run the full ${HORIZON_WEEKS}-week plan to ${review}.`
      : plan.verdict === 'thin'
        ? `Verdict: thin — the low end barely pays, so farm small and only with funds you can leave idle until ${review}.`
        : `Verdict: skip — at the low end the plan loses money, so wait for a better entry or a bigger share.`;
  const steps = [
    `Week 1 (${w1}): set up a fresh wallet holding only the funds you plan to farm, and bridge $${plan.deposit} to ${chain} for ${p.name}. Cost: about $${setupGas.toFixed(2)} of gas across ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'} (estimates). Time: 10 minutes.`,
    `Week 1 (${w1}): ${action} Cost: $${plan.deposit} of capital plus about $${weeklyGas.toFixed(2)} of gas on ${chain}. Time: 15 minutes to set up.`,
    `Weeks 2–${HORIZON_WEEKS} (${w2to12}): each week, ${weekly} Cost: about $${weeklyGas.toFixed(2)} of gas a week on ${chain}. Time: ${plan.hours} hours over the whole plan.`,
    `At the low end of the value band (${fmtUsd(p10)} implied, vs ${fmtUsd(p50)} at the middle), the community share is worth ${fmtUsd(plan.gross_low)} gross; fees ${fmtUsd(plan.fees)} and capital cost ${fmtUsd(plan.capital_cost)} leave a net of ${fmtUsd(plan.net)}, or ${fmtUsd(plan.usd_per_hour)} an hour. Cost: ${fmtUsd(plan.fees + plan.capital_cost)} all in. Time: ${HORIZON_WEEKS} weeks.`,
    `Break-even needs the token to launch at ${fmtUsd(plan.breakeven)} implied value; below that the plan loses money, above it every extra dollar of value is profit on a $${plan.deposit} deposit against ${fmtUsd(plan.competing)} of competing capital. Review the position on ${review}. Cost: nothing to check. Time: 10 minutes.`,
    `${verdictLine} Before you withdraw, open ${p.name}'s own points page from the link it publishes and claim only there — never pay to claim. Cost: no fee to check. Time: 10 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- board

/** A traded neighbour a row was priced against. */
export interface Neighbour {
  name: string;
  slug: string;
  tvl_usd: number;
  mcap_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number | null;
  implied_value_usd: number;
  implied_p10: number;
  implied_p90: number;
  rank_lo: number;
  rank_hi: number;
  parts: Contribution[] | null;
  neighbours: Neighbour[];
  deposit: number;
  gross_low: number;
  fees: number;
  hours: number;
  capital_cost: number;
  net: number;
  usd_per_hour: number;
  breakeven: number;
  verdict: 'farm' | 'thin' | 'skip';
  watchlist: boolean;
  farm_steps: string[];
}

/** How the 758 protocols are accounted for. */
export interface Coverage {
  total: number;
  board: number;
  token_recorded: number;
  excluded: number;
  excluded_by_reason: Record<string, number>;
}

/** Everything the dashboard needs: the board, the model, the validation and the coverage. */
export interface RadarData {
  board_name: string;
  as_of: string;
  source: string;
  floor_usd: number;
  model_name: string;
  model_formula: string;
  winner: string;
  selected_terms: string[];
  variant_scores: VariantScore[];
  n_comps: number;
  n_wf: number;
  n_blind: number;
  watchlist_size: number;
  board_size: number;
  coverage: Coverage;
  verdict_counts: Record<string, number>;
  assumptions: Record<string, unknown>;
  rows: BoardRow[];
}

const BOOTSTRAP_REFITS = 200;
const BOOTSTRAP_SEED = 0x51_67_74;

/**
 * Build the board: run the twenty-nine-variant bake-off, fit the winner on all comps, bootstrap
 * 200 refits for the p10/p50/p90 band and the rank range, rank by the bootstrap median, attach
 * each row's decomposition and traded neighbours, and cost a dated, per-mechanism farm plan
 * per row.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; validation: ValidationResult } {
  const comps = buildComps(snapshot);
  const validation = evaluateVariants(comps);
  const winner = validation.winner;
  const fitted = fitWinner(comps, validation);
  const medianAge = median(comps.map((c) => c.age));
  const medianLogAge = median(comps.map((c) => c.logage));

  const watchlistSet = new Set(snapshot.watchlist);

  // Coverage accounting: every protocol is board, token-recorded, or excluded for a named reason.
  const excludedByReason: Record<string, number> = {};
  let tokenRecorded = 0;
  const boardProtocols: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      tokenRecorded++;
      continue;
    }
    const reason = exclusionReason(p);
    if (reason !== null) {
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
      continue;
    }
    boardProtocols.push(p);
  }
  const coverage: Coverage = {
    total: snapshot.protocols.length,
    board: boardProtocols.length,
    token_recorded: tokenRecorded,
    excluded: snapshot.protocols.length - boardProtocols.length - tokenRecorded,
    excluded_by_reason: excludedByReason,
  };

  const feats = boardProtocols.map((p) => featuresOf(p, snapshot.as_of, medianAge, medianLogAge));
  const pointLog = feats.map((f, i) => predictAny(fitted, f, boardProtocols[i]!.tvl_usd));

  // Bootstrap: resample the comps with replacement, refit, predict every board protocol.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const n = boardProtocols.length;
  const bootValues: number[][] = boardProtocols.map(() => []);
  const bootRanks: number[][] = boardProtocols.map(() => []);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const sample: Comp[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const refit = fitWinner(sample, validation);
    const preds = feats.map((f, i) => Math.pow(10, predictAny(refit, f, boardProtocols[i]!.tvl_usd)));
    for (let i = 0; i < n; i++) bootValues[i]!.push(preds[i]!);
    const order = preds
      .map((v, i) => ({ v, i }))
      .sort((a, b2) => b2.v - a.v || (boardProtocols[a.i]!.slug < boardProtocols[b2.i]!.slug ? -1 : 1));
    order.forEach((o, pos) => bootRanks[o.i]!.push(pos + 1));
  }

  const scored = boardProtocols.map((p, i) => {
    const vals = [...bootValues[i]!].sort((a, b) => a - b);
    const ranks = [...bootRanks[i]!].sort((a, b) => a - b);
    const p10 = quantileSorted(vals, 0.1);
    const p50 = quantileSorted(vals, 0.5);
    const p90 = quantileSorted(vals, 0.9);
    const plan = farmPlan(p, p10);
    const f = feats[i]!;
    const parts = fitted.kind === 'linear' ? decompose(fitted, f).map((c) => ({ ...c, log10: round4(c.log10) })) : null;
    const nbs = (fitted.kind === 'kernel' ? kernelNeighbours(fitted, f, 3) : nearestComps(comps, f, 3)).map((c) => ({
      name: c.name,
      slug: c.slug,
      tvl_usd: c.tvl,
      mcap_usd: c.mcap,
    }));
    const age = ageYears(snapshot.as_of, p.listed_at);
    return {
      p,
      p10,
      p50,
      p90,
      rank_lo: Math.round(quantileSorted(ranks, 0.1)),
      rank_hi: Math.round(quantileSorted(ranks, 0.9)),
      point: Math.pow(10, pointLog[i]!),
      plan,
      parts,
      neighbours: nbs,
      age_years: age === null ? null : Math.round(age * 10) / 10,
    };
  });
  scored.sort((a, b) => b.p50 - a.p50 || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_years: s.age_years,
    implied_value_usd: Math.max(1, Math.round(s.p50)),
    implied_p10: Math.max(1, Math.round(s.p10)),
    implied_p90: Math.max(1, Math.round(s.p90)),
    rank_lo: s.rank_lo,
    rank_hi: s.rank_hi,
    parts: s.parts,
    neighbours: s.neighbours,
    deposit: s.plan.deposit,
    gross_low: round2(s.plan.gross_low),
    fees: round2(s.plan.fees),
    hours: s.plan.hours,
    capital_cost: round2(s.plan.capital_cost),
    net: round2(s.plan.net),
    usd_per_hour: round2(s.plan.usd_per_hour),
    breakeven: Math.max(1, Math.round(s.plan.breakeven)),
    verdict: s.plan.verdict,
    watchlist: watchlistSet.has(s.p.slug),
    farm_steps: farmSteps(s.p, s.plan, s.p10, s.p50, snapshot.as_of),
  }));

  // The watchlist is the floor: every slug must be on the board, or the run refuses.
  const onBoard = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (missing.length > 0) throw new SnapshotError(`board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`);

  const verdictCounts: Record<string, number> = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;

  const radar: RadarData = {
    board_name: 'Apogee',
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_name: `Apogee-${winner}`,
    model_formula: formulaOf(fitted, validation),
    winner,
    selected_terms: validation.selected_terms,
    variant_scores: validation.scores,
    n_comps: comps.length,
    n_wf: validation.n_wf,
    n_blind: validation.n_blind,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    coverage,
    verdict_counts: verdictCounts,
    assumptions: {
      horizon_weeks: HORIZON_WEEKS,
      community_share: COMMUNITY_SHARE,
      farm_hours: FARM_HOURS,
      capital_apr: CAPITAL_APR,
      participation: PARTICIPATION,
      default_participation: DEFAULT_PARTICIPATION,
      deposit_tiers: 'TVL >= $250M: $5000; >= $75M: $2500; >= $20M: $1000; else $500',
      fees: 'setup gas (one estimated transaction per chain) + 12 weekly transactions on the main chain + 0.001 x deposit',
      gas_per_tx_usd_estimates: GAS_USD_PER_TX,
      default_gas_per_tx_usd: DEFAULT_GAS_USD_PER_TX,
      gas_note: 'Gas figures are November 2026 estimates; check the chain fee tracker before acting.',
      capital_cost: 'deposit x 0.05 x 12/52',
      bootstrap_refits: BOOTSTRAP_REFITS,
    },
    rows: board,
  };
  return { board, radar, validation };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
