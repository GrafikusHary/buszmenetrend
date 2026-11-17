# NyírBusz – Nyíregyháza helyi autóbusz menetrend (GTFS)

**Fejlesztő: Harsányi Zoltán**

Mobilra telepíthető (Android APK) menetrend app Nyíregyháza helyi autóbuszaihoz.

**Funkciók**
- 📍 A hozzád legközelebbi megállók, az onnan induló buszok visszaszámlálóval
- ⏱ „Legközelebbi busz” kártya: hány perc múlva jön, **honnan → hová** megy, séta idő, érkezés a végállomásra, térképes útvonallal
- 🗺 Térkép az összes megállóval, koppintásra indulások
- 🔎 Keresés járatszámra és megállónévre (ékezetfüggetlen); járat nézetben irányonként az összes megálló és a mai indulások
- 🎟 **Jegyvásárlás** gomb a főoldalon: átnavigál a Közlekedési Mobiljegy alkalmazásra, és ha nincs telepítve, megnyitja a Play Áruházat
- 🔄 Menetrend frissítése gombnyomásra, automatikusan, vagy scripttel (nyári/téli átállás)
- 🌙 Világos/sötét téma, magyar felület

## 1. A GTFS adat

Forrás (nyílt adat, regisztráció nélkül): `https://opendata.utas.hu/public-gtfs/volanbusz_gtfs.zip` – ez az **országos Volánbusz-feed** (~100 MB, 3400+ vonal), telefonra túl nagy.
Ezért a `scripts/update-gtfs.mjs` letölti, és **leszűri a nyíregyházi helyi járatokra** (`config.json` → `agencyMatch: "Nyíregyháza"`; ~0,7 MB marad), és csak ezt csomagolja az APK-ba.

Az app jelenleg a **valódi, leszűrt nyíregyházi adatot** tartalmazza (érvényes: 2026. 11. 17. – 2027. 02. 15.).

`public/data/config.json`:
| Kulcs | Jelentés |
|---|---|
| `sourceUrl` | az országos GTFS letöltési címe (a script használja) |
| `agencyMatch` | melyik szolgáltató adatait tartsa meg (reguláris kifejezés az `agency_name`-re) |
| `stripPrefix` | megállónevek elejéről levágandó szöveg (`Nyíregyháza, `) |
| `appUpdateUrl` | a **szűrt** csomag címe, amit az app frissítéskor tölt le (a GitHub workflow automatikusan beállítja, lásd lent) |

> Az appba **ne** a teljes országos fájl címét írd: azt az app visszautasítja, mert túl nagy.

## 2. APK építése GitHub Actions-szel (nem kell semmit telepíteni)

1. Hozz létre egy (akár privát) GitHub repót, és töltsd fel ennek a mappának a tartalmát.
2. *Actions → APK építés → Run workflow* (jelöld be a „Menetrend frissítése” opciót, ha a legfrissebb GTFS-t is le akarod tölteni).
3. A workflow a szűrt menetrendet a **Releases → „gtfs”** alá is kiteszi, és ennek a címét állítja be az app frissítési címének. **Ehhez a repónak nyilvánosnak kell lennie** (az adat nyílt adat, a kód nem érzékeny); privát repónál az app-beli URL-es frissítés nem éri el a fájlt – ilyenkor használd a „.zip kiválasztása” opciót, vagy új APK-t.
4. Kb. 5 perc múlva az APK a repó **Releases → Legfrissebb APK** alatt (és az Artifacts-ban) letölthető: `NyirBusz.apk`.
5. Telefonon nyisd meg a fájlt, engedélyezd az „ismeretlen forrásból telepítést”, és telepítsd.

A workflow **hetente** (hétfő hajnal) magától újra letölti a GTFS-t; ha változott (pl. nyári/téli menetrend), új APK készül, és a frissített adat visszakerül a repóba.

## 3. Menetrend frissítése

| Mód | Hogyan |
|---|---|
| **App-ban, gombnyomásra** | Beállítások → *Frissítés most* (a megadott URL-ről) vagy *.zip kiválasztása* |
| **App-ban, automatikusan** | Beállítások → *Automatikus frissítés* (1/3/7/14 naponta, megnyitáskor). Ha a menetrend lejárt vagy 7 napon belül lejár, naponta próbálkozik. |
| **Script** | `npm run gtfs:update` (forrás: `config.json` `sourceUrl`, `GTFS_URL` env, vagy argumentum – URL vagy helyi zip). Letölti, leszűri Nyíregyházára, ellenőrzi, és ha változott, beírja a `public/data/` mappába. Utána `npm run cap:sync` + APK build. |

## 4. Helyi fejlesztés / build a saját gépen

```bash
npm install
npm run dev            # böngészős előnézet (http://localhost:5173)
npm run test           # motor önellenőrzés
npm run cap:sync       # web build + szinkron az android/ projektbe
cd android && ./gradlew assembleDebug     # JDK 21 + Android SDK kell (vagy Android Studio: npx cap open android)
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Jegyvásárlás gomb
A főoldali sárga *Jegyvásárlás* kártya az Android csomagnév alapján indítja a Közlekedési Mobiljegy appot (`hu.nemzetimobilfizetes.mobiljegyapp`, lásd `src/tickets.js`). Ha nincs telepítve, a Play Áruház nyílik meg. A csomagnév az `AndroidManifest.xml` `<queries>` részében is szerepel (Android 11+ csomaglátási szabály) – másik app esetén mindkét helyen cseréld.

## Felépítés
- `src/gtfs.js` – GTFS feldolgozó és lekérdező motor (megállók, indulások, szolgáltatási napok, keresés)
- `src/data.js` – IndexedDB tárolás, frissítés URL-ről/fájlból, automatikus frissítés
- `src/ui.js`, `src/map.js`, `src/style.css` – felület, Leaflet térkép
- `scripts/` – `update-gtfs.mjs` (frissítő), `make-sample-gtfs.mjs` (demó adat), `make-icons.py`
- `android/` – Capacitor Android projekt · `.github/workflows/build-apk.yml` – APK build

## Megjegyzések
- A térképcsempék (OpenStreetMap, tartalékként Esri) internetet igényelnek; a menetrend offline is működik.
- A „perc múlva” a **menetrend szerinti** idő, nem valós idejű (GTFS-RT nincs).
- Az APK debug-aláírású (saját használatra jó). Play Store-ra release aláírás kell.
