// Apogee gate-check: validates an output directory against the kit's gate rules.
// Run: node research/gate-check.mjs [--out out1]  (default: out1)
// Exits 0 on GATE OK, 1 with the first failure named.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const out = arg('out', 'out1');
const snapshot = JSON.parse(readFileSync(arg('input', join('..', 'kit', 'input', 'snapshot.json')), 'utf8'));
const failures = [];
const fail = (msg) => failures.push(msg);

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// --- board.json ---
const boardPath = join(out, 'board.json');
if (!existsSync(boardPath)) fail('board.json missing');
const board = existsSync(boardPath) ? JSON.parse(readFileSync(boardPath, 'utf8')) : { rows: [] };
const rows = board.rows ?? board;
if (!Array.isArray(rows)) fail('board rows is not an array');
if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows, outside 100..4000`);
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
const seen = new Set();
rows.forEach((r, i) => {
  if (!slugs.has(r.slug)) fail(`row ${i} slug ${r.slug} is not a snapshot protocol`);
  if (seen.has(r.slug)) fail(`duplicate slug ${r.slug}`);
  seen.add(r.slug);
  if (typeof r.name !== 'string' || r.name.length === 0) fail(`row ${i} has no name`);
});
const missingWatch = snapshot.watchlist.filter((s) => !seen.has(s));
if (missingWatch.length > 0) fail(`watchlist ${missingWatch.length} missing: ${missingWatch.slice(0, 5).join(', ')}`);
else console.log(`watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length}`);
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) { fail(`rank ${i + 1} is ${ranks[i]}`); break; }
for (let i = 1; i < rows.length; i++) {
  if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) { fail(`row ${i + 1} outranks row ${i} on implied value`); break; }
}
if (rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) fail('all rows share the same implied value');
rows.forEach((r) => {
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) fail(`${r.slug} implied value ${r.implied_value_usd}`);
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug} has ${Array.isArray(r.farm_steps) ? r.farm_steps.length : 'no'} farm steps`);
  else for (const s of r.farm_steps) {
    if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) { fail(`${r.slug} farm step of ${typeof s === 'string' ? s.trim().length : 'non-string'} chars`); break; }
  }
});
const stepLens = rows.flatMap((r) => r.farm_steps.map((s) => s.trim().length));
console.log(`rows ${rows.length}, farm steps ${rows[0]?.farm_steps.length} per row, step length ${Math.min(...stepLens)}..${Math.max(...stepLens)} chars`);
const dated = rows.every((r) => r.farm_steps.some((s) => /Week 1 \(/.test(s)));
console.log(`dated farm steps: ${dated ? 'yes' : 'NO'}`);
if (!dated) fail('farm steps are not dated');

// --- dossier.json ---
const dossierPath = join(out, 'dossier.json');
if (!existsSync(dossierPath)) fail('dossier.json missing');
else {
  const dossier = JSON.parse(readFileSync(dossierPath, 'utf8'));
  const textBytes = Buffer.byteLength(dossier.text ?? '', 'utf8');
  console.log(`dossier ${statSync(dossierPath).size} bytes, text ${textBytes} bytes (cap 65536 for the judge's reading)`);
  if (textBytes > 65536) fail(`dossier text ${textBytes} bytes exceeds the 65536 the judge reads`);
}

// --- screenshots ---
const shotDir = join(out, 'screenshots');
if (!existsSync(shotDir)) fail('screenshots/ missing');
else {
  const shots = readdirSync(shotDir).filter((n) => n.endsWith('.png')).sort();
  console.log(`screenshots: ${shots.join(', ')}`);
  if (shots.length < 3) fail(`only ${shots.length} screenshots, need 3`);
  for (const name of shots) {
    const buf = readFileSync(join(shotDir, name));
    const size = pngSize(buf);
    console.log(`  ${name}: ${buf.length} bytes${size ? `, ${size.w}x${size.h}` : ''}`);
    if (buf.length > 524288) fail(`${name} exceeds 512 KiB`);
    if (size && (size.w !== 1440 || size.h !== 1000)) fail(`${name} is ${size.w}x${size.h}, expected 1440x1000`);
  }
}

if (failures.length > 0) {
  console.error(`GATE FAIL:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('GATE OK');
