# MovieJournal – Vollständiger Audit-Behebungsplan (Phasen 1 bis 4)

Dieser Plan setzt alle offenen Sicherheits-, Zuverlässigkeits-, Performance-, Rechts- und Qualitätsbefunde aus dem Audit (`AUDIT_FINDINGS`) strikt nach deinen neuen Engineering-Prinzipien (Zero-Trust, Fail-Closed, Single Source of Truth, 60fps Fluidity, WCAG 2.2 AA) in einem vollständigen Durchgang um.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle drei Grundsatzentscheidungen aus der Klärungsrunde sind verbindlich im Architekturplan verankert. Es gibt keine stillen Fallbacks oder Kompromisse bei der Sicherheit.

- **Bestätigte Entscheidung 1 (Umfang)**: **Vollständige Behebung aller 4 Audit-Phasen (`SEC`, `REL`, `PERF`, `QUAL`, `A11Y`, `LEG`)** in einem zusammenhängenden Durchgang.
- **Bestätigte Entscheidung 2 (`SEC-02` & `REL-03`)**: **Vollständige Entfernung der öffentlichen Firestore-Proxy-Queue (`tmdbProxyQueue`)**. Alle Clients (Web, PWA, Native iOS Capacitor, Smart TV) kommunizieren direkt über authentifiziertes/erlaubtes HTTPS mit dem Server; `tmdbProxyQueue`, `regionalCache` und `serverKeyVault` werden in den Firestore-Sicherheitsregeln für Clients komplett gesperrt (`allow read, write: if false;`), und `userLibraryVault` sowie `userSecurityVault` erzwingen striktes `isOwner(userId)`.
- **Bestätigte Entscheidung 3 (`REL-06` & `PERF-10`)**: **Firestore (`userLibraryVault/{userId}` mit aktiviertem lokalem Offline-Cache `persistentLocalCache`) ist die einzige maßgebliche Quelle (Single Source of Truth)** für Nutzerdaten. Der Server-Endpunkt `/api/user-sync/state` greift bei Bedarf mit dem kryptografisch verifizierten Bearer-Token des Nutzers direkt auf dessen `userLibraryVault/{uid}`-Dokument zu, statt eine zweite konkurrierende Datei-Datenbank zu führen.

---

## 1. Overview & Core Concept

