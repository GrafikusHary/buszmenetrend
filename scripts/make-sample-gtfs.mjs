// DEMÓ GTFS generátor: kitalált menetrend, csak az app kipróbálására (NEM valós adat!).
// Használat: node scripts/make-sample-gtfs.mjs   → public/data/gtfs.zip + meta.json
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const L = {
  BUSZ: ['Autóbusz-állomás', 47.9499, 21.7045],
  KOSSUTH: ['Kossuth tér', 47.9556, 21.7160],
  VASUT: ['Vasútállomás', 47.9610, 21.7060],
  SOSTO: ['Sóstógyógyfürdő', 47.9930, 21.7540],
  KORHAZ: ['Sóstói úti kórház', 47.9750, 21.7390],
  OROK: ['Örökösföld', 47.9510, 21.7440],
  BORB: ['Borbánya', 47.9260, 21.7300],
  IPAR: ['Ipari park', 47.9300, 21.6700],
};
const routes = [
  { id: 'R1', short: '1', long: 'Autóbusz-állomás – Örökösföld', color: '0B5D4B', pts: ['BUSZ', 'KOSSUTH', 'OROK'], hw: 20 },
  { id: 'R2', short: '2', long: 'Autóbusz-állomás – Borbánya', color: 'B5451B', pts: ['BUSZ', 'BORB'], hw: 20 },
  { id: 'R8', short: '8', long: 'Vasútállomás – Sóstógyógyfürdő', color: '1F5FA8', pts: ['VASUT', 'KOSSUTH', 'KORHAZ', 'SOSTO'], hw: 20 },
  { id: 'R12', short: '12', long: 'Vasútállomás – Ipari park', color: '7A3FA0', pts: ['VASUT', 'BUSZ', 'IPAR'], hw: 30 },
  { id: 'R20', short: '20', long: 'Örökösföld – Sóstói úti kórház', color: 'C48A00', pts: ['OROK', 'KORHAZ'], hw: 30 },
];

const stops = new Map(); // key -> {id,name,lat,lon}
let sn = 0;
const stopFor = (key, name, lat, lon) => {
  if (!stops.has(key)) stops.set(key, { id: 'S' + String(++sn).padStart(3, '0'), name, lat, lon });
  return stops.get(key);
};
const dist = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

let shapes = [], tripsOut = [], stopTimes = [];
for (const r of routes) {
  // útvonal: nevezetes pontok + közbenső megállók ~450 m-enként
  const seq = []; // [stop, [lat,lon]]
  for (let i = 0; i < r.pts.length; i++) {
    const [nm, la, lo] = L[r.pts[i]];
    seq.push(stopFor('L' + r.pts[i], nm, la, lo));
    if (i < r.pts.length - 1) {
      const [, la2, lo2] = L[r.pts[i + 1]];
      const n = Math.max(1, Math.round(dist([la, lo], [la2, lo2]) / 450));
      for (let k = 1; k < n; k++) {
        const f = k / n;
        const lat = la + (la2 - la) * f, lon = lo + (lo2 - lo) * f;
        // kis oldalirányú eltérés, hogy ne legyen mereven egyenes
        const wob = Math.sin(k * 1.7 + r.short.length) * 0.0008;
        seq.push(stopFor(`${r.id}-${i}-${k}`, `Demó ${r.short}/${i + 1}.${k} megálló`, lat + wob, lon - wob));
      }
    }
  }
  for (const dir of [0, 1]) {
    const s = dir ? [...seq].reverse() : seq;
    const shapeId = `SH_${r.id}_${dir}`;
    s.forEach((st, i) => shapes.push([shapeId, st.lat, st.lon, i + 1]));
    const head = s[s.length - 1].name;
    // menetidők
    const off = [0];
    for (let i = 1; i < s.length; i++) off.push(off[i - 1] + dist([s[i - 1].lat, s[i - 1].lon], [s[i].lat, s[i].lon]) / (18 / 3.6) + 20);
    for (const [svc, hw, from, to] of [['WD', r.hw, 5 * 60, 22 * 60], ['WE', r.hw * 2, 6 * 60, 21 * 60]]) {
      let n = 0;
      for (let m = from + (dir ? Math.round(r.hw / 2) : 0); m <= to; m += hw) {
        const tid = `${r.id}_${dir}_${svc}_${n++}`;
        tripsOut.push([r.id, svc, tid, head, dir, shapeId]);
        s.forEach((st, i) => {
          const t = m * 60 + Math.round(off[i]);
          const fmt = x => `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
          stopTimes.push([tid, fmt(t), fmt(t), st.id, i + 1]);
        });
      }
    }
  }
}

const now = new Date();
const d = (off) => { const x = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off); return x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate(); };
const csv = rows => rows.map(r => r.map(c => (String(c).includes(',') || String(c).includes('"') ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\n') + '\n';

const files = {
  'agency.txt': csv([['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], ['DEMO', 'DEMÓ – nem valós menetrend', 'https://example.com', 'Europe/Budapest']]),
  'feed_info.txt': csv([['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version'], ['DEMÓ adat', 'https://example.com', 'hu', d(-30), d(150), 'demo-' + d(0)]]),
  'stops.txt': csv([['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], ...[...stops.values()].map(s => [s.id, s.name, s.lat.toFixed(6), s.lon.toFixed(6)])]),
  'routes.txt': csv([['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'], ...routes.map(r => [r.id, 'DEMO', r.short, r.long, 3, r.color, 'FFFFFF'])]),
  'trips.txt': csv([['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'], ...tripsOut]),
  'stop_times.txt': csv([['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], ...stopTimes]),
  'calendar.txt': csv([['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    ['WD', 1, 1, 1, 1, 1, 0, 0, d(-30), d(150)], ['WE', 0, 0, 0, 0, 0, 1, 1, d(-30), d(150)]]),
  'shapes.txt': csv([['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], ...shapes.map(([i, la, lo, q]) => [i, la.toFixed(6), lo.toFixed(6), q])]),
};
const zipFiles = {};
for (const k in files) zipFiles[k] = strToU8(files[k]);
const zip = zipSync(zipFiles, { level: 6 });
const out = join(root, 'public', 'data');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'gtfs.zip'), zip);
writeFileSync(join(out, 'meta.json'), JSON.stringify({
  builtAt: Date.now(), demo: true, source: 'demo-generator', sha256: createHash('sha256').update(zip).digest('hex'),
  feedStart: d(-30), feedEnd: d(150),
}, null, 2));
console.log(`DEMÓ GTFS kész: ${stops.size} megálló, ${tripsOut.length} járat, ${(zip.length / 1024).toFixed(0)} KB`);
