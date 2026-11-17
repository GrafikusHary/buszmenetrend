// Felület: fülek (Közelben, Térkép, Járatok, Beállítások) + részletező oldalak
import { settings, getCurrent, updateFromUrl, updateFromFile, bundledConfig, autoUpdateIfDue } from './data.js';
import { fmtTime, secOfDay, fmtDate, haversine, norm } from './gtfs.js';
import * as geo from './geo.js';
import { TICKET_APP, openTicketApp } from './tickets.js';
import { Capacitor } from '@capacitor/core';
import { makeMap, drawTrip, stopMarker, userIcon, L, NYIREGYHAZA } from './map.js';

/* ---------- segédek ---------- */
const F = () => getCurrent().feed;
const INFO = () => getCurrent().info;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  bus: '<rect x="4" y="3.5" width="16" height="14" rx="3"/><path d="M4 11h16M8 21v-3.5M16 21v-3.5"/><circle cx="8.2" cy="14.2" r=".9" fill="currentColor"/><circle cx="15.8" cy="14.2" r=".9" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 5v4h4M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2-6 3 1.5V21M11 15l-1.5-5 3.5-1.5 2 3 3 1M9.5 10 7 12"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  ticket: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
};
const icon = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0.5;
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function badge(ri, big = false) {
  const f = F(), r = f.routes[ri], own = f.color(ri);
  const bg = own || '#ffc83d';
  const fg = own ? (r.text && Math.abs(lum(bg) - lum(r.text)) > 0.3 ? r.text : (lum(bg) > 0.4 ? '#14231f' : '#fff')) : '#14231f';
  return `<span class="badge${big ? ' big' : ''}" style="background:${bg};color:${fg}">${esc(r.short)}</span>`;
}
function waitParts(sec) {
  if (sec < 45) return { big: 'most', unit: '' };
  const m = Math.round(sec / 60);
  if (m < 60) return { big: String(m), unit: 'perc' };
  return { big: `${Math.floor(m / 60)} ó ${m % 60} p`, unit: '' };
}
const dayLabel = when => (when >= 86400 ? ' · holnap' : '');
const dist = m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const walkMin = m => Math.max(1, Math.round(m / 75));

function depRow(d, { showStop = false } = {}) {
  const f = F(), p = waitParts(d.wait);
  return `<button class="dep" data-ti="${d.ti}" data-seq="${d.seq}" data-when="${d.when}" data-stop="${d.stop}">
    ${badge(d.route)}
    <span class="dep-main"><b>${esc(d.head)}</b>${showStop ? `<small>${esc(f.stops[d.stop].name)}</small>` : ''}</span>
    <span class="dep-time ${d.wait < 45 ? 'now' : ''}"><b>${p.big}</b>${p.unit ? `<small>${p.unit}</small>` : `<small>${fmtTime(d.when)}</small>`}</span>
    <span class="dep-clock">${fmtTime(d.when)}${dayLabel(d.when)}</span>
  </button>`;
}

/** Azonos nevű, 250 m-en belüli megállóhelyek (pl. autóbusz-állomás kocsiállásai). */
function groupOf(si) {
  const f = F(), s = f.stops[si], nm = s.name.toLowerCase(), out = [si];
  f.stops.forEach((o, i) => { if (i !== si && f.byStop[i].length && o.name.toLowerCase() === nm && haversine(s.lat, s.lon, o.lat, o.lon) < 250) out.push(i); });
  return out;
}

/* ---------- navigáció ---------- */
const stack = [];
let pagesEl, tabsEl, tabViews = {}, activeTab = 'near';

export function push(view) {
  view.el.classList.add('page');
  pagesEl.appendChild(view.el);
  stack.push(view);
  requestAnimationFrame(() => { view.el.classList.add('in'); view.mount && view.mount(); });
}
export function pop() {
  const v = stack.pop();
  if (!v) return false;
  v.el.classList.remove('in');
  setTimeout(() => { v.destroy && v.destroy(); v.el.remove(); }, 230);
  return true;
}
export function handleBack() {
  if (pop()) return true;
  if (activeTab !== 'near') { showTab('near'); return true; }
  return false;
}

function pageShell(title, subtitleHtml = '', extra = '') {
  const el = document.createElement('section');
  el.innerHTML = `<header class="top page-top"><button class="icon-btn back" aria-label="Vissza">${icon('back')}</button><div class="grow"><h1>${title}</h1>${subtitleHtml ? `<p>${subtitleHtml}</p>` : ''}</div>${extra}</header><div class="page-body"></div>`;
  $('.back', el).onclick = () => pop();
  return el;
}

/* =========================================================
   Járat (trip) nézet – térképes útvonal + megállólista
   ========================================================= */
