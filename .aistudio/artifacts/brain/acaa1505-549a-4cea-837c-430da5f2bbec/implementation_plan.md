# MovieJournal — Production Launch, Security-Härtung & Multi-Zyklus Test-Plan

Dieser Plan macht **MovieJournal** in allen Schichten (UI/UX, Frontend-Effizienz, Express-Backend, Firestore-Security, Google-Cloud-Kostenschutz und automatisierte Qualitätssicherung) bereit für den echten Nutzer-Launch auf Smartphone (iOS/Android), Desktop und Smart TV (Hisense VIDAA OS).

---

## 1. UI-Aufräumen für echte Endnutzer (Zero-Developer-Clutter)

Alle internen Entwickler-, Admin- und Infrastruktur-Bedienelemente werden vollständig aus der Benutzeroberfläche entfernt, sodass echte Nutzer ausschließlich ein aufgeräumtes Consumer-Produkt sehen:

- **`views/SettingsView.tsx`**:
  - Vollständige Entfernung des **TMDB Multi-Key Failover-Pool**-Menüpunkts, des Key-Verwaltungs-Sheets (`activeSheet === 'keyPool'`) sowie sämtlicher Client-Aufrufe an `/api/admin/tmdb-keys`.
  - Vollständige Entfernung des Entwickler-Links zum **Firebase Blaze-Plan & Cloud-Billing-Dashboard** aus dem Profilbereich.
  - Vollständige Entfernung nicht genutzter Entwickler-Props (`triggerFullTestFlow`, `onReopenOnboarding`, `replayIntro`, `serverCacheStats`, `refreshServerStats`, `onClearApiCache`) aus `SettingsViewProps`, `App.tsx` und `ConfigContext.tsx`.
  - Beibehaltung der für echte Nutzer relevanten Funktionen: **Konto-Watchlist jetzt synchronisieren**, **Zwei-Faktor-Authentifizierung (2FA)**, **Smart TV per 6-stelligem Code koppeln**, **Streaming-Dienste, Region & Sprache**, **Akzentfarbe** sowie **JSON-Backup Export/Import & Mediathek-Reset**.

---

## 2. Volle Security-Härtung (Backend-API & Firestore Rules)