- **Was geliefert wird**: Eine gegen Token-Manipulation, unautorisierte Datenbankzugriffe, Cache-Poisoning, Event-Loop-Blockaden und Layout-Sprünge gehärtete Produktionsversion von MovieJournal.
- **Zielgruppe & Betriebsumgebung**: Öffentlicher Produktivbetrieb auf Google Cloud Run (skalierend über mehrere Instanzen), iOS/Android PWA, Native iOS Shell (Capacitor) und Hisense VIDAA Smart TV.
- **Kernmehrwert**:
  - **Kryptografische Zero-Trust-Sicherheit (`SEC-01` bis `SEC-07`)**: Jedes Firebase-ID-Token wird mittels RS256-Signatur gegen Googles X.509-Zertifikate sowie `accounts:lookup` geprüft; schlägt die Prüfung fehl, antwortet der Server garantiert mit `401 Unauthorized` (Fail-Closed).
  - **Sofortiger Start & echte Offline-Fähigkeit (`PERF-01` bis `PERF-10`)**: Entfernung des alten Service-Worker-Kill-Skripts, Vendor-Chunk-Splitting, reduzierte Schriften, HTTP-Komprimierung (Brotli/Gzip), `ETag`/`Cache-Control`, Viewport-gesteuertes Nachladen von Reihen mit Skeletons sowie lokaler Firestore-Persistenz-Cache.
  - **Rechts- & Barrierefreiheits-Konformität (`LEG-01`, `A11Y-01`, `A11Y-02`)**: Direkt sichtbares offizielles TMDB-Logo samt Pflichthinweis, aktivierter Pinch-Zoom, saubere Text-Selektion und volle Unterstützung für `prefers-reduced-motion`.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Verzögerungsfreier Kalt- und Wiederholungsstart (`PERF-01`, `PERF-02`, `PERF-03`, `PERF-10`)**: Beim ersten Laden werden nur das Kernsystem und die zwei reduzierten Schriftfamilien (*DM Sans* & *Plus Jakarta Sans*) geladen. Beim zweiten Besuch starten App-Hülle und Watchlist dank aktivem Service Worker und lokalem Firestore-Offline-Cache sofort – selbst im Flugmodus.
  2. **Ruckelfreies Scrollen durch Katalog-Reihen (`PERF-05`, `PERF-06`, `PERF-08`)**: Reihen unterhalb des sichtbaren Bereichs laden ihre Daten erst bei Annäherung an den Viewport (`IntersectionObserver` mit `400px` Vorlauf) und reservieren währenddessen ihre exakte Höhe über ein maßstabsgetreues Row-Skeleton. Memoisierte Medienkarten (`React.memo`) mit stabilen Schlüsseln (`media_type + id`) und reduzierten Blur-Effekten auf TV/Low-End-Geräten sichern stabile 60 fps.
  3. **Barrierefreie Bedienung & Tablet-/TV-Anpassung (`A11Y-01`, `A11Y-02`, `UX-01`)**: Nutzer können jederzeit frei per Pinch-to-Zoom vergrößern, Filmbeschreibungen markieren/kopieren und profitieren bei aktivierter Systemeinstellung „Bewegung reduzieren“ (`prefers-reduced-motion: reduce`) von sofortigen, ruhigen Übergängen ohne Schwindel-Animationen. Auf Tablets (iPad Hoch-/Querformat & Split-View) passt sich das Grid stufenlos über dedizierte `md:`/`lg:`-Spaltenzahlen an.
  4. **Sichtbare TMDB-Attribution (`LEG-01`)**: Im Footer der Einstellungen sowie im Info-Bereich sind das offizielle TMDB-Logo und der vorgeschriebene Hinweis (*„This product uses the TMDB API but is not endorsed or certified by TMDB.“*) direkt sichtbar eingebettet.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1 (`SEC-01`): Zweistufige kryptografische Token-Prüfung mit Fail-Closed statt Base64-Fallback**
  - *Gewählter Ansatz*: `verifyFirebaseIdToken` prüft zuerst die RS256-Signatur, den Aussteller (`https://securetoken.google.com/<projectId>`), die Zielgruppe (`aud`), die Ablaufzeit (`exp`) und die Subjekt-ID (`sub`) kryptografisch mit Node.js `crypto.verify` gegen Googles gecachte X.509-Zertifikate (oder Google Identity Toolkit `accounts:lookup`). Jeder ungültige, abgelaufene oder unsignierte Token führt ausnahmslos zu `null` (`401 Unauthorized`). Der alte Base64-Decode-Fallback wird ersatzlos gestrichen.
  - *Warum*: Verhindert jede Form von Account-Übernahme oder Admin-Privilege-Escalation durch manipulierte JWTs.
- **Entscheidung 2 (`SEC-02`, `REL-02`, `REL-03`, `REL-06`): Authentifizierter Firestore-REST-Zugriff vom Server + geschlossene Firestore-Regeln**
  - *Gewählter Ansatz*:
    1. In den Firestore-Regeln werden `regionalCache`, `tmdbProxyQueue` und `serverKeyVault` komplett für Clients gesperrt (`allow read, write: if false;`).
    2. `userLibraryVault/{userId}` und `userSecurityVault/{userId}` erlauben Lese- und Schreibzugriffe ausschließlich für den authentifizierten Eigentümer (`isOwner(userId)` mit Schema-Validierung).
    3. Wenn der Server bei `/api/user-sync/state` oder `/api/auth/2fa/*` auf `userLibraryVault/{uid}` bzw. `userSecurityVault/{uid}` zugreift, sendet er das bereits verifizierte Firebase-ID-Token des Nutzers als `Authorization: Bearer <idToken>` an die Firestore-REST-API. Dadurch prüft Firestore auch bei Server-Anfragen kryptografisch `request.auth.uid == userId`!
  - *Warum*: Eliminiert das unauthentifizierte Client-SDK auf dem Server, schließt alle offenen Collections aus `SEC-02` und konsolidiert die Datenhaltung auf eine einzige maßgebliche Quelle (`REL-06`).
