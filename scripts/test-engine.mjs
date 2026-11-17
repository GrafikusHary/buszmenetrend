// Gyors önellenőrzés a public/data/gtfs.zip adaton: node scripts/test-engine.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseGtfsZip, Feed, parseTime, fmtTime } from '../src/gtfs.js';
const cfg = JSON.parse(readFileSync(new URL('../public/data/config.json', import.meta.url), 'utf8'));
const d = parseGtfsZip(new Uint8Array(readFileSync(new URL('../public/data/gtfs.zip', import.meta.url))), { stripPrefix: cfg.stripPrefix });
const f = new Feed(d);
assert.equal(parseTime('25:10:00'), 90600); assert.equal(fmtTime(90600), '01:10');
assert.ok(d.stops.length > 5 && d.trips.length > 10, 'van megálló és járat');
// találjunk egy hétköznapot a feed érvényességén belül
const start = String(d.meta.feedStart || '');
const base = start ? new Date(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8), 9, 0, 0) : new Date();
let wd = base; while ([0, 6].includes(wd.getDay())) wd = new Date(wd.getTime() + 86400000);
// a legforgalmasabb megálló
let best = 0; f.byStop.forEach((a, i) => { if (a.length > f.byStop[best].length) best = i; });
const dep = f.departures(best, wd, 5);
assert.ok(dep.length === 5 && dep.every((x, i) => i === 0 || x.when >= dep[i - 1].when), 'indulások időrendben');
assert.ok(dep[0].when >= 9 * 3600 - 30, 'csak a jövőbeli indulások');
assert.ok(f.nearest(f.stops[best].lat, f.stops[best].lon, 3)[0].dist < 1);
assert.ok(f.searchRoutes(f.routes[0].short).length >= 1, 'járatkeresés');
const nm = f.stops[best].name; assert.ok(f.searchStops(nm.toUpperCase().slice(0, 6)).length >= 1, 'megállókeresés (ékezet/kisbetű független)');
assert.ok(!/^Nyíregyháza, /.test(nm), 'városnév-előtag eltávolítva');
console.log(`OK – ${d.stops.length} megálló, ${d.routes.length} vonal, ${d.trips.length} járat; minden teszt lefutott.`);
