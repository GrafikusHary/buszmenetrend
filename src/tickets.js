// Jegyvásárló alkalmazások megnyitása (Android: közvetlen indítás, ha nincs telepítve: Play Áruház)
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';

// A csomagnév a Nemzeti Mobilfizetési Zrt. hivatalos oldaláról (mobiljegy.nmzrt.hu) származik.
export const TICKET_APP = {
  name: 'Közlekedési Mobiljegy',
  pkg: 'hu.nemzetimobilfizetes.mobiljegyapp',
  web: 'https://play.google.com/store/apps/details?id=hu.nemzetimobilfizetes.mobiljegyapp',
};

/** @returns {'opened'|'store'|'web'|'failed'} */
export async function openTicketApp(app = TICKET_APP) {
  if (!Capacitor.isNativePlatform()) { window.open(app.web, '_blank', 'noopener'); return 'web'; }
  try {
    const r = await AppLauncher.openUrl({ url: app.pkg });
    if (r.completed) return 'opened';
  } catch { /* nincs telepítve */ }
  for (const url of [`market://details?id=${app.pkg}`, `https://play.google.com/store/apps/details?id=${app.pkg}`]) {
    try { const r = await AppLauncher.openUrl({ url }); if (r.completed) return 'store'; } catch { /* következő */ }
  }
  return 'failed';
}
