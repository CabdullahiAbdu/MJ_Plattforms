# AUDIT MovieJournal (`CabdullahiAbdu/MJ_Plattforms`)

**Stand:** 5. November 2026 · **Geprüfter Commit:** `1e2d082` (einziger Commit) · **Art:** reines Audit, kein Code geändert

## Wie diese Datei benutzt wird

Diese Datei ist der **App-spezifische Backlog**. Die allgemeine System Instruction beschreibt das Qualitätsziel (Netflix / Apple TV), diese Datei beschreibt, **was im Code konkret davon abweicht**.

Anweisung an die KI: Datei komplett lesen, jeden Befund **vor dem Handeln gegen den aktuellen Code prüfen**, dann in der Reihenfolge der Phasen unten abarbeiten. Ein Befund gilt erst als erledigt, wenn sein Akzeptanzkriterium nachweislich erfüllt ist.

## Methode und Grenzen

- Repo geklont und gelesen, Abhängigkeiten installiert, `tsc --noEmit` und `vite build` in einer Sandbox ausgeführt.
- **Nicht möglich:** Die Live-App ist per Login geschützt, daher keine Tests auf echten Geräten, keine Lighthouse-Messung, kein Angriffstest. Sicherheitsbefunde stammen aus dem Lesen des Codes.
- Zeilennummern sind ungefähr (Stand Commit `1e2d082`).

## Gemessene Werte

| Messwert | Ergebnis |
|---|---|
| JS-Bundle | 1.326 KB (349 KB gzip), **ein einziger Chunk** |
| CSS | 128 KB (18,5 KB gzip) |
| Typprüfung | 12 Fehler |
| Tests | 0 |
| `any` im Code | 109 |
| `console.*` im Code | 43 |
| `.cache/tmdb-regional-cache.json` im Git | 26 MB |
| Reduced-Motion-Regeln | 0 |

---

# PHASE 1: SICHERHEIT (zuerst, blockiert das Veröffentlichen)

## SEC-01 · KRITISCH · Anmeldung ist fälschbar
- **Ort:** `server.ts`, `verifyFirebaseIdToken` (ca. 1149-1190).
- **Befund:** Schlägt die Prüfung bei Google fehl (Fehlerantwort, Timeout, Netzwerkproblem), fällt der Code auf eine Prüfung **ohne Signaturkontrolle** zurück. Der Fallback liest nur Felder aus dem Token. Darauf hängen 2FA, Nutzer-Sync, TV-Kopplung und Admin-Endpunkte.
- **Ziel:** Identität wird ausschließlich kryptografisch geprüft (Signatur, Aussteller, Zielgruppe, Ablauf). Bei jedem Fehler wird abgelehnt (fail closed). Kein Fallback.
- **Akzeptanz:** Ein selbst gebautes, unsigniertes oder abgelaufenes Token wird mit 401 abgelehnt, auch wenn der Google-Dienst nicht erreichbar ist.

## SEC-02 · KRITISCH · Firestore-Regeln ohne Anmeldung
- **Ort:** `firestore.rules`, Abschnitte 4 bis 7 (`regionalCache`, `tmdbProxyQueue`, `serverKeyVault`, `userSecurityVault`).
- **Befund:** Diese Sammlungen erlauben Lesen, Anlegen, Ändern und teils Löschen **ohne Auth-Prüfung**, weil der Server mit dem Web-Client-SDK ohne Anmeldung zugreift und ein Client per REST in `tmdbProxyQueue` und `regionalCache` schreibt (`services/tmdb.ts`, ca. 290 und 328).
  - `userSecurityVault`: Jeder mit bekannter UID kann den 2FA-Datensatz lesen, überschreiben oder löschen. Der Server liest den 2FA-Status von dort.
  - `serverKeyVault`: Jeder kann den verschlüsselten Key-Vault lesen und überschreiben.
  - `regionalCache`: Jeder kann Cache-Einträge mit falschem Inhalt schreiben (Cache-Poisoning).
  - `tmdbProxyQueue`: Jeder kann Jobs anlegen, auflisten (`pending`) und löschen. Das belastet die Server-Keys.