export function openTrip(ti, { seq = null, when = null, user = geo.lastPos } = {}) {
  const f = F(), t = f.trips[ti], r = f.routes[t.r];
  const stops = f.tripStops(ti);
  const head = f.headsign(t);
  const el = pageShell(`${badge(t.r, true)} <span class="ttl">${esc(head)}</span>`, esc(r.long || ''));
  const body = $('.page-body', el);
  const boardStop = seq != null ? stops[seq] : null;
  body.innerHTML = `
    <div id="tmap" class="tmap"></div>
    <div class="sheet">
      <div id="tinfo"></div>
      <ol class="stops" id="tstops"></ol>
    </div>`;
  const infoEl = $('#tinfo', el), listEl = $('#tstops', el);

  function render() {
    const now = secOfDay(new Date());
    if (boardStop && when != null) {
      const wait = when - now, p = waitParts(wait);
      const lastArr = stops[stops.length - 1].arr + (when - boardStop.dep);
      infoEl.innerHTML = `<div class="trip-hero"><div class="count"><b>${p.big}</b><small>${p.unit || fmtTime(when)}</small></div>
        <div class="trip-from"><span class="lbl">Honnan</span><b>${esc(boardStop.stop.name)}</b>
        ${user ? `<span class="muted">${icon('walk', 'sm')} ${dist(haversine(user.lat, user.lon, boardStop.stop.lat, boardStop.stop.lon))} · kb. ${walkMin(haversine(user.lat, user.lon, boardStop.stop.lat, boardStop.stop.lon))} perc séta</span>` : ''}</div>
        <div class="trip-to"><span class="lbl">Hová</span><b>${esc(head)}</b><span class="muted">érkezés ${fmtTime(lastArr)}${dayLabel(lastArr)}</span></div></div>`;
    } else {
      infoEl.innerHTML = `<div class="trip-hero simple"><div class="trip-from"><span class="lbl">Indul</span><b>${esc(stops[0].stop.name)} · ${fmtTime(stops[0].dep)}</b></div><div class="trip-to"><span class="lbl">Végállomás</span><b>${esc(head)} · ${fmtTime(stops[stops.length - 1].arr)}</b></div></div>`;
    }
    const startI = seq != null ? 0 : 0;
    listEl.innerHTML = stops.map((s, i) => {
      const cls = [i < (seq || 0) ? 'past' : '', i === seq ? 'board' : '', i === stops.length - 1 ? 'end' : ''].join(' ');
      const shift = boardStop && when != null ? when - boardStop.dep : 0;
      const tm = (boardStop && when != null) ? s.arr + shift : s.arr;
      return `<li class="${cls}" data-si="${s.si}"><i class="dot" style="--c:${f.color(t.r) || 'var(--accent)'}"></i><span class="nm">${esc(s.stop.name)}</span><span class="tm">${fmtTime(tm)}</span></li>`;
    }).join('');
    void startI;
  }
  render();
  listEl.onclick = e => { const li = e.target.closest('li'); if (li) openStop(+li.dataset.si); };

  let map, drawn;
  const view = {
    el,
    mount() {
      map = makeMap($('#tmap', el));
      drawn = drawTrip(map, f, ti, { boardSeq: seq, user, onStop: si => openStop(si) });
      setTimeout(() => { map.invalidateSize(); drawn.fit(); }, 260);
    },
    tick: render,
    destroy() { map && map.remove(); },
  };
  push(view);
}

/* =========================================================
   Megálló nézet
   ========================================================= */
