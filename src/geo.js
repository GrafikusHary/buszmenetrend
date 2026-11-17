// Helymeghatározás (Capacitor Geolocation; böngészőben a navigator.geolocation-re esik vissza)
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

let watchId = null;
const listeners = new Set();
export let lastPos = null;
export let status = 'unknown'; // unknown | granted | denied | error

export function onPosition(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit(p) {
  lastPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: p.timestamp };
  status = 'granted';
  listeners.forEach(f => f(lastPos, status));
}

export async function startLocation() {
  try {
    if (Capacitor.isNativePlatform()) {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') perm = await Geolocation.requestPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        status = 'denied'; listeners.forEach(f => f(lastPos, status)); return status;
      }
    }
    if (watchId != null) await Geolocation.clearWatch({ id: watchId });
    // gyors első helymeghatározás, utána folyamatos követés
    try { emit(await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 })); } catch (e) { /* a watch még jöhet */ }
    watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 8000 },
      (p, err) => {
        if (err) { if (!lastPos) { status = err.code === 1 ? 'denied' : 'error'; listeners.forEach(f => f(lastPos, status)); } return; }
        if (p) emit(p);
      });
  } catch (e) {
    status = /denied|permission/i.test(String(e && e.message)) ? 'denied' : 'error';
    listeners.forEach(f => f(lastPos, status));
  }
  return status;
}

/** Kézi (demó) helyzet, ha a helymeghatározás nem elérhető. */
export function setManualPosition(lat, lon) {
  emit({ coords: { latitude: lat, longitude: lon, accuracy: 0 }, timestamp: Date.now() });
}