- **Ziel:** Alles, was nur der Server schreiben darf, ist für Clients komplett gesperrt. Der Server nutzt vertrauenswürdige Server-Zugangsdaten (Admin-Zugriff) statt anonymem Client-SDK. Nutzerdaten bleiben besitzerbasiert (die Regeln für `/users/**` sind gut und bleiben erhalten).
- **Akzeptanz:** Anonyme und fremde Anfragen auf diese vier Sammlungen scheitern. Regel-Tests (Emulator) belegen das.

## SEC-03 · HOCH · Admin-Endpunkte für jeden angemeldeten Nutzer
- **Ort:** `server.ts`, `/api/admin/tmdb-keys` (GET ca. 2280, POST ca. 2330, DELETE ca. 2393).
- **Befund:** Geprüft wird nur „gültiger Nutzer“. `implementation_plan.md` beschreibt „nur Owner“, im Code gibt es das nicht. Zusammen mit SEC-01 besonders gefährlich.
- **Ziel:** Nur ein verifizierter Owner (serverseitig konfigurierte UID/Rolle, nicht eine im Code stehende E-Mail) darf diese Endpunkte nutzen. Alternativ die Endpunkte entfernen, falls die UI sie nicht mehr braucht.
- **Akzeptanz:** Normale Nutzer erhalten 403.

## SEC-04 · HOCH · Plan ≠ Code (Härtung fehlt)
- **Ort:** `server.ts`, ca. 1539-1590 und 2639; `implementation_plan.md`; `security_spec.md`.
- **Befund:**
  - Es gibt nur zwei Header (`nosniff`, `Referrer-Policy`). Kein HSTS, kein Frame-Schutz, keine CSP, keine Permissions-Policy.
  - Nur ein globales Limit von 600 Anfragen pro Minute und IP. Keine eigenen Limits für Auth/2FA, KI, Sync.
  - Die IP kommt aus dem ersten Wert von `X-Forwarded-For` (vom Client fälschbar). Die Zähl-Tabelle `ipRequestCounts` wird **nie bereinigt** und wächst unbegrenzt.
  - `/api/client-error` nimmt unbegrenzt Fremd-Daten an und schreibt sie ins Log.
  - `security_spec.md` verlangt verifizierte E-Mail, die Regeln prüfen nur „nicht anonym“.
  - Der Plan nennt `tests/productionReadiness.test.ts`, das Verzeichnis existiert nicht.
- **Ziel:** Alles, was die Doku verspricht, ist umgesetzt oder aus der Doku entfernt. Echte Limits pro Route auf Basis einer vertrauenswürdigen Client-IP (Proxy-Einstellung korrekt), mit Speicherbegrenzung und Aufräumen. Sicherheits-Header inkl. CSP.
- **Akzeptanz:** Header-Check besteht, Limiter ist nicht per gefälschtem Header umgehbar, Speicher bleibt unter Last stabil.

## SEC-05 · MITTEL · Schwache Vault-Verschlüsselung
- **Ort:** `server.ts`, ca. 79-92.
- **Befund:** Das Geheimnis fällt auf `GEMINI_API_KEY`, `TMDB_API_KEY` oder einen festen String mit Projekt-ID zurück. Der Salt ist fest. Ein Wechsel des Keys macht gespeicherte Daten unlesbar.
- **Ziel:** Eigenes, dediziertes Geheimnis aus einem Secret-Speicher. Kein Fallback auf fremde Keys oder feste Strings. Plan für Rotation.
- **Akzeptanz:** Start ohne Geheimnis schlägt laut fehl, statt still mit schwachem Schlüssel zu laufen.

## SEC-06 · MITTEL · CORS zu offen
- **Ort:** `server.ts`, ca. 1553-1566.
- **Befund:** Jede Herkunft, die auf `.run.app` endet, wird zugelassen (also auch fremde Cloud-Run-Apps). Dazu `localhost`.
- **Ziel:** Explizite Allow-List eigener Herkünfte. `localhost` nur in der Entwicklung.

## SEC-07 · NIEDRIG-MITTEL · Bewertungsfunktion über Server-Key
- **Ort:** `server.ts`, `/api/tmdb`, POST-Zweig (ca. 2476-2495).
- **Befund:** Jeder Aufrufer kann über den Server-Key Bewertungen absenden.
- **Ziel:** Nur angemeldet, mit eigenem Limit, nur erlaubte Felder.