export function openStop(siArg, { routeFilter = null } = {}) {
  const f = F();
  const group = Array.isArray(siArg) ? siArg : [siArg];
  const si = group[0], s = f.stops[si];
  const user = geo.lastPos;
  const d0 = user ? haversine(user.lat, user.lon, s.lat, s.lon) : null;
  const el = pageShell(esc(s.name), d0 != null ? `${icon('walk', 'sm')} ${dist(d0)} · kb. ${walkMin(d0)} perc séta` : (s.code ? 'Kód: ' + esc(s.code) : ''));
  const body = $('.page-body', el);
  body.innerHTML = `<div id="smap" class="tmap short"></div><div class="sheet"><div id="chips" class="chips"></div><div id="deps" class="deplist"></div></div>`;
  let filter = routeFilter;

  function render() {
    const now = new Date();
    const all = f.departures(group, now, 60);
    const present = [...new Set(all.map(d => d.route))].sort((a, b) => f.routes[a].short.localeCompare(f.routes[b].short, 'hu', { numeric: true }));
    $('#chips', el).innerHTML = present.length > 1
      ? `<button class="chip ${filter == null ? 'on' : ''}" data-r="">Mind</button>` + present.map(r => `<button class="chip ${filter === r ? 'on' : ''}" data-r="${r}">${esc(f.routes[r].short)}</button>`).join('')
      : '';
    const list = (filter == null ? all : all.filter(d => d.route === filter)).slice(0, 30);
    $('#deps', el).innerHTML = list.length ? list.map(d => depRow(d)).join('') : '<p class="empty">A következő 24 órában nincs indulás ebből a megállóból.</p>';
  }
  render();
  el.onclick = e => {
    const c = e.target.closest('.chip'); if (c) { filter = c.dataset.r === '' ? null : +c.dataset.r; render(); return; }
    const d = e.target.closest('.dep'); if (d) openTrip(+d.dataset.ti, { seq: +d.dataset.seq, when: +d.dataset.when });
  };
  let map;
  push({
    el, tick: render,
    mount() {
      map = makeMap($('#smap', el), { center: [s.lat, s.lon], zoom: 16 });
      group.forEach(g => stopMarker(f.stops[g], { r: 9, fill: '#ffc83d', color: '#14231f', weight: 4 }).addTo(map));
      // közeli többi megálló
      f.stops.forEach((o, i) => { if (!group.includes(i) && f.byStop[i].length && haversine(s.lat, s.lon, o.lat, o.lon) < 350) stopMarker(o, { r: 4, color: '#0b5d4b', weight: 2 }).addTo(map).bindTooltip(o.name).on('click', () => openStop(i)); });
      if (user) { L.marker([user.lat, user.lon], { icon: userIcon(), interactive: false }).addTo(map); map.fitBounds([[s.lat, s.lon], [user.lat, user.lon]], { padding: [40, 40], maxZoom: 17 }); }
      setTimeout(() => map.invalidateSize(), 260);
    },
    destroy() { map && map.remove(); },
  });
}

/* =========================================================
   Vonal (járat) nézet
   ========================================================= */
