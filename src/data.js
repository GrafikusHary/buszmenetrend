// Adattárolás (IndexedDB), betöltés, frissítés (URL / fájl), automatikus frissítés.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { parseGtfsZip, Feed, ymd } from './gtfs.js';

/* ---------- IndexedDB ---------- */
const DB = 'nyirbusz', STORE = 'kv';
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/* ---------- Beállítások (localStorage) ---------- */
const LS = 'nyirbusz.settings';
export const settings = {
  get() {
    try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; }
  },
  set(patch) {
    localStorage.setItem(LS, JSON.stringify({ ...this.get(), ...patch }));
  },
};

/* ---------- Segédek ---------- */
async function sha256(bytes) {
  try {
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return 'len-' + bytes.length; }
}
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

async function fetchBundledConfig() {
  try { const r = await fetch('data/config.json', { cache: 'no-store' }); return r.ok ? await r.json() : {}; } catch { return {}; }
}
export async function bundledConfig() { return fetchBundledConfig(); }

export async function downloadBytes(url) {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, responseType: 'arraybuffer', connectTimeout: 30000, readTimeout: 120000 });
    if (r.status >= 400) throw new Error(`Letöltési hiba (HTTP ${r.status})`);
    return typeof r.data === 'string' ? b64ToBytes(r.data) : new Uint8Array(r.data);
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Letöltési hiba (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ---------- Betöltés ---------- */
let current = null; // {feed, info}
export const getCurrent = () => current;

async function persist(data, info) {
  await kvSet('feed', { data, info });
  current = { feed: new Feed(data), info };
  return current;
}

/** Induláskor: tárolt adat, vagy (ha újabb) a csomagolt adat. */
export async function loadInitial() {
  let bundledMeta = null;
  try { const r = await fetch('data/meta.json', { cache: 'no-store' }); if (r.ok) bundledMeta = await r.json(); } catch { /* nincs */ }
  let stored = null;
  try { stored = await kvGet('feed'); } catch { /* sérült db */ }

  const bundledNewer = bundledMeta && (!stored || (bundledMeta.builtAt || 0) > (stored.info.loadedAt || 0));
  if (stored && !bundledNewer) {
    current = { feed: new Feed(stored.data), info: stored.info };
    return current;
  }
  let bytes;
  const r = await fetch('data/gtfs.zip', { cache: 'no-store' }).catch(() => null);
  if (r && r.ok) { const b = new Uint8Array(await r.arrayBuffer()); if (b[0] === 0x50 && b[1] === 0x4b) bytes = b; }
  if (!bytes) {
    // tartalék: base64-be csomagolt változat (olyan tárhelyekhez, ahol a .zip nem szolgálható ki)
    const j = await fetch('data/gtfs.zip.json', { cache: 'no-store' }).then(x => (x.ok ? x.json() : null)).catch(() => null);
    if (!j) throw new Error('A csomagolt menetrend (data/gtfs.zip) nem található.');
    bytes = b64ToBytes(j.b64);
  }
  const cfg = await fetchBundledConfig();
  const data = parseGtfsZip(bytes, { bbox: cfg.bbox, stripPrefix: cfg.stripPrefix });
  return persist(data, {
    source: 'bundled', demo: !!(bundledMeta && bundledMeta.demo), loadedAt: Date.now(),
    sha256: (bundledMeta && bundledMeta.sha256) || (await sha256(bytes)), lastCheck: 0,
  });
}

/* ---------- Frissítés ---------- */
async function applyBytes(bytes, source, url) {
  const cfg = await fetchBundledConfig();
  const hash = await sha256(bytes);
  if (current && current.info.sha256 === hash && source !== 'file') {
    current.info.lastCheck = Date.now();
    await kvSet('feed', { data: current.feed.d, info: current.info });
    return { changed: false, current };
  }
  let data;
  try { data = parseGtfsZip(bytes, { bbox: cfg.bbox, stripPrefix: cfg.stripPrefix }); }
  catch (e) { throw new Error('A fájl nem érvényes GTFS (.zip) csomag – ' + (e.message || e)); }
  if (!data.stops.length || !data.trips.length) throw new Error('A fájl nem tartalmaz használható megállót/járatot.');
  const feed = new Feed(data);
  const exp = feed.expiry();
  const info = { source, url: url || '', demo: false, loadedAt: Date.now(), lastCheck: Date.now(), sha256: hash };
  await persist(data, info);
  return { changed: true, current, expired: exp === 'expired' };
}

export async function updateFromUrl(url) {
  if (!url) throw new Error('Nincs megadva GTFS letöltési cím.');
  if (/public-gtfs\/volanbusz_gtfs/i.test(url)) throw new Error('Ez az országos Volánbusz-fájl (~100 MB), telefonon nem dolgozható fel. Használd a szűrt, nyíregyházi csomag címét (lásd README).');
  const bytes = await downloadBytes(url);
  return applyBytes(bytes, 'downloaded', url);
}

export async function updateFromFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return applyBytes(bytes, 'file', '');
}

/** Automatikus frissítés: ha van beállított URL és letelt az intervallum (vagy a menetrend lejárt/közel a lejárathoz). */
export async function autoUpdateIfDue() {
  const s = settings.get();
  const cfg = await fetchBundledConfig();
  const url = s.gtfsUrl || cfg.appUpdateUrl;
  if (!url || s.autoUpdate === false || !current) return null;
  const days = s.autoUpdateDays || cfg.autoUpdateDays || 3;
  const due = Date.now() - (current.info.lastCheck || 0) > days * 86400000;
  const exp = current.feed.expiry();
  if (!due && exp !== 'expired' && exp !== 'soon') return null;
  // lejárat közelében legfeljebb naponta próbálkozunk
  if (!due && Date.now() - (current.info.lastCheck || 0) < 86400000) return null;
  try {
    return await updateFromUrl(url);
  } catch (e) {
    current.info.lastCheck = Date.now();
    kvSet('feed', { data: current.feed.d, info: current.info }).catch(() => {});
    return { error: e.message };
  }
}

export { ymd };
