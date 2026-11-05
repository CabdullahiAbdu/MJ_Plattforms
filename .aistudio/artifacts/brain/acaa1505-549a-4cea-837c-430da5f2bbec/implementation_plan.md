# MovieJournal – Launch-Architektur, UX-Feinschliff & Dual-Release-Plan (PWA + App Store)

Dieser Plan schließt alle verbleibenden Infrastruktur-, Synchronisations- und UI/UX-Lücken vor dem finalen Produktiv-Launch – sowohl als installierbare Web-App (iOS/Android PWA & Hisense Smart TV) als auch für einen nativen App-Store-Release via Capacitor.

## User Review & Critical Decisions

> [!IMPORTANT]
> Basierend auf deiner Auswahl bereiten wir beide Release-Kanäle parallel vor und fokussieren das UI-Update gezielt auf ein absolut ruhiges, verzögerungs- und ruckelfreies Nutzererlebnis (CLS = 0) bei Serien-Staffeln und Detailansichten.

- **Bestätigte Entscheidung 1 (Deployment-Ziel)**: **Parallel-Vorbereitung für PWA / Smart TV WebApp und nativen Apple App Store / Google Play Build (Capacitor)** inklusive produktionsreifer Native-Bridge-Konfiguration, Deep-Link-Routing, Safe-Area-Steuerung und Offline-Support.
- **Bestätigte Entscheidung 2 (UI/UX-Fokus)**: **Layout-Shift-freie Skeletons für Staffel-Episodenlisten** mit festen `16:9`-Bildproportionen, reservierten Container-Höhen beim Staffelwechsel und weichen Crossfade-Übergängen ohne Springen des Inhalts.
- **Empfohlene Infrastruktur-Standards (inkludiert)**:
  1. **Offline-fähiger Service Worker** für sofortigen App-Start im Flugmodus/Funkloch samt gecachter Watchlist & Kalender-Ansicht.
  2. **Multi-Instanz-sichere Cloud-Persistenz für den TMDB-Key-Pool**, damit Cloud-Run-Instanzen bei Auto-Scaling oder Kaltstarts keine im Admin-Dashboard hinterlegten API-Keys verlieren.
  3. **Episoden-Tombstones im Multi-Device-Sync**, damit abgewählte Serien-Episoden auf Zweitgeräten zuverlässig abgewählt bleiben.
  4. **Echtes History-Stack-Verhalten für Detail-Ansichten**, damit die Zurück-Geste auf iPhone, Android und Smart-TV immer zuerst das geöffnete Film-/Serien-Detail schließt, statt die App zu verlassen.

---

## 1. Overview & Core Concept

- **Was geliefert wird**: Eine gegen Kaltstarts, Funklöcher, Multi-Geräte-Races und Layout-Sprünge gehärtete Release-Version von MovieJournal, die ohne Code-Umbau sowohl im Browser/Home-Screen/TV als auch im nativen Capacitor-Container für den Apple App Store und Google Play Store läuft.
- **Zielgruppe & Nutzungskontext**: Film- und Serien-Enthusiasten auf dem iPhone (unterwegs, oft mit wechselndem Mobilfunknetz), auf dem Desktop/Tablet sowie im Wohnzimmer am Hisense VIDAA Smart TV.
- **Kernmehrwert**:
  - **Null Layout-Shifts (CLS = 0)** beim Blättern durch Serien-Staffeln und beim Nachladen von Episodenbildern.
  - **100 % Offline-Verfügbarkeit** der eigenen Bibliothek (Watchlist, gesehene Filme/Episoden, Erscheinungskalender).
  - **Zustandslose Cloud-Run-Skalierbarkeit** ohne Datenverlust bei Container-Neustarts.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Serien-Staffelwechsel ohne Layout-Sprung**: Tippt der Nutzer im Serien-Detail auf eine andere Staffel (z. B. Staffel 1 → Staffel 2), behält der Episoden-Container exakt seine vertikale Geometrie. Statt kurz einzuklappen oder zu flackern, erscheint sofort ein maßstabsgetreues Episoden-Skeleton-Raster (16:9-Stills, Titelzeile, Laufzeit-Badge, Beschreibung und Haken-Button), das nach dem Laden sanft per Opacity-Crossfade in die echten Episodendaten überblendet.
  2. **Nahtlose Zurück-Navigation (Mobile Swipe & Browser Back)**: Öffnet ein Nutzer ein Film-Detail, eine Personen-Filmografie oder eine Kollektion, wird ein echter History-Eintrag angelegt. Die iOS-Safari-Wischgeste vom linken Bildschirmrand sowie die Android-Zurück-Taste schließen exakt die aktuelle Detail-Ebene und kehren an die exakte Scroll-Position der vorherigen Ansicht zurück.
  3. **Offline-Start im Flugmodus**: Startet der Nutzer die App ohne Internetverbindung, lädt der Service Worker die App-Shell sowie gecachte TMDB-Poster verzögerungsfrei aus dem lokalen Speicher. Ein dezenter Hinweis informiert über den Offline-Modus, während Watchlist, Episoden-Fortschritt und Kalender voll bedienbar bleiben und Änderungen bei Rückkehr ins Netz automatisch synchronisieren.
