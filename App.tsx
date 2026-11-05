import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { AppView, resolveMediaType } from './types';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { getTwoFactorStatus, approveTvPairingSession } from './services/firebase';
import { useSpatialNavigation } from './hooks/useSpatialNavigation';
import { Tv, Check, X } from './components/Icons';

// Modular Context Providers
import { ConfigProvider, useConfig } from './context/ConfigContext';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { AmbientProvider } from './context/AmbientContext';

// Eager Critical Shell & Default HomeView (Phase 1: <2s First Visible Content)
import { BottomNav } from './components/BottomNav';
import { TvTopBurgerNav } from './components/TvTopBurgerNav';
import { GlobalBackground } from './components/GlobalBackground';
import { Transitor } from './components/Transitor';
import { DynamicIslandBar } from './components/DynamicIslandBar';
import { QuickPeekSheet } from './components/QuickPeekSheet';
import { HomeView } from './views/HomeView';

// Phase 1: Dynamic Code-Splitting per Tab & Overlay (reduces initial JS bundle & parse work)
const IntroOpener = lazy(() =>
  import('./components/IntroOpener').then((m) => ({ default: m.IntroOpener }))
);
const SearchView = lazy(() =>
  import('./views/SearchView').then((m) => ({ default: m.SearchView }))
);
const WatchlistView = lazy(() =>
  import('./views/WatchlistView').then((m) => ({ default: m.WatchlistView }))
);
const CalendarView = lazy(() =>
  import('./views/CalendarView').then((m) => ({ default: m.CalendarView }))
);
const ProviderView = lazy(() =>
  import('./views/ProviderView').then((m) => ({ default: m.ProviderView }))
);
const SettingsView = lazy(() =>
  import('./views/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const DetailView = lazy(() =>
  import('./views/DetailView').then((m) => ({ default: m.DetailView }))
);
const OnboardingView = lazy(() =>
  import('./views/OnboardingView').then((m) => ({ default: m.OnboardingView }))
);
const AuthView = lazy(() =>
  import('./views/AuthView').then((m) => ({ default: m.AuthView }))
);

const ViewSkeletonFallback: React.FC = () => (
  <div className="min-h-screen px-[var(--fluid-page-px)] pt-12 pb-28 space-y-6 animate-fade-in">
    <div className="h-8 w-48 rounded-xl cinema-shimmer" />
    <div className="w-full h-[clamp(220px,35dvh,360px)] rounded-3xl cinema-shimmer" />
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3.5">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div key={idx} className="aspect-[2/3] rounded-2xl cinema-shimmer" />
      ))}
    </div>
  </div>
);

