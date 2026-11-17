import './style.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { loadInitial } from './data.js';
import { mountApp, handleBack } from './ui.js';
import { startLocation } from './geo.js';

async function boot() {
  const root = document.getElementById('app');
  try {
    await loadInitial();
    mountApp(root);
    startLocation();
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div style="padding:28px;font-family:system-ui"><h2>Nem sikerült betölteni a menetrendet</h2><p>${String(e.message || e)}</p></div>`;
  }
  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('backButton', () => { if (!handleBack()) CapApp.exitApp(); });
  }
}
boot();