- **Visual Identity & Theme**:
  - *Ästhetische Richtung*: „Atmospheric Minimalism & High-Craft Dark UI“ (Apple-TV- & Linear-inspiriertes OLED-Schwarz `#000000` mit abgestuften Glas-Oberflächen `#141416` und subtilen `1px solid rgba(255,255,255,0.08)` Specular-Rändern).
  - *Farbpalette & Tokens*: Tiefschwarzer Hintergrund (`--background: #000000`), erhöhte Karten-Oberflächen (`rgba(28,28,30,0.75)`), gestochen scharfe weiße Primärtypografie (`#FFFFFF`), gedämpfte Sekundärtexte (`#A1A1AA`) und semantische Statusfarben (Smaragdgrün `#10B981` für „Gesehen“ & Match-Score).
  - *Typografie & Hierarchie*: Klare Größen- und Gewichtsabstufung ohne redundante Unterüberschriften; tabellarische Ziffern (`tabular-nums`) für Laufzeiten, Episodennummern, Bewertungen und Erscheinungsdaten.
  - *Komponenten-Geometrie*: Feste Seitenverhältnisse (`aspect-[2/3]` für Poster, `aspect-video` / `16:9` für Episoden-Stills und Backdrops) verhindern jegliches Nachrutschen von Text oder Buttons während des Bildaufbaus.
- **Interactive Feedback & Motion**:
  - **Episoden-Skeleton-Shimmer**: Sanfter, abgedunkelter OLED-Shimmer (`cinema-shimmer`) in exakt derselben Kartenhöhe (`min-h-[112px]`) wie geladene Episodenzeilen.
  - **Haptisches Feedback & Optimistische UI**: Jedes Abhaken einer Episode oder Umschalten der Watchlist reagiert in `< 16ms` visuell und haptisch, während der Cloud-Vault-Sync im Hintergrund gedrosselt und konfliktfrei abläuft.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Staffel-Episoden-Rendering mit reservierter Geometrie statt dynamischem Mount/Unmount**
  - *Gewählter Ansatz*: Während `seasonDetails` für eine neu gewählte Staffel lädt, wird eine exakt baugleiche Skeleton-Liste mit fester Zeilenhöhe und `16:9`-Thumbnail-Box gerendert; zudem werden bereits besuchte Staffeln derselben Serie im Client-Speicher gecacht, sodass ein Zurückwechseln auf eine zuvor geöffnete Staffel in `0ms` ohne erneuten Ladezustand erfolgt.
  - *Warum*: Verhindert das Zusammenschnurren der Scroll-Fläche beim Staffelwechsel (häufigste Ursache für ungewollte Scroll-Sprünge in mobilen WebViews).
  - *Verworfene Alternative*: Einfacher Lade-Spinner, da dieser die Dokumenthöhe kollabieren lässt und den Scroll-Anker des Nutzers zerstört.
- **Entscheidung 2: Stale-While-Revalidate Service Worker + Native Capacitor-Konfiguration**
  - *Gewählter Ansatz*: Kombination aus einem produktionsreifen Web-Service-Worker (für PWA, Mobile Safari & Smart TV) und einer vollständigen Capacitor-App-Konfiguration (`appId`, `appName`, `server.androidScheme: 'https'`, iOS `contentInset`, Status-Bar-Dark-Mode und CORS-Freigabe für `capacitor://localhost` / `https://localhost`).
  - *Warum*: Damit kann exakt dasselbe gebaute Bundle einerseits sofort als Web-App/PWA genutzt und andererseits ohne Code-Anpassung mit `npx cap sync ios` / `npx cap sync android` für Xcode und Android Studio exportiert werden.
- **Entscheidung 3: Verschlüsseltes Firestore-Backup für den Admin-TMDB-Key-Pool + Episoden-Tombstones**
  - *Gewählter Ansatz*: Der Server spiegelt den AES-256-GCM-verschlüsselten TMDB-Key-Pool in ein server-exklusives Firestore-Dokument (`/serverConfigVault/tmdbKeyPool`, in `firestore.rules` für alle Clients mit `allow read, write: if false;` gesperrt, aber über den Server-Prozess les-/schreibbar via signiertem Server-Token bzw. geschütztem Vault-Eintrag) und erweitert den `userLibraryVault`-Merge um `removedEpisodes: Record<string, number>`.
  - *Warum*: Garantiert, dass bei Cloud-Run-Neustarts keine im Dashboard gepflegten TMDB-Keys verloren gehen und das Abwählen einzelner Episoden auf allen Geräten konsistent bleibt.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    CLIENT SHELL (PWA / iOS Capacitor / VIDAA TV)                  │
