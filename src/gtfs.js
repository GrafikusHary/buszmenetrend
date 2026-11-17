// GTFS feldolgozó és lekérdező motor. Böngészőben és Node-ban is fut (scripts/update-gtfs.mjs is ezt használja).
import { unzipSync, strFromU8 } from 'fflate';

/* ---------- CSV ---------- */
export function parseLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { head: {}, rows: [] };
  const hdr = parseLine(lines[0]).map(s => s.trim());
  const head = {};
  hdr.forEach((h, i) => (head[h] = i));
  const rows = [];
  for (let i = 1; i < lines.length; i++) if (lines[i]) rows.push(parseLine(lines[i]));
  return { head, rows };
}

export function parseTime(s) {
  if (!s) return null;
  const p = s.trim().split(':');
  if (p.length < 2) return null;
  return (+p[0]) * 3600 + (+p[1]) * 60 + (+(p[2] || 0));
}

const need = (zip, name, optional) => {
  if (!zip[name]) {
    if (optional) return null;
    throw new Error(`Hiányzik a GTFS fájl: ${name}`);
  }
  return parseCsv(strFromU8(zip[name]));
};

/* ---------- Feldolgozás ---------- */
/**
 * @param {Uint8Array} bytes GTFS zip
 * @param {{bbox?: number[]|null}} opts bbox = [minLat, minLon, maxLat, maxLon]
 */