### 2.1 Express-Backend (`server.ts`)
- **HTTP-Security-Header**:
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` (für HTTPS).
- **Gestaffeltes Rate-Limiting (Bot- & Brute-Force-Schutz)**:
  - **Auth & 2FA (`/api/auth/*`)**: Max. **20 Requests / Minute pro IP** (verhindert Brute-Force-Angriffe auf 6-stellige TOTP- und TV-Kopplungs-Codes).
  - **Gemini AI (`/api/ai/*`)**: Max. **15 Requests / Minute pro IP** + strikte Längenbegrenzung des Prompts (max. 1.200 Zeichen).
  - **User Cloud Sync (`/api/user-sync/*`)**: Max. **60 Requests / Minute pro Nutzer/IP** mit Payload-Validierung.
  - **TMDB-Katalog (`/api/tmdb/*`)**: Max. **360 Requests / Minute pro IP** (durch L1-Cache und Singleflight-Coalescing für echte Nutzer verzögerungsfrei).
  - Automatische Speicherbereinigung abgelaufener Rate-Limit-Buckets alle 5 Minuten (Schutz vor Memory-Leaks).
- **Strikte Token- & Admin-Absicherung**:
  - Die verbleibenden Server-Admin-Endpunkte (`/api/admin/tmdb-keys`) werden im Backend strikt auf den verifizierten Owner-Account (`infoc232@gmail.com`) beschränkt (`403 Forbidden` für alle anderen).
  - Kryptografischer `timingSafeEqual`-Vergleich ohne Längen-Leak bei 2FA-Session-Tickets und TV-Poll-Secrets.

### 2.2 Firestore Security Rules (`firestore.rules` & `firebase-blueprint.json`)
- **Strikte Mandantentrennung (Zero-Trust User Isolation)**:
  - `/users/{userId}` sowie alle Subcollections (`/watchlist/{itemId}`, `/progress/{itemId}`) sind ausnahmslos für `isOwner(userId)` (`request.auth != null && request.auth.uid == userId`) les- und schreibbar.
  - Strikte Schema-, Typ- und Größenvalidierung für jedes Dokument (`isValidUserProfile`, `isValidWatchlistItem`, `isValidWatchProgress`).
- **Härtung der System-Collections**:
  - `list`- und `delete`-Operationen auf `/serverKeyVault`, `/userSecurityVault`, `/regionalCache` und `/tmdbProxyQueue` bleiben komplett gesperrt (`allow list, delete: if false`), sodass kein Auslesen fremder Datensätze möglich ist.
  - Deployment und Validierung der aktualisierten Regeln über ESLint (`@firebase/rules-unit-testing`) und `DeployRules`.

---

## 3. Cloud-Infrastruktur, Multi-Device-Sync & Automatischer Kosten-/Quota-Wächter

Damit die App zu **100 % durch das kostenlose Google-Cloud-/Firestore-Kontingent bzw. dein Startguthaben** gedeckt bleibt und niemals unkontrollierte Kosten verursacht:

- **Automatischer Tages-Budget-Wächter (`DailyCloudQuotaGuard`)**:
  - Überwacht im Server und Client die täglichen Firestore-Schreib-/Lesevorgänge sowie Gemini-AI-Aufrufe mit einem konservativen Sicherheits-Deckel innerhalb des kostenlosen Tagessockels.
  - Bei Erreichen des Tagesschwellenwerts schaltet die App nahtlos und unterbrechungsfrei auf den **Encrypted Server Sync Vault (`/api/user-sync/state` + Disk-Snapshot)** um — für den Nutzer bleibt der Sync über alle Geräte zu 100 % aktiv, ohne dass ein einziger kostenpflichtiger Cloud-Call entsteht.
- **Verlustfreier Multi-Device Account Sync (`services/firebase.ts` & `server.ts`)**:
  - Deterministischer **CRDT-Tombstone-Merge** über alle angemeldeten Geräte (iPhone, Laptop, Hisense Smart TV):
    - Hinzugefügte Filme/Serien und gesehene Episoden werden geräteübergreifend zusammengeführt.
    - Explizite Löschungen (`removedWatchlistKeys`, `removedMovies`, `removedShows`) setzen sich sauber durch, damit gelöschte Einträge nicht von einem anderen Gerät wiederhergestellt werden.
    - Alle Nutzer-Sync-Daten im Server-Vault (`user-cloud-sync-vault.json`) werden zusätzlich mit **AES-256-GCM** at-rest verschlüsselt gespeichert.

---

## 4. Code-Effizienz & Smart-TV / Mobile Performance-Optimierung

- **Frontend-Speicher- & Render-Disziplin**:
  - Deduplizierte State-Updates in `useLocalStorage` und `LibraryContext`, um unnötige Re-Renders der `MovieRow`-Listen zu verhindern.
  - Strikte Begrenzung des Client-Speicher-Caches in `services/tmdb.ts` (LRU-Eviction ab 400 Einträgen), damit der RAM auf dem Hisense Smart TV auch bei langen Sessions stabil bleibt.
  - Hardware-beschleunigtes Zeilen-Scrolling und ausfallsichere D-Pad-Navigation (`useSpatialNavigation.ts`) ohne Layout-Thrashing.

---

## 5. Mehrstufige Automatisierte Test- & Performance-Benchmark-Pipeline

Wir erstellen eine dedizierte, automatisierte Test- und Benchmark-Suite (`tests/productionReadiness.test.ts`), die sämtliche Schichten der Anwendung prüft, und führen sie in **mehreren aufeinanderfolgenden Optimierungs-Zyklen** aus:

1. **Unit- & Datenintegritäts-Tests**:
   - Null-sichere Typ-Konvertierung (`resolveMediaType`, `toMediaKey`), Schema-Coercion in `useLocalStorage` bei korrupten JSON-Daten, deterministische Cache-Key-Normalisierung (`buildDeterministicCacheKey`, `normalizeQueryParamValue`).
2. **Multi-Device-Sync & Konflikt-Tests**:
   - Simulation von 3 parallelen Geräten (TV, iPhone, Desktop) auf demselben Account: Hinzufügen, Episoden-Fortschritt, gezieltes Löschen (Tombstone-Propagation) und Offline-Wiederverbindung.
3. **Security- & Penetrations-Tests**:
   - Prüfung auf unautorisierte Zugriffe (`401`/`403`), Admin-Endpunkt-Sperre für Nicht-Owner, Path-Traversal-Abwehr auf `/api/tmdb/*`, Rate-Limiter-Greifen bei Flood-Requests und 2FA-TOTP-Verifikation.
4. **Performance- & Last-Benchmarks**:
   - Durchsatz- und Latenzmessung für L1-Cache-Lookups (`< 1 ms`), Singleflight-Coalescing bei 500 gleichzeitigen Requests und Speichereffizienz der Payload-Kompaktierung (`compactTmdbPayloadForCache`).
5. **Iterativer Wiederholungs-Zyklus**:
   - **Zyklus 1**: Ausführung aller Tests & Benchmarks → Auswertung der Latenzen und Edge-Cases.
   - **Zyklus 2**: Feinoptimierung und erneuter Komplett-Durchlauf inkl. Firestore-Rules-Test.
   - **Zyklus 3**: Finaler Produktions-Build (`compile_applet` + `lint_applet`) und End-to-End-Abnahme auf dem laufenden Server.