## LEG-01 · HOCH für den Release · TMDB-Attribution fehlt
- **Befund:** Im Code gibt es weder TMDB-Logo noch den Pflichttext („This product uses the TMDB API but is not endorsed or certified by TMDB.“).
- **Ziel:** Sichtbar in Einstellungen/Über-Bereich und in der Store-Beschreibung, gemäß den aktuellen TMDB-Bedingungen.

---

# PHASE 2: GESCHWINDIGKEIT UND FLÜSSIGKEIT (Netflix-Gefühl)

## PERF-01 · Ein einziges 1,3-MB-Bundle
- **Ort:** `App.tsx` (statische Imports aller Views), `vite.config.ts` (keine Chunk-Strategie).
- **Befund:** Detail-, Settings-, Auth-, Search- und Onboarding-View laden schon beim ersten Start mit. Größte Dateien: `DetailView` 88 KB, `SettingsView` 78 KB, `SearchView` 52 KB, `AuthView` 43 KB, `HomeView` 39 KB (Quelltext).
- **Ziel:** Code-Splitting pro Tab/View und für schwere Teile (Auth, Onboarding, 2FA/QR, Firebase-Teile die nicht sofort nötig sind). Erste Ansicht lädt nur das Nötige.
- **Akzeptanz:** Start-JS deutlich unter dem heutigen Wert, belegt durch Build-Ausgabe. Kein Flackern beim Nachladen (Prefetch bei Absicht).

## PERF-02 · Schriften blockieren das Rendern
- **Ort:** `index.html`.
- **Befund:** Fünf Google-Font-Familien (DM Sans, JetBrains Mono, Pacifico, Plus Jakarta Sans, Yellowtail) in einem rendernden Stylesheet im `<head>`.
- **Ziel:** Wenige Familien, nur genutzte Schnitte, eigene Auslieferung oder zuverlässiges `display=swap`, kritische Schrift vorab laden. Ungenutzte Familien entfernen.

## PERF-03 · Kein Caching bei Wiederbesuch, keine echte PWA
- **Ort:** `index.html` (Skript am Ende des `<head>`), `server.ts` (ca. 2650-2670: `/sw.js` meldet sich selbst ab).
- **Befund:** Bei **jedem** Start werden alle Service Worker abgemeldet und alle Caches gelöscht. `vite-plugin-pwa` ist installiert, aber nicht eingebunden. Es gibt kein Web-App-Manifest, daher keine Installation auf Android/Chrome.
- **Ziel:** Ein sauber versionierter Service Worker (Precache der App-Hülle, saubere Updates ohne „schwarzen Bildschirm“), Manifest mit Icons (maskable), Offline-Grundfunktion.
- **Akzeptanz:** Zweiter Besuch lädt ohne Netz die App-Hülle. Update-Wechsel bleibt nicht auf alter Version hängen.

## PERF-04 · HTTP-Caching und Komprimierung fehlen
- **Ort:** `server.ts`, ca. 2458-2530 (`/api/tmdb`), ca. 2670-2685 (statische Dateien).
- **Befund:** Keine Komprimierung. Gehashte Dateien in `/assets` haben `max-age=0` (Standard von `express.static`). `/api/tmdb`-Antworten haben kein `Cache-Control`.
- **Ziel:** Brotli/Gzip, `immutable` + lange Laufzeit für gehashte Assets, Revalidierung für HTML, passende Cache-Header und ETag für API-Antworten.

## PERF-05 · Bilder: alles sofort, keine passenden Größen
- **Ort:** `components/SafeImage.tsx` Zeile 79 (`loading={loading || 'eager'}`), `MovieCard.tsx`, Views.
- **Befund:** Standard ist `eager`, nur wenige Stellen setzen `lazy`. Kein `srcset`/`sizes`, keine festen Maße (Layout-Sprünge). Pro Reihe wächst die Zahl sofort geladener Bilder beim seitlichen Scrollen.
- **Ziel:** Standard `lazy`, nur erste sichtbare Bilder mit Priorität. Passende TMDB-Größen pro Verwendung und Bildschirm, feste Seitenverhältnisse, Platzhalter.

