// Memóriatakarékos (streamelő) GTFS szűrő: az országos Volánbusz feedből csak egy szolgáltató (pl. Nyíregyháza) adatait tartja meg.
// Az országos zip ~100 MB / ~480 MB kicsomagolva, ezért soronként dolgozik, és nem tölti be egészben a memóriába.
import { createReadStream } from 'node:fs';
import { Unzip, UnzipInflate, zipSync, strToU8 } from 'fflate';
import { parseLine } from '../src/gtfs.js';

/** Végigolvassa a zipet; pick(baseName) -> null (kihagy) vagy {line(str), end()} */
function scan(zipPath, pick) {
  return new Promise((resolve, reject) => {
    const uz = new Unzip();
    uz.register(UnzipInflate);
    uz.onfile = f => {
      const sink = pick(f.name.split('/').pop());
      if (!sink) return;
      const dec = new TextDecoder('utf-8');
      let carry = '';
      f.ondata = (err, chunk, final) => {
        if (err) return reject(err);
        carry += dec.decode(chunk, { stream: !final });
        let start = 0, i;
        while ((i = carry.indexOf('\n', start)) !== -1) {
          sink.line(carry.slice(start, i).replace(/\r$/, ''));
          start = i + 1;
        }
        carry = carry.slice(start);
        if (final) { if (carry) sink.line(carry.replace(/\r$/, '')); sink.end(); }
      };
      f.start();
    };
    const rs = createReadStream(zipPath, { highWaterMark: 1 << 20 });
    rs.on('data', c => { try { uz.push(new Uint8Array(c.buffer, c.byteOffset, c.length), false); } catch (e) { rs.destroy(); reject(e); } });
    rs.on('end', () => { try { uz.push(new Uint8Array(0), true); resolve(); } catch (e) { reject(e); } });
    rs.on('error', reject);
  });
}

/** CSV-sink: fejléc alapján kulcsoszlop(ok), keep(rowFn) eldönti a megtartást; a megtartott sorokat gyűjti. */
function csvSink(keyCols, keep, out) {
  let idx = null, header = null;
  return {
    line(l) {
      if (!l) return;
      if (!header) {
        header = l.replace(/^﻿/, '');
        const cols = parseLine(header).map(s => s.trim());
        idx = keyCols.map(k => cols.indexOf(k));
        out.header = header; out.cols = cols;
        return;
      }
      const f = l.indexOf('"') === -1 ? l.split(',') : parseLine(l);
      const keys = idx.map(i => (i >= 0 ? f[i] : undefined));
      if (keep(keys, f)) out.lines.push(l);
    },
    end() {},
  };
}
const newOut = () => ({ header: '', lines: [], cols: [] });
const toText = o => (o.header ? o.header + '\n' + o.lines.join('\n') + (o.lines.length ? '\n' : '') : '');

/**
 * @param {string} zipPath országos GTFS zip
 * @param {{agencyMatch?: string, agencyId?: string}} opt  agencyMatch: reguláris kifejezés az agency_name-re
 * @returns {Promise<Uint8Array>} szűrt GTFS zip
 */
export async function filterGtfs(zipPath, opt) {
  const re = opt.agencyMatch ? new RegExp(opt.agencyMatch, 'i') : null;
  const log = opt.log || (() => {});

  // 1) szolgáltatók
  const ag = newOut(); const agencyIds = new Set();
  await scan(zipPath, n => n === 'agency.txt' ? csvSink(['agency_id', 'agency_name'], ([id, name]) => {
    const ok = (opt.agencyId && id === opt.agencyId) || (re && re.test(name || ''));
    if (ok) agencyIds.add(id);
    return ok;
  }, ag) : null);
  if (!agencyIds.size) throw new Error('Nem található a megadott szolgáltató (agencyMatch/agencyId) az agency.txt-ben.');
  log(`Szolgáltató(k): ${[...agencyIds].join(', ')}`);

  // 2) vonalak
  const rt = newOut(); const routeIds = new Set();
  await scan(zipPath, n => n === 'routes.txt' ? csvSink(['agency_id', 'route_id'], ([a, r]) => { if (agencyIds.has(a)) { routeIds.add(r); return true; } return false; }, rt) : null);
  log(`Vonalak: ${routeIds.size}`);

  // 3) járatok
  const tr = newOut(); const tripIds = new Set(), serviceIds = new Set(), shapeIds = new Set();
  const tcols = () => tr.cols;
  await scan(zipPath, n => n === 'trips.txt' ? csvSink(['route_id', 'trip_id', 'service_id', 'shape_id'], ([r, t, s, sh]) => {
    if (!routeIds.has(r)) return false;
    tripIds.add(t); serviceIds.add(s); if (sh) shapeIds.add(sh); return true;
  }, tr) : null);
  void tcols;
  log(`Járatok: ${tripIds.size}`);

  // 4) menetidők
  const st = newOut(); const stopIds = new Set();
  await scan(zipPath, n => n === 'stop_times.txt' ? csvSink(['trip_id', 'stop_id'], ([t, s]) => { if (tripIds.has(t)) { stopIds.add(s); return true; } return false; }, st) : null);
  log(`Menetidő sorok: ${st.lines.length}, megállók: ${stopIds.size}`);

  // 5) a többi fájl
  const stops = newOut(), cal = newOut(), cd = newOut(), sh = newOut(); let fi = '';
  await scan(zipPath, n => {
    if (n === 'stops.txt') return csvSink(['stop_id', 'parent_station'], ([id]) => stopIds.has(id), stops);
    if (n === 'calendar.txt') return csvSink(['service_id'], ([s]) => serviceIds.has(s), cal);
    if (n === 'calendar_dates.txt') return csvSink(['service_id'], ([s]) => serviceIds.has(s), cd);
    if (n === 'shapes.txt') return csvSink(['shape_id'], ([s]) => shapeIds.has(s), sh);
    if (n === 'feed_info.txt') return { line: l => { fi += l + '\n'; }, end() {} };
    return null;
  });
  log(`Megállók: ${stops.lines.length}, forma-pontok: ${sh.lines.length}`);

  const files = {
    'agency.txt': strToU8(toText(ag)), 'routes.txt': strToU8(toText(rt)), 'trips.txt': strToU8(toText(tr)),
    'stop_times.txt': strToU8(toText(st)), 'stops.txt': strToU8(toText(stops)), 'calendar.txt': strToU8(toText(cal)),
    'calendar_dates.txt': strToU8(toText(cd)), 'shapes.txt': strToU8(toText(sh)),
  };
  if (fi) files['feed_info.txt'] = strToU8(fi);
  for (const k of Object.keys(files)) if (!files[k].length) delete files[k];
  return zipSync(files, { level: 9 });
}
