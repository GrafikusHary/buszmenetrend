#!/usr/bin/env node
// GTFS frissítő script: letölti az országos Volánbusz GTFS-t (vagy helyi zipet vesz), leszűri Nyíregyházára,
// ellenőrzi, és beírja a public/data/ mappába (gtfs.zip + meta.json).
//
// Használat:
//   node scripts/update-gtfs.mjs                 # forrás: GTFS_URL env vagy public/data/config.json "sourceUrl"
//   node scripts/update-gtfs.mjs <url|fájl.zip>  # megadott forrás
//   GTFS_HEADER="Authorization: Bearer xyz" node scripts/update-gtfs.mjs   # ha a letöltéshez fejléc kell
//
// Szűrés: config.json "agencyMatch" (reguláris kifejezés az agency_name-re, pl. "Nyíregyháza").
// Ezután:  npm run cap:sync  (APK újraépítéséhez) – vagy a GitHub Actions elvégzi.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, createWriteStream, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGtfsZip, Feed, fmtDate } from '../src/gtfs.js';
import { filterGtfs } from './gtfs-filter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data');
const cfgPath = join(dataDir, 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};

const src = process.argv[2] || process.env.GTFS_URL || cfg.sourceUrl;
if (!src) {
  console.error('Nincs megadva GTFS forrás. Adj meg URL-t/fájlt argumentumként, a GTFS_URL változóban, vagy a public/data/config.json "sourceUrl" mezőjében.');
  process.exit(1);
}
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const tmp = join(tmpdir(), `gtfs-${process.pid}.zip`);

async function fetchToFile() {
  if (!/^https?:\/\//i.test(src)) return src;
  const headers = { 'User-Agent': 'NyirBusz-GTFS-updater/1.0' };
  if (process.env.GTFS_HEADER) {
    const i = process.env.GTFS_HEADER.indexOf(':');
    headers[process.env.GTFS_HEADER.slice(0, i).trim()] = process.env.GTFS_HEADER.slice(i + 1).trim();
  }
  console.log('Letöltés…');
  const r = await fetch(src, { headers, redirect: 'follow' });
  if (!r.ok) throw new Error(`Letöltési hiba: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
  console.log(`Letöltve: ${(statSync(tmp).size / 1048576).toFixed(1)} MB`);
  return tmp;
}

try {
  const file = await fetchToFile();
  let bytes;
  if (cfg.agencyMatch || cfg.agencyId) {
    console.log('Szűrés a szolgáltatóra…');
    bytes = await filterGtfs(file, { agencyMatch: cfg.agencyMatch, agencyId: cfg.agencyId, log: m => console.log('  ' + m) });
  } else {
    bytes = new Uint8Array(readFileSync(file));
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  const metaPath = join(dataDir, 'meta.json');
  const old = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  if (old.sha256 === sha && !old.demo) {
    console.log('Nincs változás: a menetrend már a legfrissebb.');
    out('changed', 'false');
    process.exit(0);
  }
  const data = parseGtfsZip(bytes, { bbox: cfg.bbox, stripPrefix: cfg.stripPrefix });
  if (data.stops.length < 2 || data.trips.length < 1) throw new Error('A zip nem tűnik érvényes GTFS-nek (nincs megálló/járat).');
  const feed = new Feed(data);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'gtfs.zip'), bytes);
  let host = 'file';
  try { host = new URL(src).host; } catch { /* helyi fájl */ }
  writeFileSync(metaPath, JSON.stringify({
    builtAt: Date.now(), demo: false, source: host, sha256: sha,
    feedStart: data.meta.feedStart, feedEnd: data.meta.feedEnd, version: data.meta.version, publisher: data.meta.publisher,
    stops: data.stops.length, routes: data.routes.length, trips: data.trips.length,
  }, null, 2));
  console.log(`Frissítve: ${data.stops.length} megálló, ${data.routes.length} vonal, ${data.trips.length} járat (${(bytes.length / 1024).toFixed(0)} KB). Érvényes: ${fmtDate(data.meta.feedStart)} – ${fmtDate(data.meta.feedEnd)}.`);
  if (feed.expiry() === 'expired') console.warn('FIGYELEM: a letöltött menetrend érvényessége már lejárt!');
  out('changed', 'true');
} catch (e) {
  console.error('HIBA:', e.message);
  process.exit(1);
} finally {
  try { rmSync(tmp, { force: true }); } catch { /* nincs */ }
}