## PERF-06 · Reihen: laden unabhängig von Sichtbarkeit, keine Skeletons
- **Ort:** `components/SmartRow.tsx`, `CinematicRow.tsx`, `MovieCard.tsx`, `views/HomeView.tsx`.
- **Befund:** Jede Reihe lädt beim Mount, auch wenn weit unten. Solange sie lädt, gibt sie `null` zurück (Layout springt). `MediaCard` ist nicht memoisiert und hat pro Karte mehrere Zustände, Timer und Handler. 7 Stellen verwenden Array-Index als `key`. Keine Virtualisierung langer Listen.
- **Ziel:** Reihen laden bei Annäherung an den Viewport, zeigen Skeletons mit finaler Höhe, Karten sind leicht und stabil, lange Listen sind begrenzt/virtualisiert.

## PERF-07 · Tab-Wechsel zerstört den Zustand
- **Ort:** `App.tsx`, ca. 326-375 (`activeTab === X && <View/>`).
- **Befund:** Beim Tab-Wechsel wird die Ansicht entfernt. Scroll-Position und geladene Reihen gehen verloren, Inhalte laden neu.
- **Ziel:** Scroll-Position und geladene Daten pro Tab bleiben erhalten. Rückkehr aus Detail/Overlay stellt die Position wieder her.

## PERF-08 · Viele teure Effekte, kein Reduced-Motion
- **Ort:** Effekt-Dichte: `DetailView` 33, `HomeView` 15, `AuthView` 15, `SearchView` 11, `OnboardingView` 11, `index.css` 10 (Blur, Backdrop-Filter, Schatten, Blend, Animationen).
- **Befund:** Auf schwachen Handys und Smart-TVs riskant für 60 fps. `prefers-reduced-motion` kommt nirgends vor.
- **Ziel:** Weniger/leichtere Effekte, Stufe „leicht“ für TV/schwache Geräte/Datensparmodus, Respekt vor Reduced-Motion.

## PERF-09 · Server blockiert durch große Cache-Datei
- **Ort:** `server.ts`, ca. 462-505; `.cache/tmdb-regional-cache.json`.
- **Befund:** Die 26-MB-Datei wird beim Start synchron gelesen und geparst. Das Schreiben (`JSON.stringify` + `writeFileSync`, bis 1500 Einträge à ca. 17 KB) blockiert den Event-Loop, alle Anfragen warten. Die Datei ist im Git eingecheckt, auf Cloud Run liegt das Dateisystem im Arbeitsspeicher.
- **Ziel:** Kein synchrones Großschreiben. Cache-Daten gehören nicht ins Git (`.gitignore`). Cache-Einträge deutlich kompakter. Persistenz in einem dauerhaften Speicher statt Container-Platte.
- **Akzeptanz:** Keine Event-Loop-Blockaden unter Last, Repo ohne Cache-Datei.

## PERF-10 · Firestore ohne Offline-Cache
- **Ort:** `services/firebase.ts`, ca. 56-61 (Init), ca. 1242-1300 (Listener).
- **Befund:** Keine lokale Persistenz. Watchlist und Fortschritt werden bei jedem Start komplett neu gelesen (Kosten + Wartezeit).
- **Ziel:** Lokaler Persistenz-Cache, sparsame Listener, Anzeige sofort aus dem lokalen Stand.

---

# PHASE 3: ZUVERLÄSSIGKEIT UND BETRIEB (Cloud Run)

## REL-01 · Port fest verdrahtet
- `server.ts` Zeile ca. 22 und ca. 2687: `PORT = 3000`. Umgebungsvariable `PORT` wird ignoriert. **Ziel:** `PORT` aus der Umgebung mit Standardwert.