- **Entscheidung 3 (`PERF-04`, `PERF-09`): Asynchroner, kompakter Disk-Cache + HTTP-Gzip/Brotli-Komprimierung**
  - *Gewählter Ansatz*: Antworten von `/api/tmdb/*` erhalten deterministische `ETag`- und `Cache-Control: public, max-age=300, stale-while-revalidate=3600`-Header sowie automatische Gzip/Brotli-Komprimierung ab 1 KB Payload. Der lokale L1-Snapshot wird asynchron (`fs.promises.writeFile`), gedrosselt (maximal 350 kompakte Einträge) geschrieben und `.cache/` in `.gitignore` eingetragen.
  - *Warum*: Verhindert Event-Loop-Blockaden auf Cloud Run und reduziert die übertragene Datenmenge um über 75 %.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                 CLIENT APPS (Web / PWA / Capacitor iOS / Smart TV)                │
│                                                                                   │
│  ┌────────────────────────┐  ┌─────────────────────────┐  ┌────────────────────┐  │
│  │  Service Worker (/sw)  │  │  Firestore SDK          │  │  UI & Views        │  │
│  │  • App-Shell Precache  │  │  • persistentLocalCache │  │  • Lazy Chunks     │  │
│  │  • Poster SWR Cache    │  │  • Direct Owner Sync to │  │  • Viewport Rows   │  │
│  │  • Clean Version Roll  │  │    /userLibraryVault    │  │  • Reduced Motion  │  │
│  └───────────┬────────────┘  └────────────┬────────────┘  └─────────┬──────────┘  │
└──────────────┼────────────────────────────┼─────────────────────────┼─────────────┘
               │ HTTPS (Gzip/Brotli + ETag) │ Owner Auth (`request.auth.uid == uid`)
               ▼                            ▼