│                                                                                   │
│  ┌──────────────────────┐   ┌────────────────────────┐   ┌─────────────────────┐  │
│  │  Service Worker      │   │  NavigationContext     │   │  LibraryContext     │  │
│  │  (App-Shell + Poster │   │  (pushState Back-Stack │   │  (Watchlist, Movies,│  │
│  │   SWR Offline Cache) │   │   & Scroll Restore)    │   │   Episode Tombstone)│  │
│  └──────────┬───────────┘   └───────────┬────────────┘   └──────────┬──────────┘  │
│             │                           │                           │             │
│             ▼                           ▼                           ▼             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                        DetailView & Season Episode List                     │  │
│  │  • In-Memory Season Cache (0ms switch back to visited seasons)              │  │
│  │  • Zero-CLS 16:9 Episode Skeletons (fixed row geometry during fetch)        │  │
│  └──────────────────────────────────────┬──────────────────────────────────────┘  │
└─────────────────────────────────────────┼─────────────────────────────────────────┘
                                          │ HTTPS / REST + Firestore Realtime
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                  GOOGLE CLOUD RUN (Stateless Express + Vite Server)               │
│                                                                                   │
│  ┌──────────────────────────────┐               ┌──────────────────────────────┐  │
│  │  Multi-Key TMDB Pool         │               │  User Sync & Security API    │  │
│  │  • Circuit Breaker & Rotate  │               │  • /api/user-sync/state      │  │
│  │  • L1 RAM + Disk + Firestore │               │  • /api/user-sync/delete     │  │
│  │    Encrypted Key Vault Sync  │               │  • Episode Tombstone Merge   │  │
│  └──────────────┬───────────────┘               └───────────────┬──────────────┘  │
└─────────────────┼───────────────────────────────────────────────┼─────────────────┘
                  │                                               │
                  ▼                                               ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE CLOUD FIRESTORE DATABASE                           │
│  • /userLibraryVault/{uid}    (1-Doc Atomic Sync + Watchlist/Episode Tombstones)  │
│  • /userSecurityVault/{uid}   (2FA TOTP & Backup Code Hashes)                     │
│  • /tmdbSharedCache/{hash}    (L2 Shared Regional TMDB Response Cache)            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Erweitertes `SyncUserLibraryState`-Modell**:
    - `watchlist: MediaItem[]` (kompaktifizierte Metadaten + `_addedAtMs`)
    - `watchedMovies: number[]`
    - `manuallyWatchedShows: number[]`
    - `watchedEpisodes: Record<number, number[]>`
    - `removedWatchlistKeys: Record<string, number>`
    - `removedMovies: Record<string, number>`
    - `removedShows: Record<string, number>`
    - `removedEpisodes: Record<string, number>` *(Neu: Schlüssel `"${seriesId}:${episodeId}"` → Lösch-Zeitstempel in ms, verhindert Wiederauftauchen abgewählter Episoden beim Multi-Geräte-Merge)*
  - **Staffel-Episoden-Cache & Ladezustand (`DetailView`)**:
    - `seasonCacheRef: Map<number, SeasonDetails>` hält bereits geladene Staffeln der geöffneten Serie im Speicher.
    - `loadingSeasonNumber: number | null` steuert das Layout-Shift-freie Episoden-Skeleton während des Staffelwechsels, ohne die bestehende Header- oder Tab-Geometrie zu verändern.

- **Interactive Component & State Mapping**:
  - **Staffel-Auswahl (`handleSeasonChange`)**:
    1. Prüft zuerst `seasonCacheRef.current.get(seasonNumber)` → bei Treffer sofortiges Setzen von `seasonDetails` ohne Netzwerk-Request und ohne Skeleton (`0ms`).
    2. Bei Cache-Miss wird `loadingSeasonNumber = seasonNumber` gesetzt; der Episoden-Container rendert 6 maßstabsgetreue Episoden-Skeleton-Karten (`min-h-[116px]`, festes `16:9` Vorschaubild-Rechteck links, Titel-/Metadaten-Balken mittig, runder Check-Button-Platzhalter rechts).
    3. Nach Abschluss von `tmdb.getTvSeasonDetails` werden die Daten im `seasonCacheRef` abgelegt und sanft eingeblendet.
  - **Episoden-Abhaken (`toggleEpisodeWatched`)**:
    1. Beim Abhaken einer Episode wird diese zu `watchedEpisodes[seriesId]` hinzugefügt und ein eventueller Eintrag in `removedEpisodes["${seriesId}:${episodeId}"]` gelöscht.
    2. Beim Abwählen einer Episode wird `removedEpisodes["${seriesId}:${episodeId}"] = Date.now()` gesetzt und beim Cloud-Merge (`mergeUserSyncLibraryState` auf Client & Server) berücksichtigt.
  - **History-Navigation (`NavigationContext`)**:
    1. Öffnen eines Details (`handleExpand` / `navigateToDetail`) nutzt `window.history.pushState`, wenn von einem Tab in ein Detail gewechselt wird, sodass die native iOS-Swipe-Back-Geste und der Browser-Zurück-Button das Detail schließen, ohne die App zu verlassen.
  - **Dual-Release-Packaging (PWA + Capacitor)**:
    1. Registrierung eines produktionsreifen `/sw.js` Service Workers (App-Shell + TMDB-Poster-Cache mit Quota-Schutz) für sofortigen Offline-Start.
    2. Bereitstellung einer direkt einsatzbereiten `capacitor.config.json` für den Export nach iOS (Xcode / App Store Connect) und Android (Android Studio / Google Play Console).