export function openRoute(ri, patIdx = 0) {
  const f = F(), r = f.routes[ri];
  const pats = f.routePatterns(ri);
  const el = pageShell(`${badge(ri, true)} <span class="ttl">${esc(r.long || 'Járat ' + r.short)}</span>`);
  const body = $('.page-body', el);
  body.innerHTML = `<div id="rmap" class="tmap"></div><div class="sheet"><div id="dirs" class="chips dirs"></div><div id="times" class="times"></div><ol class="stops" id="rstops"></ol></div>`;
  let cur = Math.min(patIdx, pats.length - 1), map, layer;

  function drawMap() {
    if (!map) return;
    if (layer) layer.group.remove();
    layer = drawTrip(map, f, pats[cur].ti, { onStop: si => openStop(si) });
    layer.fit();
  }
  function render() {
    const p = pats[cur];
    $('#dirs', el).innerHTML = pats.map((q, i) => `<button class="chip dir ${i === cur ? 'on' : ''}" data-i="${i}">${esc(q.from)} ${icon('arrow', 'sm')} ${esc(q.to)}</button>`).join('');
    const nowS = secOfDay(new Date());
    const today = f.routeDeparturesToday(ri, p);
    const nextI = today.findIndex(x => x.t >= nowS);
    $('#times', el).innerHTML = today.length
      ? `<div class="times-h">Mai indulások · ${esc(p.from)}</div><div class="timechips">${today.map((x, i) => `<button class="tc ${i === nextI ? 'next' : ''} ${x.t < nowS ? 'gone' : ''}" data-ti="${x.ti}" data-when="${x.t}">${fmtTime(x.t)}</button>`).join('')}</div>`
      : '<p class="empty">Ma nem közlekedik ezen az irányon.</p>';
    const trip = f.tripStops(p.ti);
    $('#rstops', el).innerHTML = trip.map((s, i) => `<li class="${i === trip.length - 1 ? 'end' : ''}" data-si="${s.si}"><i class="dot" style="--c:${f.color(ri) || 'var(--accent)'}"></i><span class="nm">${esc(s.stop.name)}</span><span class="tm">+${Math.round((s.arr - trip[0].dep) / 60)}′</span></li>`).join('');
  }
  render();
  el.onclick = e => {
    const c = e.target.closest('.dir'); if (c) { cur = +c.dataset.i; render(); drawMap(); return; }
    const t = e.target.closest('.tc'); if (t) { openTrip(+t.dataset.ti, { seq: 0, when: +t.dataset.when }); return; }
    const li = e.target.closest('#rstops li'); if (li) openStop(+li.dataset.si, { routeFilter: ri });
  };
  push({
    el, tick: render,
    mount() { map = makeMap($('#rmap', el)); setTimeout(() => { map.invalidateSize(); drawMap(); const n = $('.tc.next', el); if (n) n.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 260); },
    destroy() { map && map.remove(); },
  });
}

/* =========================================================
   Fül: KÖZELBEN
   ========================================================= */
function NearView() {
  const el = document.createElement('section');
  el.className = 'view';
  el.innerHTML = `
    <header class="top"><div class="grow"><h1>Közelben</h1><p id="locLine">Helyzet keresése…</p></div><button class="icon-btn" id="locBtn" aria-label="Hely frissítése">${icon('locate')}</button></header>
    <a class="ticket-card" id="ticketBtn" href="${TICKET_APP.web}" target="_blank" rel="noopener">${icon('ticket')}<span class="tk-main"><b>Jegyvásárlás</b><small>Megnyitás a Mobiljegy alkalmazásban</small></span>${icon('arrow', 'sm')}</a>
    <div id="msg"></div>
    <section class="hero" id="hero" hidden>
      <div class="hero-head"><span class="eyebrow">Legközelebbi busz</span><span id="heroClock" class="clock-chip"></span></div>
      <div id="heroText"></div>
      <div id="heroMap" class="minimap"></div>
    </section>
    <h2 class="sec" id="listTitle" hidden>Legközelebbi megállók</h2>
    <div id="list"></div>`;
  let map, mapLayer, mapKey = '';
  let lastComputed = null;

  function posOrNull() { return geo.lastPos; }

  function render() {
    const f = F(), pos = posOrNull(), now = new Date();
    const loc = $('#locLine', el), msg = $('#msg', el), hero = $('#hero', el), list = $('#list', el), lt = $('#listTitle', el);
    if (!pos) {
      hero.hidden = true; lt.hidden = true; list.innerHTML = '';
      if (geo.status === 'denied') {
        loc.textContent = 'Nincs helyhozzáférés';
        msg.innerHTML = `<div class="card note"><b>A helyhozzáférés ki van kapcsolva.</b><p>Engedélyezd az alkalmazás beállításaiban, vagy keress megállót a „Járatok” fülön.</p><button class="btn" id="retry">Újra megpróbálom</button> <button class="btn" id="manual">Kipróbálás: Autóbusz-állomásnál állok</button></div>`;
      } else if (geo.status === 'error') {
        loc.textContent = 'A hely nem állapítható meg';
        msg.innerHTML = `<div class="card note"><b>Nem sikerült meghatározni a helyzetedet.</b><p>Kapcsold be a helymeghatározást, majd próbáld újra.</p><button class="btn" id="retry">Újra</button> <button class="btn" id="manual">Kipróbálás: Autóbusz-állomásnál állok</button></div>`;
      } else { loc.textContent = 'Helyzet keresése…'; msg.innerHTML = ''; }
      return;
    }
    msg.innerHTML = '';
    loc.textContent = pos.acc ? `Pontosság ±${Math.round(pos.acc)} m` : 'Helyzet megvan';
    let near = f.nearest(pos.lat, pos.lon, 8, 1200);
    let far = false;
    if (!near.length) { near = f.nearest(pos.lat, pos.lon, 4, 8000); far = true; }
    if (!near.length) {
      hero.hidden = true; lt.hidden = true;
      list.innerHTML = '<div class="card note"><b>Nincs megálló a közelben.</b><p>A legközelebbi megálló is messze van. A Járatok fülön kereshetsz megállót.</p></div>';
      return;
    }
    // azonos nevű, közeli megállóhelyek (pl. autóbusz-állomás kocsiállásai) egy kártyára
    const groups = [];
    for (const n of near) {
      const nm = f.stops[n.i].name.toLowerCase();
      const g = groups.find(x => x.nm === nm);
      if (g) { g.idx.push(n.i); }
      else groups.push({ nm, i: n.i, dist: n.dist, idx: [n.i] });
    }
    const rows = groups.map(g => ({ i: g.i, idx: g.idx, dist: g.dist, deps: f.departures(g.idx, now, 4) }));
    // hero: az első olyan busz, amit gyalog még elérsz (a séta ideje szerint), különben az első
    let best = null, fallback = null;
    for (const r of rows) for (const d of r.deps) {
      const walkSec = (r.dist / 75) * 60;
      const c = { ...d, dist: r.dist, walkSec };
      if (!fallback || d.wait < fallback.wait) fallback = c;
      if (d.wait >= walkSec * 0.85 && (!best || d.wait < best.wait)) best = c;
    }
    const h = best || fallback;
    if (h) {
      hero.hidden = false;
      const p = waitParts(h.wait), t = f.trips[h.ti], stops = f.tripStops(h.ti);
      const lastArr = stops[stops.length - 1].arr + (h.when - stops[h.seq].dep);
      const tight = h.wait < h.walkSec * 0.85;
      $('#heroClock', el).textContent = fmtTime(h.when) + dayLabel(h.when);
      $('#heroText', el).innerHTML = `
        <button class="hero-main" data-open>
          <div class="hero-count"><b>${p.big}</b>${p.unit ? `<small>${p.unit}</small>` : ''}</div>
          <div class="hero-route">${badge(h.route, true)}<span class="arrow">${icon('arrow')}</span><b class="hs">${esc(h.head)}</b></div>
        </button>
        <dl class="hero-facts">
          <div><dt>Honnan</dt><dd>${esc(f.stops[h.stop].name)}</dd><dd class="sub">${icon('walk', 'sm')} ${dist(h.dist)} · kb. ${walkMin(h.dist)} perc séta${tight ? ' <em>· szorosan éred el</em>' : ''}</dd></div>
          <div><dt>Hová</dt><dd>${esc(stops[stops.length - 1].stop.name)}</dd><dd class="sub">${icon('clock', 'sm')} érkezés ${fmtTime(lastArr)}${dayLabel(lastArr)}</dd></div>
        </dl>`;
      $('#heroText', el).querySelector('[data-open]').onclick = () => openTrip(h.ti, { seq: h.seq, when: h.when });
      const key = `${h.ti}:${h.seq}`;
      if (map && key !== mapKey) { mapKey = key; if (mapLayer) mapLayer.group.remove(); mapLayer = drawTrip(map, f, h.ti, { boardSeq: h.seq, user: pos, interactive: false }); const ml = mapLayer; setTimeout(() => { map.invalidateSize(); ml.fit(18); }, 60); }
      lastComputed = h;
    } else {
      hero.hidden = true;
    }
    lt.hidden = false;
    lt.textContent = far ? 'Legközelebbi megállók (messze vagy)' : 'Legközelebbi megállók';
    list.innerHTML = rows.map(r => `
      <article class="card stopcard">
        <button class="stop-head" data-stops="${r.idx.join(',')}"><span class="sn">${esc(f.stops[r.i].name)}</span><span class="sd">${icon('walk', 'sm')} ${dist(r.dist)}</span></button>
        ${r.deps.length ? r.deps.slice(0, 3).map(d => depRow(d)).join('') : '<p class="empty small">Nincs több indulás a következő 24 órában.</p>'}
      </article>`).join('');
  }

  el.onclick = e => {
    if (e.target.closest('#retry')) { geo.startLocation(); return; }
    if (e.target.closest('#manual')) { const f = F(), i = f.stops.findIndex(x => /busz.?állomás/i.test(x.name)); const st = f.stops[i >= 0 ? i : 0]; geo.setManualPosition(st.lat + 0.0006, st.lon + 0.0006); return; }
    const sh = e.target.closest('.stop-head'); if (sh) { openStop(sh.dataset.stops.split(',').map(Number)); return; }
    const d = e.target.closest('.dep'); if (d) openTrip(+d.dataset.ti, { seq: +d.dataset.seq, when: +d.dataset.when });
  };
  $('#locBtn', el).onclick = () => { geo.startLocation(); render(); };
  $('#ticketBtn', el).onclick = async e => {
    if (!Capacitor.isNativePlatform()) return; // weben a link magától működik
    e.preventDefault();
    const r = await openTicketApp();
    if (r === 'store') toast(`A(z) ${TICKET_APP.name} nincs telepítve – megnyitom a Play Áruházat.`);
    else if (r === 'failed') toast(`Nem sikerült megnyitni. Keresd a Play Áruházban: ${TICKET_APP.name}.`);
  };
  geo.onPosition(() => { if (activeTab === 'near' && !stack.length) render(); });

  return {
    el,
    show() {
      if (!map) {
        map = makeMap($('#heroMap', el), { interactive: false });
        setTimeout(() => map.invalidateSize(), 50);
      }
      render();
      setTimeout(() => map && map.invalidateSize(), 120);
    },
    tick() { render(); },
    refresh() { mapKey = ''; render(); },
  };
}

/* =========================================================
   Fül: TÉRKÉP
   ========================================================= */
function MapView() {
  const el = document.createElement('section');
  el.className = 'view mapview';
  el.innerHTML = `<div id="bigmap"></div><button class="fab" id="mapLocate" aria-label="Hol vagyok?">${icon('locate')}</button><div class="msheet" id="msheet" hidden></div>`;
  let map, stopLayer, userMarker, built = false, feedRef = null;

  function build() {
    const f = F();
    if (!map) {
      map = makeMap($('#bigmap', el), { center: NYIREGYHAZA, zoom: 13 });
      map.on('zoomend moveend', updateStops);
      map.on('click', () => { $('#msheet', el).hidden = true; });
    }
    feedRef = f; built = true;
    if (stopLayer) stopLayer.remove();
    stopLayer = L.layerGroup().addTo(map);
    updateStops();
  }
  function updateStops() {
    if (!stopLayer) return;
    stopLayer.clearLayers();
    const f = F(), z = map.getZoom(), b = map.getBounds().pad(0.1);
    if (z < 13) return;
    f.stops.forEach((s, i) => {
      if (!f.byStop[i].length || !b.contains([s.lat, s.lon])) return;
      const m = stopMarker(s, z >= 15 ? { r: 7, fill: '#ffc83d', color: '#14231f', weight: 2.5 } : { r: 4, fill: '#ffc83d', color: '#14231f', weight: 2 });
      m.on('click', ev => { L.DomEvent.stopPropagation(ev); showSheet(i); });
      if (z >= 16) m.bindTooltip(s.name, { direction: 'top', offset: [0, -6] });
      m.addTo(stopLayer);
    });
  }
  function sheetHtml(si) {
    const f = F(), s = f.stops[si], g = groupOf(si);
    const deps = f.departures(g, new Date(), 4);
    return `<button class="stop-head" data-stops="${g.join(',')}"><span class="sn">${esc(s.name)}</span><span class="sd">Összes indulás ${icon('arrow', 'sm')}</span></button>` +
      (deps.length ? deps.map(d => depRow(d)).join('') : '<p class="empty small">Nincs indulás a következő 24 órában.</p>');
  }
  function showSheet(si) {
    const f = F(), s = f.stops[si];
    const sh = $('#msheet', el);
    sh.hidden = false;
    sh.innerHTML = sheetHtml(si);
    sh.dataset.stop = si;
    map.panTo([s.lat, s.lon], { animate: true });
  }
  el.onclick = e => {
    const sh = e.target.closest('.stop-head'); if (sh) { openStop(sh.dataset.stops.split(',').map(Number)); return; }
    const d = e.target.closest('.dep'); if (d) { openTrip(+d.dataset.ti, { seq: +d.dataset.seq, when: +d.dataset.when }); return; }
    if (e.target.closest('#mapLocate')) { const p = geo.lastPos; if (p) { map.setView([p.lat, p.lon], 16); } else geo.startLocation(); }
  };
  geo.onPosition(p => {
    if (!map || !p) return;
    if (!userMarker) userMarker = L.marker([p.lat, p.lon], { icon: userIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
    else userMarker.setLatLng([p.lat, p.lon]);
  });
  return {
    el,
    show() {
      if (!built || feedRef !== F()) build();
      setTimeout(() => { map.invalidateSize(); }, 60);
      const p = geo.lastPos;
      if (p && !userMarker) userMarker = L.marker([p.lat, p.lon], { icon: userIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
      if (p && !el._centered) { el._centered = true; map.setView([p.lat, p.lon], 15); }
      const sh = $('#msheet', el); if (!sh.hidden) showSheet(+sh.dataset.stop);
    },
    tick() { const sh = $('#msheet', el); if (sh && !sh.hidden) sh.innerHTML = sheetHtml(+sh.dataset.stop); },
    refresh() { built = false; },
  };
}

/* =========================================================
   Fül: JÁRATOK (keresés)
   ========================================================= */
function RoutesView() {
  const el = document.createElement('section');
  el.className = 'view';
  el.innerHTML = `<header class="top"><div class="grow"><h1>Járatok</h1><p>Keress járatszámra vagy megállóra</p></div></header>
    <label class="search">${icon('search')}<input id="q" type="search" inputmode="search" placeholder="Pl. 8, Sóstó, Kossuth tér…" autocomplete="off"></label>
    <div id="res"></div>`;
  const q = $('#q', el);
  function render() {
    const f = F(), txt = q.value;
    const rs = f.searchRoutes(txt);
    const ss = txt.trim().length >= 2 ? f.searchStops(txt, 15) : [];
    let html = '';
    if (rs.length) html += `<h2 class="sec">Járatok</h2><div class="card list">${rs.map(({ r, i }) => {
      const pats = f.routePatterns(i);
      return `<button class="row" data-r="${i}">${badge(i, true)}<span class="row-main"><b>${esc(r.long || pats.map(p => p.from + ' – ' + p.to)[0] || '')}</b><small>${pats.length} irány · ${f.routeTrips[i].length} járat</small></span>${icon('arrow', 'sm mut')}</button>`;
    }).join('')}</div>`;
    if (ss.length) html += `<h2 class="sec">Megállók</h2><div class="card list">${ss.map(i => {
      const routes = [...new Set(f.byStop[i].map(x => f.trips[x[0]].r))].slice(0, 6);
      return `<button class="row" data-s="${i}"><span class="row-main"><b>${esc(f.stops[i].name)}</b><small>${routes.map(r => esc(f.routes[r].short)).join(', ')}</small></span>${icon('arrow', 'sm mut')}</button>`;
    }).join('')}</div>`;
    if (!rs.length && !ss.length) html = '<p class="empty">Nincs találat.</p>';
    $('#res', el).innerHTML = html;
  }
  q.oninput = render;
  el.onclick = e => {
    const r = e.target.closest('[data-r]'); if (r) { openRoute(+r.dataset.r); return; }
    const s = e.target.closest('[data-s]'); if (s) openStop(+s.dataset.s);
  };
  return { el, show() { render(); }, refresh() { render(); } };
}

/* =========================================================
   Fül: BEÁLLÍTÁSOK / frissítés
   ========================================================= */
function SettingsView() {
  const el = document.createElement('section');
  el.className = 'view';
  async function render() {
    const f = F(), info = INFO(), s = settings.get(), cfg = await bundledConfig();
    const exp = f.expiry();
    const srcTxt = info.demo ? 'Csomagolt DEMÓ adat (kitalált menetrend!)' : { bundled: 'Az alkalmazásba csomagolt', downloaded: 'Letöltve', file: 'Fájlból betöltve' }[info.source] || info.source;
    const chip = exp === 'expired' ? '<span class="pill bad">Lejárt</span>' : exp === 'soon' ? '<span class="pill warn">Hamarosan lejár</span>' : '<span class="pill ok">Érvényes</span>';
    el.innerHTML = `
      <header class="top"><div class="grow"><h1>Beállítások</h1><p>Menetrend adatbázis és frissítés</p></div></header>
      ${info.demo ? `<div class="card note warn"><b>Demó adat van betöltve.</b><p>Ez nem valós menetrend. Töltsd be a Nyíregyháza GTFS csomagot lent (URL vagy .zip fájl).</p></div>` : ''}
      <section class="card">
        <div class="kv-h"><h3>Menetrend adat</h3>${chip}</div>
        <dl class="kv">
          <div><dt>Forrás</dt><dd>${esc(srcTxt)}</dd></div>
          <div><dt>Kiadó</dt><dd>${esc(f.meta.publisher || f.meta.agency || '–')}</dd></div>
          <div><dt>Verzió</dt><dd>${esc(f.meta.version || '–')}</dd></div>
          <div><dt>Érvényesség</dt><dd>${fmtDate(f.meta.feedStart)} – ${fmtDate(f.meta.feedEnd)}</dd></div>
          <div><dt>Tartalom</dt><dd>${f.stops.length} megálló · ${f.routes.length} vonal · ${f.trips.length} járat</dd></div>
          <div><dt>Betöltve</dt><dd>${new Date(info.loadedAt).toLocaleString('hu-HU')}</dd></div>
          <div><dt>Utolsó ellenőrzés</dt><dd>${info.lastCheck ? new Date(info.lastCheck).toLocaleString('hu-HU') : '–'}</dd></div>
        </dl>
        <button class="btn primary" id="upd">${icon('refresh')} Frissítés most</button>
        <p class="status" id="updStatus" role="status"></p>
      </section>
      <section class="card">
        <h3>Frissítési cím (szűrt nyíregyházi GTFS .zip)</h3>
        <input class="field" id="url" type="url" inputmode="url" placeholder="https://…/gtfs.zip" value="${esc(s.gtfsUrl || cfg.appUpdateUrl || '')}">
        <label class="switch"><input type="checkbox" id="auto" ${s.autoUpdate === false ? '' : 'checked'}><span>Automatikus frissítés</span></label>
        <label class="inline">Ellenőrzés gyakorisága
          <select id="days" class="field sm">${[1, 3, 7, 14].map(d => `<option value="${d}" ${(s.autoUpdateDays || cfg.autoUpdateDays || 3) === d ? 'selected' : ''}>${d} naponta</option>`).join('')}</select></label>
        <p class="hint">Nyári/téli menetrendváltáskor, illetve ha az érvényesség lejár, az app a megnyitáskor magától frissít (ha van megadva cím). A cím a README szerinti szűrt csomagra mutasson, ne az országos fájlra.</p>
        <button class="btn" id="save">Mentés</button>
      </section>
      <section class="card">
        <h3>Betöltés fájlból</h3>
        <p class="hint">Ha a (szűrt nyíregyházi) GTFS-t kézzel töltötted le, például a telefon Letöltések mappájába, itt választhatod ki a .zip fájlt.</p>
        <label class="btn filebtn">${icon('file')} .zip kiválasztása<input type="file" id="file" accept=".zip,application/zip,application/x-zip-compressed" hidden></label>
      </section>
      <section class="card about-card">
        <h3>Névjegy</h3>
        <div class="about-brand"><span class="about-logo">${icon('bus')}</span><div><b>NyírBusz</b><small>Nyíregyháza helyi autóbusz menetrend · ${typeof __APP_VERSION__ !== 'undefined' ? 'v' + __APP_VERSION__ : ''}</small></div></div>
        <dl class="kv">
          <div><dt>Fejlesztő</dt><dd>Harsányi Zoltán</dd></div>
          <div><dt>Menetrendi adatok</dt><dd>MÁV Személyszállítási Zrt. (Volánbusz) nyílt adat, GTFS</dd></div>
          <div><dt>Térkép</dt><dd>© OpenStreetMap közreműködők (Esri tartalék)</dd></div>
        </dl>
        <p class="hint">© ${new Date().getFullYear()} Harsányi Zoltán. A „perc múlva” értékek a menetrend szerinti időpontok, nem valós idejű adatok. A jegyvásárlás a Közlekedési Mobiljegy alkalmazásban történik.</p>
      </section>`;
    wire();
  }
  function status(msg, cls = '') { const n = $('#updStatus', el); if (n) { n.textContent = msg; n.className = 'status ' + cls; } }
  function wire() {
    const saveUrl = () => settings.set({ gtfsUrl: $('#url', el).value.trim(), autoUpdate: $('#auto', el).checked, autoUpdateDays: +$('#days', el).value });
    $('#save', el).onclick = () => { saveUrl(); status('Mentve.', 'ok'); };
    $('#auto', el).onchange = saveUrl; $('#days', el).onchange = saveUrl;
    $('#upd', el).onclick = async () => {
      saveUrl();
      const url = $('#url', el).value.trim() || (await bundledConfig()).appUpdateUrl;
      if (!url) { status('Adj meg letöltési címet, vagy válassz .zip fájlt lent.', 'bad'); return; }
      $('#upd', el).disabled = true; status('Letöltés és feldolgozás…');
      try {
        const r = await updateFromUrl(url);
        onFeedChanged();
        await render();
        status(r.changed ? (r.expired ? 'Frissítve, de az adat érvényessége lejárt!' : 'Frissítve: új menetrend betöltve.') : 'Már a legfrissebb menetrend van betöltve.', r.expired ? 'warn' : 'ok');
      } catch (e) { status('Hiba: ' + e.message, 'bad'); $('#upd', el).disabled = false; }
    };
    $('#file', el).onchange = async ev => {
      const file = ev.target.files[0]; if (!file) return;
      status('Feldolgozás…');
      try { const r = await updateFromFile(file); onFeedChanged(); await render(); status(r.expired ? 'Betöltve, de az adat érvényessége lejárt!' : 'Betöltve.', r.expired ? 'warn' : 'ok'); }
      catch (e) { status('Hiba: ' + e.message, 'bad'); }
    };
  }
  return { el, show() { render(); }, refresh() { render(); }, async tick() { /* nincs */ } };
}

/* =========================================================
   Alkalmazás váz
   ========================================================= */
function onFeedChanged() {
  Object.values(tabViews).forEach(v => v.refresh && v.refresh());
  updateGlobalBanner();
}
function updateGlobalBanner() {
  const b = $('#gbanner'); if (!b) return;
  const info = INFO(), exp = F().expiry();
  if (info.demo) { b.hidden = false; b.className = 'gbanner demo'; b.innerHTML = '<b>DEMÓ adat</b> – nem valós menetrend. Beállítások → Frissítés.'; }
  else if (exp === 'expired') { b.hidden = false; b.className = 'gbanner bad'; b.innerHTML = '<b>A menetrend lejárt.</b> Frissítsd a Beállításokban.'; }
  else if (exp === 'soon') { b.hidden = false; b.className = 'gbanner warn'; b.innerHTML = 'A menetrend hamarosan lejár – frissítés javasolt.'; }
  else b.hidden = true;
}

export function showTab(id) {
  activeTab = id;
  while (stack.length) pop();
  Object.entries(tabViews).forEach(([k, v]) => { v.el.hidden = k !== id; });
  tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
  tabViews[id].show && tabViews[id].show();
}

export function mountApp(root) {
  root.innerHTML = `<div id="gbanner" class="gbanner" hidden></div><main id="views"></main><div id="pages"></div>
    <nav id="tabs">${[['near', 'Közelben', 'pin'], ['map', 'Térkép', 'map'], ['routes', 'Járatok', 'bus'], ['settings', 'Beállítás', 'gear']].map(([id, l, ic]) => `<button data-tab="${id}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
  pagesEl = $('#pages'); tabsEl = $('#tabs');
  const host = $('#views');
  tabViews = { near: NearView(), map: MapView(), routes: RoutesView(), settings: SettingsView() };
  Object.values(tabViews).forEach(v => { v.el.hidden = true; host.appendChild(v.el); });
  tabsEl.onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
  updateGlobalBanner();
  showTab('near');
  // percenként/20 mp-enként frissítjük a visszaszámlálókat
  setInterval(() => {
    if (document.hidden) return;
    const top = stack[stack.length - 1];
    if (top && top.tick) top.tick();
    else if (tabViews[activeTab].tick) tabViews[activeTab].tick();
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const top = stack[stack.length - 1];
    if (top && top.tick) top.tick(); else if (tabViews[activeTab].tick) tabViews[activeTab].tick();
  });
  // automatikus menetrendfrissítés háttérben
  autoUpdateIfDue().then(r => { if (r && r.changed) onFeedChanged(); });
}


/* =========================================================
   Jegyvásárlás: üzenet
   ========================================================= */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3800);
}