## REL-02 · Dauerhafte Daten auf flüchtiger Platte
- **Ort:** `server.ts`: `user-cloud-sync-vault.json`, `user-2fa-vault.json`, `tmdb-server-vault.json` unter `.cache/`; im Speicher: `serverUserSyncVault`, `tvPairingSessions`, `pendingTotpSetups`.
- **Befund:** Auf Cloud Run gehen Platten-Inhalte bei Neustart/Skalierung verloren, bei mehreren Instanzen sieht jede Instanz einen anderen Stand. Nutzer-Sync, 2FA-Setup und TV-Kopplung können dadurch inkonsistent werden.
- **Ziel:** Alles Dauerhafte liegt in einem verwalteten, gemeinsamen Speicher. Kurzlebige Sitzungen (TV-Kopplung) in einem gemeinsamen Speicher mit Ablauf. Platte und RAM sind nur Cache.

## REL-03 · Firestore als öffentliche Warteschlange
- **Ort:** `server.ts` (ca. 1405 ff., `startFirestoreProxyBridge`), `services/tmdb.ts` (ca. 270-440).
- **Befund:** Clients schreiben Jobs in `tmdbProxyQueue`, der Server hört per `onSnapshot` zu. Jede Instanz verarbeitet dieselben Jobs, ohne dauerhaft zugewiesene CPU läuft der Listener unzuverlässig, und es erzeugt Firestore-Kosten.
- **Ziel:** Für die iOS-Hülle ein normaler, authentifizierter HTTPS-Weg zum eigenen Server statt öffentlicher Datenbank-Queue. Dann entfällt SEC-02 für diese Sammlung.

## REL-04 · Produktionsstart unklar
- **Ort:** `package.json`: `"start": "node server.ts"`, kein `engines`, `vite` nur in `devDependencies`. `server.ts` startet bei `NODE_ENV !== 'production'` den Vite-Dev-Server.
- **Befund:** Läuft die Live-Umgebung ohne gesetztes `NODE_ENV=production`, wird die Dev-Variante ausgeführt (langsam, ungebündelt). `node server.ts` setzt zudem eine Node-Version mit TypeScript-Unterstützung voraus. Es gibt kein Dockerfile im Repo.
- **Ziel:** Eindeutiger Produktionspfad (gebautes Bundle, `NODE_ENV=production`, feste Node-Version in `engines`). **Bitte in der Live-Umgebung prüfen**, ob die Produktionsvariante läuft.

## REL-05 · Native iOS-Hülle unvollständig
- **Ort:** `capacitor.config.ts`, `package.json`.
- **Befund:** Capacitor-Pakete stehen nur im Kommentar, nicht in den Abhängigkeiten. `cleartext: true` erlaubt unverschlüsselten Verkehr. `allowNavigation` lässt jede `*.run.app` zu.
- **Ziel:** Pakete deklarieren, Klartext aus, Navigation auf eigene Domains beschränken.

## REL-06 · Zwei Sync-Systeme
- **Befund:** Nutzerdaten werden in Firestore **und** im Server-Vault geführt und zusammengeführt (Tombstone-Merge). Das ist eine große Fehler- und Kostenfläche.
- **Ziel:** Eine maßgebliche Quelle mit klarer Konfliktregel. Das zweite System entfällt oder wird zum reinen, ersetzbaren Cache.

---

# PHASE 4: CODE-QUALITÄT UND BARRIEREFREIHEIT

## QUAL-01 · React-Typen fehlen
- **Ort:** `package.json`.
- **Befund:** `@types/react` und `@types/react-dom` fehlen. Folge: 12 Typfehler (u. a. 10 in `index.tsx` an `RootErrorBoundary`), JSX und Hooks werden praktisch nicht geprüft. `npm run lint` ist nur `tsc`.
- **Ziel:** Typen ergänzen, alle Fehler beheben, `strict` aktivieren (schrittweise), echtes Linting.

## QUAL-02 · Echter Bug: Kopiert-Meldung erscheint nie
- **Ort:** `views/DetailView.tsx` ca. 559-563, `components/QuickPeekSheet.tsx` ca. 129-133, `services/share.ts`.
- **Befund:** `shareMediaItem` liefert `boolean`, die Aufrufer vergleichen mit `'copied'`. Auf Desktop-Browsern ohne Share-Funktion wird die Zwischenablage gefüllt, aber nie bestätigt.
- **Ziel:** Rückgabe und Aufrufer sind konsistent. Nutzer sieht die Bestätigung.