const AppShell: React.FC = () => {
  const {
    kinoCheckKey,
    language,
    setLanguage,
    region,
    setRegion,
    theme,
    setTheme,
    includeAdult,
    setIncludeAdult,
    autoplay,
    setAutoplay,
    dataSaver,
    setDataSaver,
    onboardingComplete,
    setOnboardingComplete,
    userGenres,
    setUserGenres,
    userProviders,
    setUserProviders,
    tmdb,
    showIntro,
    completeIntro,
    setAuthPromptSeen,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    currentUser,
    isAuthReady,
    isCloudSynced,
    loginWithGoogle,
    loginWithApple,
    loginWithEmail,
    registerUserWithEmail,
    sendResetPasswordEmail,
    logoutUser,
    tvMode,
    setTvMode,
    isTvMode,
  } = useConfig();

  const {
    watchlist,
    watchedEpisodes,
    watchedMovies,
    manuallyWatchedShows,
    watchedCompositeKeys,
    isInWatchlist,
    toggleWatchlist,
    toggleEpisodeWatched,
    toggleMovieWatched,
    toggleShowFullyWatched,
    exportLibraryJson,
    importLibraryJson,
    resetLibraryData,
  } = useLibrary();

  const {
    activeTab,
    activeOverlay,
    expandingItem,
    notification,
    switchTab,
    navigateToDetail,
    handleExpand,
    closeExpand,
    goBack,
    showNotification,
  } = useNavigation();

  const isOnline = useOnlineStatus();
  const [requiresTwoFactorChallenge, setRequiresTwoFactorChallenge] = useState(false);
  const [firstPaintDone, setFirstPaintDone] = useState(false);

  // Phase 1: Defer ambient background rendering until after First Paint
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setFirstPaintDone(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // QR-Code Second-Screen TV Pairing Companion state (?tvPair=XXXXXX scanned from iPhone)
  const [pendingTvPairCode, setPendingTvPairCode] = useState<string | null>(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('tvPair');
      return code ? code.replace(/\D/g, '').slice(0, 6) : null;
    } catch {
      return null;
    }
  });
  const [tvPairBusy, setTvPairBusy] = useState(false);
  const [tvPairSuccess, setTvPairSuccess] = useState(false);
  const [tvPairError, setTvPairError] = useState<string | null>(null);

  const clearTvPairUrlParam = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('tvPair')) {
        url.searchParams.delete('tvPair');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
  }, []);

  const handleConfirmScannedTvPair = async () => {
    if (!pendingTvPairCode || pendingTvPairCode.length !== 6) return;
    setTvPairBusy(true);
    setTvPairError(null);
    try {
      await approveTvPairingSession(pendingTvPairCode);
      setTvPairSuccess(true);
      clearTvPairUrlParam();
      showNotification(
        language.startsWith('de')
          ? 'Smart TV erfolgreich verbunden!'
          : 'Smart TV successfully signed in!',
        'success'
      );
      setTimeout(() => {
        setPendingTvPairCode(null);
        setTvPairSuccess(false);
      }, 1800);
    } catch (e: any) {
      setTvPairError(
        e?.message ||
          (language.startsWith('de')
            ? 'TV-Kopplung fehlgeschlagen oder abgelaufen.'
            : 'TV pairing failed or expired.')
      );
    } finally {
      setTvPairBusy(false);
    }
  };

  // Global D-Pad Spatial Navigation & Hisense VIDAA Remote Key Engine
  useSpatialNavigation({
    enabled: true,
    isTvMode,
    onBackAction: () => {
      if (pendingTvPairCode) {
        setPendingTvPairCode(null);
        clearTvPairUrlParam();
        return true;
      }
      if (isAuthModalOpen && currentUser && !requiresTwoFactorChallenge) {
        closeAuthModal();
        return true;
      }
      if (expandingItem) {
        closeExpand();
        return true;
      }
      if (activeOverlay) {
        goBack();
        return true;
      }
      if (activeTab !== AppView.HOME) {
        switchTab(AppView.HOME);
        return true;
      }
      return false;
    },
    onColorKey: (color) => {
      if (color === 'red') {
        if (isTvMode) {
          window.dispatchEvent(new CustomEvent('mj:toggle-tv-menu'));
        } else {
          switchTab(AppView.HOME);
        }
      } else if (color === 'green') switchTab(AppView.SEARCH);
      else if (color === 'yellow') switchTab(AppView.WATCHLIST);
      else if (color === 'blue') {
        switchTab(AppView.HOME);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('mj:open-smart-shuffle'));
        }, 60);
      }
    },
    onToggleTvMenu: () => {
      window.dispatchEvent(new CustomEvent('mj:toggle-tv-menu'));
    },
  });

  // Verify 2FA session ticket on boot when a user is signed in
  useEffect(() => {
    let active = true;
    if (!currentUser) {
      setRequiresTwoFactorChallenge(false);
      return;
    }
    getTwoFactorStatus(currentUser)
      .then((status) => {
        if (!active) return;
        setRequiresTwoFactorChallenge(status.twoFactorEnabled && !status.sessionVerified);
      })
      .catch(() => {
        if (active) setRequiresTwoFactorChallenge(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser?.uid]);

  const handleResetLibrary = () => {
    resetLibraryData();
    showNotification('Library & Watchlist reset', 'info');
  };

  const requiresInitialAuthGate = isAuthReady && (!currentUser || requiresTwoFactorChallenge);
  const shouldShowStandaloneIntro =
    showIntro && (!isAuthReady || (Boolean(currentUser) && !requiresTwoFactorChallenge));
  const shouldShowAuthStage = requiresInitialAuthGate || isAuthModalOpen;

  const shouldShowOnboarding =
    !showIntro &&
    isAuthReady &&
    Boolean(currentUser) &&
    !shouldShowAuthStage &&
    !onboardingComplete &&
    Boolean(tmdb);

  return (
    <div
      className="fixed inset-0 bg-black text-white font-sans selection:bg-accent-300 overflow-hidden"
      data-theme={theme}
    >
      {/* Dynamic Island / Notch Integration */}
      <DynamicIslandBar
        tmdb={tmdb}
        notification={notification}
        isOnline={isOnline}
        language={language}
      />

      {/* 1. Standalone 60fps Cinema Projector Intro (Deferred until after First Paint) */}
      {shouldShowStandaloneIntro && tmdb && (
        <Suspense fallback={null}>
          <IntroOpener tmdb={tmdb} region={region} onComplete={completeIntro} />
        </Suspense>
      )}

      {/* 2. Mandatory Account Login & 2FA Gate Stage */}
      {shouldShowAuthStage && tmdb && (
        <Suspense fallback={<ViewSkeletonFallback />}>
          <AuthView
            tmdb={tmdb}
            language={language}
            region={region}
            isTvMode={isTvMode}
            isModal={isAuthModalOpen && Boolean(currentUser) && !requiresTwoFactorChallenge}
            startWithIntro={showIntro && !isAuthModalOpen && !requiresTwoFactorChallenge}
            forceTwoFactorChallenge={requiresTwoFactorChallenge}
            currentUserName={
              currentUser
                ? currentUser.displayName || currentUser.email?.split('@')[0] || 'Cinephile'
                : null
            }
            onIntroCompleted={completeIntro}
            onCloseModal={() => {
              if (currentUser && !requiresTwoFactorChallenge) {
                closeAuthModal();
                setAuthPromptSeen(true);
              }
            }}
            onSuccess={(msg) => {
              setRequiresTwoFactorChallenge(false);
              completeIntro();
              setAuthPromptSeen(true);
              closeAuthModal();
              showNotification(msg, 'success');
            }}
            onSignOutDuringChallenge={async () => {
              setRequiresTwoFactorChallenge(false);
              await logoutUser();
            }}
            loginWithGoogle={loginWithGoogle}
            loginWithApple={loginWithApple}
            loginWithEmail={loginWithEmail}
            registerUserWithEmail={registerUserWithEmail}
            sendResetPasswordEmail={sendResetPasswordEmail}
          />
        </Suspense>
      )}

      {/* Ambient Background (Mounted after First Paint so Hero renders first) */}
      {firstPaintDone && (
        <div className="absolute inset-0 z-0">
          <GlobalBackground tmdb={tmdb} />
        </div>
      )}

      {/* Active-Tab-Only Rendering with Per-Tab Code-Splitting & Skeleton Fallbacks */}
      {tmdb && (
        <main className="relative w-full h-full z-10 overflow-y-auto overflow-x-hidden no-scrollbar ios-touch-rail pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
          <Suspense fallback={<ViewSkeletonFallback />}>
            {activeTab === AppView.HOME && (
              <HomeView
                tmdb={tmdb}
                navigate={navigateToDetail}
                onExpand={handleExpand}
                watchlist={watchlist}
                watchedCompositeKeys={watchedCompositeKeys}
                watchedEpisodes={watchedEpisodes}
                onToggleWatchlist={(item) => toggleWatchlist(item, showNotification)}
                userGenres={userGenres}
                userProviders={userProviders}
              />
            )}

            {activeTab === AppView.SEARCH && (
              <SearchView
                tmdb={tmdb}
                navigate={navigateToDetail}
                onExpand={handleExpand}
                userProviders={userProviders}
                watchlist={watchlist}
                watchedCompositeKeys={watchedCompositeKeys}
                userGenres={userGenres}
              />
            )}

            {activeTab === AppView.CALENDAR && (
              <CalendarView
                tmdb={tmdb}
                watchlist={watchlist}
                navigate={navigateToDetail}
                onExpand={handleExpand}
              />
            )}

            {activeTab === AppView.WATCHLIST && (
              <WatchlistView
                watchlist={watchlist}
                tmdb={tmdb}
                navigate={navigateToDetail}
                onExpand={handleExpand}
                watchedEpisodes={watchedEpisodes}
                watchedMovies={watchedMovies}
                manuallyWatchedShows={manuallyWatchedShows}
                onToggleMovieWatched={toggleMovieWatched}
                onToggleShowWatched={toggleShowFullyWatched}
              />
            )}

            {activeTab === AppView.SETTINGS && (
              <SettingsView
                tmdb={tmdb}
                currentLanguage={language}
                setLanguage={setLanguage}
                currentRegion={region}
                setRegion={setRegion}
                onResetLibrary={handleResetLibrary}
                onExportLibrary={exportLibraryJson}
                onImportLibrary={(rawJson) => {
                  const ok = importLibraryJson(rawJson);
                  return { ok, count: ok ? watchlist.length : 0 };
                }}
                onNotify={showNotification}
                currentTheme={theme}
                setTheme={setTheme}
                userProviders={userProviders}
                setUserProviders={setUserProviders}
                autoplay={autoplay}
                setAutoplay={setAutoplay}
                dataSaver={dataSaver}
                setDataSaver={setDataSaver}
                includeAdult={includeAdult}
                setIncludeAdult={setIncludeAdult}
                currentUser={currentUser}
                isCloudSynced={isCloudSynced}
                openAuthModal={openAuthModal}
                logoutUser={logoutUser}
                tvMode={tvMode}
                setTvMode={setTvMode}
                isTvMode={isTvMode}
              />
            )}
          </Suspense>
        </main>
      )}

      {/* Fluid Shared-Element Card Expansion into Fullscreen DetailView */}
      {expandingItem && tmdb && !activeOverlay && (
        <Transitor
          item={expandingItem.item}
          initialRect={expandingItem.rect}
          tmdb={tmdb}
          onClose={closeExpand}
        >
          <Suspense fallback={<ViewSkeletonFallback />}>
            <DetailView
              id={expandingItem.item.id}
              type={resolveMediaType(expandingItem.item)}
              view={
                expandingItem.item.media_type === 'person'
                  ? AppView.PERSON
                  : expandingItem.item.media_type === 'collection'
                  ? AppView.COLLECTION
                  : expandingItem.item.media_type === 'company'
                  ? AppView.COMPANY
                  : AppView.DETAILS
              }
              seedItem={expandingItem.item}
              userProviders={userProviders}
              autoplay={autoplay}
              autoPlayTrailer={
                expandingItem.autoPlayTrailer !== undefined
                  ? expandingItem.autoPlayTrailer && autoplay
                  : false
              }
              tmdb={tmdb}
              kinoCheckKey={kinoCheckKey}
              navigate={navigateToDetail}
              onBack={closeExpand}
              isInWatchlist={isInWatchlist(
                expandingItem.item.id,
                resolveMediaType(expandingItem.item)
              )}
              onToggleWatchlist={(item) => toggleWatchlist(item, showNotification)}
              watchedEpisodes={watchedEpisodes[expandingItem.item.id] || []}
              onToggleEpisode={(epId) => toggleEpisodeWatched(expandingItem.item.id, epId)}
              isOverlay={true}
            />
          </Suspense>
        </Transitor>
      )}

      {/* Stacked Detail / Provider Overlays (180ms GPU Slide-Over) */}
      {activeOverlay && tmdb && (
        <div
          data-scroll-container="overlay"
          className="fixed inset-0 z-50 bg-black animate-ios-slide-in overflow-y-auto overflow-x-hidden no-scrollbar ios-touch-rail"
        >
          <Suspense fallback={<ViewSkeletonFallback />}>
            {activeOverlay.view === AppView.PROVIDER ? (
              <ProviderView
                providerId={activeOverlay.params?.id || 8}
                providerName={activeOverlay.params?.name || 'Streaming'}
                logo={activeOverlay.params?.logo || ''}
                tmdb={tmdb}
                navigate={navigateToDetail}
                onBack={goBack}
              />
            ) : (
              <DetailView
                id={activeOverlay.params?.id || 0}
                type={(activeOverlay.params?.type as any) || 'movie'}
                view={activeOverlay.view}
                seedItem={activeOverlay.params?.seedItem}
                userProviders={userProviders}
                autoplay={autoplay}
                autoPlayTrailer={
                  activeOverlay.params?.autoPlayTrailer ? autoplay : false
                }
                tmdb={tmdb}
                kinoCheckKey={kinoCheckKey}
                onBack={goBack}
                navigate={navigateToDetail}
                isInWatchlist={isInWatchlist(
                  activeOverlay.params?.id || 0,
                  activeOverlay.params?.type || 'movie'
                )}
                onToggleWatchlist={(item) => toggleWatchlist(item, showNotification)}
                watchedEpisodes={watchedEpisodes[activeOverlay.params?.id || 0] || []}
                onToggleEpisode={(epId) =>
                  toggleEpisodeWatched(activeOverlay.params?.id || 0, epId)
                }
              />
            )}
          </Suspense>
        </div>
      )}

      {/* 3. Onboarding Flow */}
      {shouldShowOnboarding && tmdb && (
        <Suspense fallback={<ViewSkeletonFallback />}>
          <OnboardingView
            tmdb={tmdb}
            onComplete={() => setOnboardingComplete(true)}
            setLanguage={setLanguage}
            setRegion={setRegion}
            setTheme={setTheme}
            setUserGenres={setUserGenres}
            setUserProviders={setUserProviders}
            setIncludeAdult={setIncludeAdult}
            setAutoplay={setAutoplay}
            setDataSaver={setDataSaver}
            currentUser={currentUser}
            openAuthModal={openAuthModal}
          />
        </Suspense>
      )}

      {/* iOS Long-Press Quick Peek Context Sheet */}
      {tmdb && (
        <QuickPeekSheet
          tmdb={tmdb}
          navigate={navigateToDetail}
          isInWatchlist={isInWatchlist}
          onToggleWatchlist={(item) => toggleWatchlist(item, showNotification)}
          watchedCompositeKeys={watchedCompositeKeys}
          onToggleWatched={(item) => {
            const mediaKind = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
            if (mediaKind === 'tv') {
              toggleShowFullyWatched(item.id);
            } else {
              toggleMovieWatched(item.id);
            }
          }}
        />
      )}

      {/* Second-Screen QR-Code Approval Modal when ?tvPair=XXXXXX is opened on Smartphone */}
      {pendingTvPairCode && currentUser && !requiresTwoFactorChallenge && (
        <div
          data-tv-scope="modal"
          className="fixed inset-0 z-[190] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"
        >
          <div className="w-full max-w-md rounded-3xl bg-zinc-950 border border-white/15 p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                  <Tv size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {language.startsWith('de')
                      ? 'Smart TV jetzt verbinden?'
                      : 'Connect Smart TV now?'}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {language.startsWith('de')
                      ? `Als ${currentUser.displayName || currentUser.email} auf dem Fernseher anmelden`
                      : `Sign in as ${currentUser.displayName || currentUser.email} on the TV`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingTvPairCode(null);
                  clearTvPairUrlParam();
                }}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-2xl bg-black border border-white/10 py-3.5 px-4 text-center">
              <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">
                {language.startsWith('de') ? 'TV-Kopplungscode' : 'TV Pairing Code'}
              </div>
              <div className="text-2xl font-black font-mono tracking-[0.28em] text-white">
                {pendingTvPairCode.slice(0, 3)} {pendingTvPairCode.slice(3, 6)}
              </div>
            </div>

            {tvPairError && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 text-xs text-red-300 font-medium">
                {tvPairError}
              </div>
            )}

            {tvPairSuccess ? (
              <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-4 py-3 text-xs text-emerald-300 font-semibold flex items-center justify-center gap-2">
                <Check size={16} />
                {language.startsWith('de')
                  ? 'Fernseher erfolgreich gekoppelt!'
                  : 'TV successfully paired!'}
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setPendingTvPairCode(null);
                    clearTvPairUrlParam();
                  }}
                  className="flex-1 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-zinc-300 transition-colors"
                >
                  {language.startsWith('de') ? 'Abbrechen' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={tvPairBusy}
                  onClick={handleConfirmScannedTvPair}
                  className="flex-1 py-3 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {tvPairBusy
                    ? language.startsWith('de')
                      ? 'Koppelt...'
                      : 'Pairing...'
                    : language.startsWith('de')
                    ? 'TV freigeben'
                    : 'Approve TV'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Smart TV Top Burger Menu & Pointer Scroll Controls (ONLY on TVs) */}
      {isTvMode && !showIntro && !shouldShowAuthStage && !shouldShowOnboarding && (
        <TvTopBurgerNav
          currentView={activeTab}
          navigate={switchTab}
          language={language}
          hasActiveOverlay={Boolean(activeOverlay || expandingItem)}
          onGoBackOverlay={() => {
            if (expandingItem) {
              closeExpand();
            } else if (activeOverlay) {
              goBack();
            }
          }}
        />
      )}

      {/* Bottom Navigation Bar (ONLY on Touch Devices & PCs — hidden on Smart TVs) */}
      {!isTvMode &&
        !activeOverlay &&
        !expandingItem &&
        !showIntro &&
        !shouldShowAuthStage &&
        !shouldShowOnboarding && (
          <BottomNav currentView={activeTab} navigate={switchTab} />
        )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ConfigProvider>
      <LibraryProvider>
        <NavigationProvider>
          <AmbientProvider>
            <AppShell />
          </AmbientProvider>
        </NavigationProvider>
      </LibraryProvider>
    </ConfigProvider>
  );
};

export default App;