┌────────────────────────────────────────┐  ┌───────────────────────────────────────┐
│     CLOUD RUN SERVER (Stateless)       │  │       GOOGLE CLOUD FIRESTORE          │
│                                        │  │                                       │
│  • RS256 Crypto JWT Verifier           │  │  • /users/{uid}/**        [isOwner]   │
│    (Fail-Closed, No Unsigned Fallback) │  │  • /userLibraryVault/{uid}[isOwner]   │
│  • Strict CORS + CSP + HSTS Headers    │  │  • /userSecurityVault/{u} [isOwner]   │
│  • Bounded Proxy-Aware Rate Limiter    ├──►  • /regionalCache/**      [LOCKED]    │
│  • Authenticated Firestore REST Bridge │  │  • /tmdbProxyQueue/**     [LOCKED]    │
│    (Forwards Verified User Bearer JWT) │  │  • /serverKeyVault/**     [LOCKED]    │
└────────────────────────────────────────┘  └───────────────────────────────────────┘
```

- **Vollständige Zuordnung aller Audit-Befunde zur technischen Umsetzung**:
  - **`SEC-01` (Fail-Closed Token-Prüfung)**: `verifyFirebaseIdToken` prüft Header (`alg === 'RS256'`, `kid`), Zeitstempel (`exp`, `iat`), `aud === firebaseProjectId` und `iss === https://securetoken.google.com/${firebaseProjectId}` sowie die kryptografische Signatur gegen Googles X.509-Zertifikate bzw. `accounts:lookup`. Kein unsignierter Fallback.
  - **`SEC-02` & `REL-03` (Firestore-Regeln & Entfernung der Queue)**: `regionalCache`, `tmdbProxyQueue` und `serverKeyVault` werden in `firestore.rules` gesperrt (`allow read, write: if false;`) und live deployed. `userLibraryVault/{userId}` und `userSecurityVault/{userId}` verlangen `isOwner(userId)`. `fetchViaFirestoreProxyBridge` wird aus dem TMDB-Client entfernt.
  - **`SEC-03` (Admin-Endpunkte)**: `isAuthorizedAdminOwner` prüft gegen `process.env.ADMIN_OWNER_UID` bzw. die verifizierte Owner-Kennung; Nicht-Owner erhalten strikt `403 Forbidden`.
  - **`SEC-04` (Security Headers, Rate-Limiter & Client-Error-Bounds)**: `app.set('trust proxy', 1)`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Permissions-Policy`; Obergrenze (`MAX_RATE_BUCKETS = 5000`) für `ipTierBuckets`; strikte Größen- und Typbegrenzung sowie eigenes Rate-Limit auf `/api/client-error`.
  - **`SEC-05` (Dediziertes Vault-Secret)**: Eigenständige Schlüsselableitung über `process.env.VAULT_SECRET` (bzw. kryptografisch generiertes, isoliertes Server-Geheimnis mit `v2:`-Versionspräfix statt Wiederverwendung von `TMDB_API_KEY` oder `GEMINI_API_KEY`).
  - **`SEC-06` (Strikte CORS-Allowlist)**: Nur die expliziten App-Origins (`ais-dev-...`, `ais-pre-...`, `process.env.ALLOWED_ORIGIN`), `capacitor://localhost`, `ionic://localhost` sowie `localhost` ausschließlich im Entwicklungsmodus.
  - **`SEC-07` (Authentifizierte Bewertungen)**: `POST /api/tmdb/*` erfordert ein verifiziertes Nutzer-Token (`verifyFirebaseIdToken`), eigenes Rate-Limit (`rating`-Tier) und validiert `{ value: 0.5 .. 10.0 }`.
  - **`LEG-01` (TMDB-Attribution)**: Sichtbares offizielles TMDB-Badge und der englische/deutsche Pflichthinweis direkt im Footer der Einstellungen sowie im Info-Dialog.
  - **`PERF-01` bis `PERF-10` (Bundle, Fonts, SW, HTTP-Cache, Lazy-Rows, Reduced-Motion, Async-Cache, Firestore-Offline-Cache)**:
    - Manuelles Vendor-Chunking (`firebase`, `react`, `icons`) in der Build-Konfiguration.
    - Bereinigung von `index.html`: Entfernung von `Pacifico` & `Yellowtail`, Entfernung des Service-Worker-Unregister-Skripts.
    - HTTP-Komprimierung (Brotli/Gzip) und `Cache-Control` + `ETag` (`304 Not Modified`) für `/api/tmdb/*`.
    - `SmartRow` lädt unterhalb des Viewports erst per `IntersectionObserver` und zeigt während des Ladens ein höhenstabiles Row-Skeleton statt `null`.
    - `MediaCard` wird mit `React.memo` umschlossen; alle dynamischen Listen nutzen stabile IDs statt Array-Indizes.
    - `@media (prefers-reduced-motion: reduce)` deaktiviert nicht-essenzielle Animationen und teure Effekte.
    - Asynchrones Cache-Schreiben (`fs.promises.writeFile`) und `.cache/` in `.gitignore`.
    - Firestore-Initialisierung mit `initializeFirestore` + `persistentLocalCache`.
  - **`QUAL-01` bis `QUAL-04`, `A11Y-01`, `A11Y-02`, `UX-01`**:
    - Installation/Prüfung von `@types/react` & `@types/react-dom`, saubere Typisierung ohne Fehler in `tsc --noEmit`.
    - Viewport-Meta erlaubt Pinch-Zoom (`width=device-width, initial-scale=1.0, viewport-fit=cover`); `select-none` wird vom `<body>` entfernt und nur auf echte Buttons/Controls angewandt.
    - Erweiterte automatisierte Test-Suite (`tests/productionReadiness.test.ts`), die `SEC-01` (Ablehnung gefälschter/unsignierter Tokens), `SEC-03` (403 für Nicht-Owner), `SEC-04` (Security-Header & Rate-Limiter-Bounds), `SEC-06` (CORS-Ablehnung fremder `.run.app`-Domains) und `SEC-07` (401 bei unauthentifiziertem POST-Rating) direkt verifiziert.