## QUAL-03 · Tests, Debug-Ausgaben, `any`
- 0 Tests (auch keine für die Firestore-Regeln, Cache-Schlüssel, Sync-Merge), 109-mal `any`, 43 `console.*`.
- **Ziel:** Tests für Auth-Prüfung, Regeln, Sync-Merge, Cache-Schlüssel. Debug-Ausgaben raus oder über kleinen Logger. `any` an Grenzen isolieren.

## QUAL-04 · Doku gleich Realität
- `implementation_plan.md` und `security_spec.md` beschreiben Dinge, die der Code nicht tut (SEC-03, SEC-04). **Ziel:** Nach den Fixes Doku aktualisieren.

## A11Y-01 · Zoom gesperrt, Text nicht markierbar
- **Ort:** `index.html`: `maximum-scale=1.0, user-scalable=no`, `<body class="… select-none">`.
- **Ziel:** Zoom erlauben. `select-none` nur dort, wo es echte Bedienelemente betrifft.

## A11Y-02 · Weitere Punkte
- Kein `prefers-reduced-motion` (siehe PERF-08).
- Nur 89 `aria-`/`alt`/`role`-Treffer bei über 220 `useState`-Stellen und 28 `SafeImage`-Verwendungen. **Ziel:** Rollen, Labels, Fokus-Management in Sheets/Overlays prüfen.

## UX-01 · Tablet-Layouts ungeprüft
- Eigene Breakpoints nur `xs` (480 px) und `3xl` (1920 px), sonst Tailwind-Standard. Die fluiden Größen sind gut, aber es gibt keine erkennbare gezielte Tablet-Logik (iPad hoch/quer, geteilter Bildschirm). **Muss auf Geräten getestet werden.**

---

# POSITIVES (nicht kaputt machen)

- Fluide Größen-Tokens (`--fluid-*`), `dvh` und Safe-Area-Nutzung (ca. 40 bzw. 29 Treffer).
- `requestOrchestrator.ts`: Abbruch, Zusammenfassen gleicher Anfragen.
- Server-Cache mit Stale-While-Revalidate, Einzelflug (Singleflight) und deterministischen Cache-Schlüsseln.
- Firestore-Regeln für `/users/**`: Besitzerprüfung, Schema- und Größenvalidierung.
- Fehlergrenze mit Selbstheilung (`index.tsx`), D-Pad-Navigation (`useSpatialNavigation.ts`), Haptik-Dienst.
- Keine echten Geheimnisse im Repo gefunden. Der Firebase-`apiKey` in `firebase-applet-config.json` ist öffentlich gedacht (nach der Behebung von SEC-02 über Domain-Einschränkungen absichern).

---

# VERIFIZIEREN VOR DEM VERÖFFENTLICHEN (nicht prüfbar im Audit)

- Läuft die Live-Umgebung mit `NODE_ENV=production`? (REL-04)
- Wurden Keys (TMDB, Gemini, Vault-Geheimnis) bereits öffentlich genutzt? Falls ja: rotieren, solange SEC-01 und SEC-02 offen waren.
- Echte Geräte: kleines/großes iPhone, iPad hoch/quer, Android-Handy, Desktop (Chrome/Safari/Firefox/Edge), installierte PWA, iOS-Hülle, Smart-TV-Fernbedienung.
- Lighthouse / Core Web Vitals auf einem Mittelklasse-Handy.
- Store-Anforderungen zum Zeitpunkt der Veröffentlichung (Datenschutz-Angaben, Konto-Löschung in der App, Anmelde-Optionen, Alterseinstufung).

---

# EMPFOHLENE ARBEITSFOLGE

1. **SEC-01 → SEC-02 → SEC-03** (gehören zusammen), dann SEC-04 bis SEC-07, LEG-01.
2. **REL-02, REL-03, REL-06** (Datenhaltung klären, bevor Performance-Feinschliff), dann REL-01, REL-04, REL-05.
3. **PERF-01 bis PERF-05, PERF-09** (größte Hebel), dann PERF-06 bis PERF-08, PERF-10.
4. **QUAL-01 bis QUAL-04, A11Y, UX-01**, danach Geräte-Tests und Veröffentlichungs-Check.
