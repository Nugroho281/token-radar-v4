// Apogee bake-off: twenty-nine variants scored by walk-forward time-split and blind holdout.
//
// Reads the sealed snapshot, builds the one-per-ticker comps, runs evaluateVariants from
// lib/model.ts, and writes research/variant-results.json. A–M are the previous entries' field,
// run unchanged on the identical protocol, so their numbers must reproduce the published ones
// (walk-forward A 0.7208, B 0.4797, C 0.4470, D 0.5507, I 0.4399); N–T and U, W, X, Y, Z, K1, K2
// are the new challengers. Run: node research/bakeoff.mjs (from the repository root, or pass
// --input <snapshot.json>).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComps, evaluateVariants, parseSnapshot } from '../lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const input = arg('input', join(root, '..', 'kit', 'input', 'snapshot.json'));
const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
const comps = buildComps(snapshot);
const result = evaluateVariants(comps);

const out = {
  as_of: snapshot.as_of,
  comps: comps.length,
  comps_with_listed_at: comps.filter((c) => c.has_listed_at).length,
  n_wf_predictions: result.n_wf,
  n_blind_predictions: result.n_blind,
  winner: result.winner,
  selected_terms: result.selected_terms,
  spec_c: result.spec_c,
  scores: result.scores,
};
writeFileSync(join(here, 'variant-results.json'), `${JSON.stringify(out, null, 2)}\n`);

console.log(`bake-off: ${comps.length} comps (${out.comps_with_listed_at} with listed_at), ${result.n_wf} walk-forward + ${result.n_blind} blind predictions`);
console.log('variant | WF median | WF <=2x | blind median | blind <=2x');
for (const s of result.scores) {
  console.log(`${s.variant} ${s.label} | ${s.wf_median.toFixed(4)} | ${(s.wf_within2 * 100).toFixed(1)}% | ${s.blind_median.toFixed(4)} | ${(s.blind_within2 * 100).toFixed(1)}%`);
}
console.log(`winner: ${result.winner} (C selected terms: ${result.selected_terms.join(', ') || 'none'})`);
console.log(`wrote ${join(here, 'variant-results.json')}`);
