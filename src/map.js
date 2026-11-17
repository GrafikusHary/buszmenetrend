// Leaflet segédek: térkép létrehozás, járat útvonal rajzolás
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { haversine } from './gtfs.js';

export const NYIREGYHAZA = [47.9554, 21.7167];
const dark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function makeMap(el, { interactive = true, center = NYIREGYHAZA, zoom = 13 } = {}) {
  const map = L.map(el, {
    center, zoom, zoomControl: false, attributionControl: interactive,
    dragging: interactive, touchZoom: interactive, scrollWheelZoom: interactive,
    doubleClickZoom: interactive, boxZoom: false, keyboard: false, tap: false,
    preferCanvas: true,
  });
  const url = dark()
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  L.tileLayer(url, {
    maxZoom: 19, subdomains: 'abcd',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  return map;
}

export const userIcon = () => L.divIcon({ className: 'user-dot', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] });

function nearestVertex(shape, lat, lon, from = 0) {
  let best = from, bd = Infinity;
  for (let i = from; i < shape.length; i++) {
    const d = haversine(lat, lon, shape[i][0], shape[i][1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function stopMarker(s, { r = 5, fill = '#fff', color = '#0b5d4b', weight = 3 } = {}) {
  return L.circleMarker([s.lat, s.lon], { radius: r, color, weight, fillColor: fill, fillOpacity: 1 });
}

/**
 * Egy járat útvonalának rajzolása.
 * boardSeq: a felszállási megálló sorszáma a járaton belül (null, ha nincs kiemelés)
 */
export function drawTrip(map, feed, ti, { boardSeq = null, user = null, interactive = true, onStop = null } = {}) {
  const g = L.layerGroup().addTo(map);
  const t = feed.trips[ti];
  const route = feed.routes[t.r];
  const color = feed.color(t.r) || '#0b5d4b';
  const shape = feed.tripShape(ti);
  const stops = feed.tripStops(ti);
  const bs = boardSeq == null ? 0 : boardSeq;
  const board = stops[bs].stop;
  const a = nearestVertex(shape, board.lat, board.lon);
  const endS = stops[stops.length - 1].stop;
  const b = nearestVertex(shape, endS.lat, endS.lon, a);

  if (bs > 0) L.polyline(shape, { color: '#8a948f', weight: 4, opacity: 0.55, dashArray: '2 7', lineCap: 'round' }).addTo(g);
  const ride = shape.slice(a, b + 1);
  L.polyline(ride, { color: '#fff', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(g);
  L.polyline(ride, { color, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(g);

  stops.forEach((x, i) => {
    if (i < bs) return;
    const isBoard = i === bs && boardSeq != null, isEnd = i === stops.length - 1;
    const m = stopMarker(x.stop, isBoard || isEnd
      ? { r: 8, fill: isBoard ? '#ffc83d' : '#fff', color: isBoard ? '#14231f' : color, weight: 4 }
      : { r: 4, fill: '#fff', color, weight: 2.5 }).addTo(g);
    if (interactive) m.bindTooltip(x.stop.name, { direction: 'top', offset: [0, -6] });
    if (onStop) m.on('click', () => onStop(x.si));
    if (isBoard) m.bindTooltip('Felszállás', { permanent: interactive, direction: 'auto', offset: [0, -4], className: 'tip-board' });
    if (isEnd) m.bindTooltip('Végállomás', { permanent: interactive, direction: 'auto', offset: [0, -4], className: 'tip-end' });
  });

  const pts = ride.slice();
  if (user) {
    L.marker([user.lat, user.lon], { icon: userIcon(), interactive: false }).addTo(g);
    L.polyline([[user.lat, user.lon], [board.lat, board.lon]], { color: '#14231f', weight: 3, dashArray: '1 8', lineCap: 'round', opacity: 0.8 }).addTo(g);
    pts.push([user.lat, user.lon]);
  }
  const bounds = L.latLngBounds(pts);
  return { group: g, fit: (pad = 28) => map.fitBounds(bounds, { padding: [pad, pad], maxZoom: 17, animate: false }) };
}

export { L };