export function parseGtfsZip(bytes, opts = {}) {
  const zip = unzipSync(bytes);
  // "Nyíregyháza, autóbusz-állomás" -> "Autóbusz-állomás" (a város neve felesleges egy helyi menetrendben)
  const strip = opts.stripPrefix ? new RegExp('^' + opts.stripPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const clean = n => {
    n = (n || '').trim();
    if (strip && strip.test(n)) { n = n.replace(strip, ''); n = n.charAt(0).toUpperCase() + n.slice(1); }
    return n;
  };
  // egyes zip-ek almappában tartalmazzák a fájlokat
  for (const k of Object.keys(zip)) {
    const base = k.split('/').pop();
    if (base !== k && !zip[base]) zip[base] = zip[k];
  }

  /* stops */
  const S = need(zip, 'stops.txt');
  const sh = S.head;
  const stops = [];
  const stopIdx = new Map();
  const bbox = opts.bbox || null;
  for (const r of S.rows) {
    const lat = parseFloat(r[sh.stop_lat]), lon = parseFloat(r[sh.stop_lon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const lt = sh.location_type != null ? r[sh.location_type] : '';
    if (lt && lt !== '0') continue; // csak megállóhelyek (nem állomás/bejárat)
    if (bbox && (lat < bbox[0] || lon < bbox[1] || lat > bbox[2] || lon > bbox[3])) continue;
    stopIdx.set(r[sh.stop_id], stops.length);
    stops.push({
      id: r[sh.stop_id],
      name: clean(r[sh.stop_name]),
      lat, lon,
      code: sh.stop_code != null ? r[sh.stop_code] : '',
    });
  }

  /* routes */
  const R = need(zip, 'routes.txt');
  const rh = R.head;
  const routes = [];
  const routeIdx = new Map();
  for (const r of R.rows) {
    routeIdx.set(r[rh.route_id], routes.length);
    const color = rh.route_color != null && /^[0-9a-fA-F]{6}$/.test(r[rh.route_color] || '') ? '#' + r[rh.route_color] : null;
    const tcolor = rh.route_text_color != null && /^[0-9a-fA-F]{6}$/.test(r[rh.route_text_color] || '') ? '#' + r[rh.route_text_color] : null;
    routes.push({
      id: r[rh.route_id],
      short: ((rh.route_short_name != null ? r[rh.route_short_name] : '') || r[rh.route_id]).trim(),
      long: ((rh.route_long_name != null ? r[rh.route_long_name] : '') || '').trim(),
      color, text: tcolor,
    });
  }

  /* trips */
  const T = need(zip, 'trips.txt');
  const th = T.head;
  const trips = [];
  const tripIdx = new Map();
  for (const r of T.rows) {
    const ri = routeIdx.get(r[th.route_id]);
    if (ri == null) continue;
    tripIdx.set(r[th.trip_id], trips.length);
    trips.push({
      id: r[th.trip_id],
      r: ri,
      s: r[th.service_id],
      h: th.trip_headsign != null ? clean(r[th.trip_headsign]) : '',
      d: th.direction_id != null && r[th.direction_id] !== '' ? +r[th.direction_id] : -1,
      sh: th.shape_id != null ? r[th.shape_id] : '',
      st: [], at: [], dt: [],
    });
  }

  /* stop_times */
  const ST = need(zip, 'stop_times.txt');
  const sth = ST.head;
  const tmp = new Map(); // trip idx -> [[seq, stop, arr, dep]]
  for (const r of ST.rows) {
    const ti = tripIdx.get(r[sth.trip_id]);
    if (ti == null) continue;
    const si = stopIdx.get(r[sth.stop_id]);
    if (si == null) continue;
    const arr = parseTime(r[sth.arrival_time]);
    const dep = parseTime(r[sth.departure_time]);
    let a = tmp.get(ti);
    if (!a) tmp.set(ti, (a = []));
    a.push([+r[sth.stop_sequence], si, arr, dep]);
  }
  for (const [ti, a] of tmp) {
    a.sort((x, y) => x[0] - y[0]);
    const t = trips[ti];
    let prev = null;
    for (const [, si, arr, dep] of a) {
      let ar = arr, de = dep;
      if (ar == null) ar = de != null ? de : prev;
      if (de == null) de = ar;
      if (ar == null) continue; // idő nélküli (interpolálatlan) megálló kihagyva
      prev = de;
      t.st.push(si); t.at.push(ar); t.dt.push(de);
    }
  }
  const goodTrips = [];
  for (const t of trips) if (t.st.length >= 2) goodTrips.push(t);

  /* services */
  const services = {};
  const C = need(zip, 'calendar.txt', true);
  if (C) {
    const ch = C.head;
    const dn = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const r of C.rows) {
      services[r[ch.service_id]] = {
        days: dn.map(d => r[ch[d]] === '1'),
        start: +r[ch.start_date], end: +r[ch.end_date], add: [], rem: [],
      };
    }
  }
  const CD = need(zip, 'calendar_dates.txt', true);
  if (CD) {
    const dh = CD.head;
    for (const r of CD.rows) {
      const id = r[dh.service_id];
      let s = services[id];
      if (!s) s = services[id] = { days: [false, false, false, false, false, false, false], start: 0, end: 99999999, add: [], rem: [], onlyDates: true };
      (r[dh.exception_type] === '1' ? s.add : s.rem).push(+r[dh.date]);
    }
  }

  /* shapes (csak a ténylegesen használtak) */
  const used = new Set(goodTrips.map(t => t.sh).filter(Boolean));
  const shapes = {};
  const SH = need(zip, 'shapes.txt', true);
  if (SH) {
    const hh = SH.head;
    const tmpS = {};
    for (const r of SH.rows) {
      const id = r[hh.shape_id];
      if (!used.has(id)) continue;
      (tmpS[id] || (tmpS[id] = [])).push([+r[hh.shape_pt_sequence], +r[hh.shape_pt_lat], +r[hh.shape_pt_lon]]);
    }
    for (const id in tmpS) {
      tmpS[id].sort((a, b) => a[0] - b[0]);
      shapes[id] = tmpS[id].map(p => [p[1], p[2]]);
    }
  }

  /* feed info */
  const meta = { feedStart: null, feedEnd: null, publisher: '', version: '', agency: '' };
  const FI = need(zip, 'feed_info.txt', true);
  if (FI && FI.rows[0]) {
    const f = FI.head, r = FI.rows[0];
    meta.publisher = f.feed_publisher_name != null ? r[f.feed_publisher_name] : '';
    meta.version = f.feed_version != null ? r[f.feed_version] : '';
    meta.feedStart = f.feed_start_date != null && r[f.feed_start_date] ? +r[f.feed_start_date] : null;
    meta.feedEnd = f.feed_end_date != null && r[f.feed_end_date] ? +r[f.feed_end_date] : null;
  }
  const AG = need(zip, 'agency.txt', true);
  if (AG && AG.rows[0] && AG.head.agency_name != null) meta.agency = AG.rows[0][AG.head.agency_name];
  if (!meta.feedEnd) {
    let mx = 0;
    for (const id in services) { const s = services[id]; if (!s.onlyDates && s.end > mx && s.end < 99999999) mx = s.end; for (const d of s.add) if (d > mx) mx = d; }
    meta.feedEnd = mx || null;
  }
  if (!meta.feedStart) {
    let mn = 99999999;
    for (const id in services) { const s = services[id]; if (!s.onlyDates && s.start && s.start < mn) mn = s.start; }
    meta.feedStart = mn < 99999999 ? mn : null;
  }

  return { meta, stops, routes, trips: goodTrips, services, shapes };
}

/* ---------- Dátum segédek ---------- */
export const ymd = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
export const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };
export const secOfDay = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
export const fmtDate = n => n ? `${String(n).slice(0, 4)}. ${String(n).slice(4, 6)}. ${String(n).slice(6, 8)}.` : '–';

export function fmtTime(sec) {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ő/g, 'o').replace(/ű/g, 'u');
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------- Index + lekérdezések ---------- */
export class Feed {
  constructor(data) {
    this.d = data;
    this.stops = data.stops;
    this.routes = data.routes;
    this.trips = data.trips;
    this.meta = data.meta;
    this._active = new Map();
    // megálló -> [tripIdx, seq, dep] (a járat utolsó megállóját kihagyjuk: ott nem lehet felszállni)
    this.byStop = this.stops.map(() => []);
    this.trips.forEach((t, ti) => {
      for (let i = 0; i < t.st.length - 1; i++) this.byStop[t.st[i]].push([ti, i, t.dt[i]]);
    });
    this.byStop.forEach(a => a.sort((x, y) => x[2] - y[2]));
    // azonos nevű megállók (két irány) csoportosítása a kereséshez
    this.routeTrips = this.routes.map(() => []);
    this.trips.forEach((t, ti) => this.routeTrips[t.r].push(ti));
    this._stopsNorm = this.stops.map(s => norm(s.name));
    // ha minden vonal ugyanazt a színt kapta a feedben, nem használjuk (különben nem lehet megkülönböztetni őket)
    this.uniformColor = new Set(this.routes.map(r => r.color || '')).size <= 1;
  }

  activeServices(dateObj) {
    const key = ymd(dateObj);
    let set = this._active.get(key);
    if (set) return set;
    set = new Set();
    const wd = (dateObj.getDay() + 6) % 7; // hétfő = 0
    for (const id in this.d.services) {
      const s = this.d.services[id];
      let on = !s.onlyDates && s.days[wd] && key >= s.start && key <= s.end;
      if (s.rem.includes(key)) on = false;
      if (s.add.includes(key)) on = true;
      if (on) set.add(id);
    }
    this._active.set(key, set);
    return set;
  }

  /** Hasznos-e még az adat? (null = ismeretlen) */
  expiry(now = new Date()) {
    const e = this.meta.feedEnd;
    if (!e) return null;
    const t = ymd(now);
    if (t > e) return 'expired';
    const end = new Date(Math.floor(e / 10000), Math.floor(e / 100) % 100 - 1, e % 100);
    const days = Math.round((end - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return days <= 7 ? 'soon' : 'ok';
  }

  /** Legközelebbi megállók (a kétirányú, azonos nevű megállókat külön adja vissza, távolság szerint). */
  nearest(lat, lon, n = 8, maxM = 1500) {
    const arr = [];
    for (let i = 0; i < this.stops.length; i++) {
      const s = this.stops[i];
      if (!this.byStop[i].length) continue;
      const dd = haversine(lat, lon, s.lat, s.lon);
      if (dd <= maxM) arr.push({ i, dist: dd });
    }
    arr.sort((a, b) => a.dist - b.dist);
    return arr.slice(0, n);
  }

  /** Következő indulások egy (vagy több) megállóból. `at` = Date. */
  departures(stopIdxs, at = new Date(), limit = 12, opts = {}) {
    const list = Array.isArray(stopIdxs) ? stopIdxs : [stopIdxs];
    const now = secOfDay(at);
    const out = [];
    for (const off of [-1, 0, 1]) {
      const day = addDays(at, off);
      const act = this.activeServices(day);
      const shift = off * 86400; // a nap éjfélétől mért másodperc: dep + shift (a mai napra normalizálva)
      for (const si of list) {
        for (const [ti, seq, dep] of this.byStop[si]) {
          const t = this.trips[ti];
          if (!act.has(t.s)) continue;
          if (opts.route != null && t.r !== opts.route) continue;
          const when = dep + shift; // mai éjfélhez képest
          if (when < now - 30) continue;
          if (when > now + (opts.windowMin || 24 * 60) * 60) continue;
          out.push({ ti, seq, stop: si, when, wait: when - now, route: t.r, head: this.headsign(t), date: ymd(day) });
        }
      }
    }
    out.sort((a, b) => a.when - b.when);
    return out.slice(0, limit);
  }

  /** Vonalszín (null, ha a feed nem ad megkülönböztető színt). */
  color(ri) { return this.uniformColor ? null : this.routes[ri].color; }

  headsign(t) {
    if (t.h) return t.h;
    return this.stops[t.st[t.st.length - 1]].name;
  }

  /** Egy járat (trip) megállói idővel. */
  tripStops(ti) {
    const t = this.trips[ti];
    return t.st.map((si, i) => ({ si, stop: this.stops[si], arr: t.at[i], dep: t.dt[i] }));
  }

  tripShape(ti) {
    const t = this.trips[ti];
    const sh = t.sh && this.d.shapes[t.sh];
    if (sh && sh.length > 1) return sh;
    return t.st.map(si => [this.stops[si].lat, this.stops[si].lon]);
  }

  /** Járatok keresése (rövid név, hosszú név, célállomás). */
  searchRoutes(q) {
    const nq = norm(q).trim();
    const res = this.routes.map((r, i) => ({ r, i }));
    const filtered = nq
      ? res.filter(({ r }) => norm(r.short) === nq || norm(r.short).startsWith(nq) || norm(r.long).includes(nq))
      : res;
    const natural = (a, b) => a.r.short.localeCompare(b.r.short, 'hu', { numeric: true });
    return filtered.filter(x => this.routeTrips[x.i].length).sort(natural);
  }

  searchStops(q, limit = 20) {
    const nq = norm(q).trim();
    if (!nq) return [];
    const seen = new Set(), out = [];
    this.stops.forEach((s, i) => {
      if (!this._stopsNorm[i].includes(nq) || !this.byStop[i].length) return;
      out.push(i);
    });
    return out.slice(0, limit);
  }

  /** Egy vonal irányonkénti jellemző megállósorai (leggyakoribb mintázat irányonként). */
  routePatterns(ri) {
    const map = new Map();
    for (const ti of this.routeTrips[ri]) {
      const t = this.trips[ti];
      const key = t.st.join(',');
      let p = map.get(key);
      if (!p) map.set(key, (p = { key, ti, n: 0, head: this.headsign(t), from: this.stops[t.st[0]].name, to: this.stops[t.st[t.st.length - 1]].name, stops: t.st }));
      p.n++;
    }
    const pats = [...map.values()].sort((a, b) => b.n - a.n);
    // csoportosítás kiinduló–cél pár szerint, a leggyakoribb a "fő" változat
    const byDir = new Map();
    for (const p of pats) {
      const k = p.from + '→' + p.to;
      if (!byDir.has(k)) byDir.set(k, p);
    }
    return [...byDir.values()];
  }

  /** A mai napon induló járatok egy vonal adott mintázatán. */
  routeDeparturesToday(ri, pattern, at = new Date()) {
    const act = this.activeServices(at);
    return this.routeTrips[ri]
      .filter(ti => act.has(this.trips[ti].s) && this.trips[ti].st.join(',') === pattern.key)
      .map(ti => ({ ti, t: this.trips[ti].dt[0] }))
      .sort((a, b) => a.t - b.t);
  }
}
