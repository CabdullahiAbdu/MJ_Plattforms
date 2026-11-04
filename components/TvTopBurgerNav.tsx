import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Home,
  Search,
  Calendar,
  Check,
  Settings,
  Sparkles,
  Tv,
  X,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Copy,
  Download,
} from './Icons';
import { AppView } from '../types';
import { resolveApiBaseUrl } from '../services/tmdb';

interface TvTopBurgerNavProps {
  currentView: AppView;
  navigate: (view: AppView) => void;
  language: string;
  hasActiveOverlay: boolean;
  onGoBackOverlay: () => void;
}

interface TvMenuItem {
  view: AppView;
  labelDe: string;
  labelEn: string;
  subDe: string;
  subEn: string;
  icon: React.ReactNode;
  shortcutHintDe?: string;
  shortcutHintEn?: string;
}

interface VidaaSetupInfo {
  storeUnlockCode: string;
  appName: string;
  tvLaunchUrl: string;
  manifestUrl: string;
  qrCodeSvg: string;
}

/**
 * Attempts to register MovieJournal directly on a Hisense VIDAA TV launcher
 * using the built-in Hisense Browser JavaScript bridges (`Hisense_installApp` and `HiUtils_createRequest`).
 */
export function tryDirectHisenseVidaaInstall(
  appUrl: string,
  iconUrl: string
): { ok: boolean; method?: string; messageDe: string; messageEn: string } {
  if (typeof window === 'undefined') {
    return {
      ok: false,
      messageDe: 'Nur direkt im Hisense TV-Browser verfügbar.',
      messageEn: 'Only available directly inside the Hisense TV browser.',
    };
  }

  const win = window as any;

  // 1. Try modern VIDAA HiUtils_createRequest('fileWrite', 'websdk/Appinfo.json') bridge
  if (typeof win.HiUtils_createRequest === 'function') {
    try {
      const current = win.HiUtils_createRequest('fileRead', {
        path: 'websdk/Appinfo.json',
        mode: 6,
      });
      const parsed =
        current && current.ret && typeof current.msg === 'string'
          ? JSON.parse(current.msg)
          : { AppInfo: [] };
      const list = Array.isArray(parsed.AppInfo) ? parsed.AppInfo : [];

      const customApp = {
        Id: 'com.moviejournal.tv',
        AppName: 'MovieJournal',
        Title: 'MovieJournal',
        URL: appUrl,
        StartCommand: appUrl,
        IconURL: iconUrl,
        SmallIcon: iconUrl,
        BigIcon: iconUrl,
        Icon_96: iconUrl,
        Type: 'Browser',
        StoreType: 'custom',
        PreInstall: false,
      };

      const existingIdx = list.findIndex((a: any) => a?.Id === customApp.Id);
      if (existingIdx >= 0) {
        list[existingIdx] = customApp;
      } else {
        list.push(customApp);
      }

      const writeRes = win.HiUtils_createRequest('fileWrite', {
        path: 'websdk/Appinfo.json',
        mode: 6,
        writedata: JSON.stringify({ ...parsed, AppInfo: list }),
      });

      if (writeRes && writeRes.ret) {
        return {
          ok: true,
          method: 'HiUtils_createRequest',
          messageDe:
            'MovieJournal wurde direkt in die Hisense VIDAA App-Liste eingetragen! Starte den TV neu oder öffne „Meine Apps“.',
          messageEn:
            'MovieJournal was registered directly in your Hisense VIDAA app list! Restart your TV or check "My Apps".',
        };
      }
    } catch {
      // Fall through to legacy bridge
    }
  }

  // 2. Try legacy Hisense_installApp() JS bridge
  if (typeof win.Hisense_installApp === 'function') {
    try {
      win.Hisense_installApp(
        'com.moviejournal.tv',
        'MovieJournal',
        iconUrl,
        iconUrl,
        iconUrl,
        appUrl,
        'store',
        () => {}
      );
      return {
        ok: true,
        method: 'Hisense_installApp',
        messageDe:
          'Installations-Befehl an Hisense VIDAA OS gesendet! Prüfe deinen TV-Startbildschirm unter „Meine Apps“.',
        messageEn:
          'Install command sent to Hisense VIDAA OS! Check your TV home screen under "My Apps".',
      };
    } catch {
      // Fall through
    }
  }

  return {
    ok: false,
    messageDe:
      'Auf diesem Gerät ist die direkte Browser-Brücke gesperrt. Nutze das VIDAA DevKit (Code 2775379 im App Store) oder lege die App auf den Startbildschirm.',
    messageEn:
      'Direct browser bridge is locked on this device. Use the VIDAA DevKit (Code 2775379 in App Store) or pin to Home Screen.',
  };
}

const TV_MENU_ITEMS: TvMenuItem[] = [
  {
    view: AppView.HOME,
    labelDe: 'Startseite',
    labelEn: 'Home',
    subDe: 'Trends, Kino & Empfehlungen',
    subEn: 'Trending, Cinema & Picks',
    icon: <Home size={18} />,
  },
  {
    view: AppView.SEARCH,
    labelDe: 'Suche & Entdecken',
    labelEn: 'Search & Discover',
    subDe: 'Filme, Serien, Schauspieler & Genres',
    subEn: 'Movies, Series, Cast & Genres',
    icon: <Search size={18} />,
    shortcutHintDe: 'Grün',
    shortcutHintEn: 'Green',
  },
  {
    view: AppView.WATCHLIST,
    labelDe: 'Watchlist & Mediathek',
    labelEn: 'Watchlist & Library',
    subDe: 'Merkliste & Gesehen-Fortschritt',
    subEn: 'Saved Titles & Watch Progress',
    icon: <Check size={18} />,
    shortcutHintDe: 'Gelb',
    shortcutHintEn: 'Yellow',
  },
  {
    view: AppView.CALENDAR,
    labelDe: 'Release-Kalender',
    labelEn: 'Release Calendar',
    subDe: 'Kommende Starts & Episoden',
    subEn: 'Upcoming Releases & Episodes',
    icon: <Calendar size={18} />,
  },
  {
    view: AppView.SETTINGS,
    labelDe: 'Einstellungen',
    labelEn: 'Settings',
    subDe: 'Konto, Cloud-Sync & TV-Modus',
    subEn: 'Account, Cloud Sync & TV Mode',
    icon: <Settings size={18} />,
  },
];

export const TvTopBurgerNav: React.FC<TvTopBurgerNavProps> = ({
  currentView,
  navigate,
  language,
  hasActiveOverlay,
  onGoBackOverlay,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showVidaaGuideModal, setShowVidaaGuideModal] = useState(false);
  const [vidaaInfo, setVidaaInfo] = useState<VidaaSetupInfo | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [directInstallStatus, setDirectInstallStatus] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Default off in native DevKit app so screen stays clean; can be toggled on if using pointer browser
  const [showPointerHelper, setShowPointerHelper] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mj_tv_pointer_helper') === '1';
    } catch {
      return false;
    }
  });

  const burgerBtnRef = useRef<HTMLButtonElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const scrollHoldTimerRef = useRef<number | null>(null);
  const isDe = language.startsWith('de');

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Listen for remote control shortcuts (Pfeil Hoch at top edge, Red Color Key 403, or Menu button)
  useEffect(() => {
    const onToggleMenu = () => {
      setIsOpen((prev) => !prev);
    };
    const onOpenMenu = () => {
      setIsOpen(true);
    };
    const onOpenVidaaGuide = () => {
      setIsOpen(false);
      setShowVidaaGuideModal(true);
    };

    window.addEventListener('mj:toggle-tv-menu', onToggleMenu);
    window.addEventListener('mj:open-tv-menu', onOpenMenu);
    window.addEventListener('mj:open-vidaa-guide', onOpenVidaaGuide);
    return () => {
      window.removeEventListener('mj:toggle-tv-menu', onToggleMenu);
      window.removeEventListener('mj:open-tv-menu', onOpenMenu);
      window.removeEventListener('mj:open-vidaa-guide', onOpenVidaaGuide);
    };
  }, []);

  // Auto-focus currently active view item (or first item) in burger drawer when opened via TV remote
  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        firstMenuItemRef.current?.focus({ preventScroll: true });
      }, 40);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);

  // Fetch Hisense VIDAA setup URLs & QR code when guide modal opens
  useEffect(() => {
    if (!showVidaaGuideModal || vidaaInfo) return;
    const origin =
      typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '';
    const fallback: VidaaSetupInfo = {
      storeUnlockCode: '2775379',
      appName: 'MovieJournal',
      tvLaunchUrl: `${origin}/tv`,
      manifestUrl: `${origin}/vidaa/appinfo.json`,
      qrCodeSvg: '',
    };
    fetch(resolveApiBaseUrl('/api/vidaa/setup-info'))
      .then((r) => (r.ok ? r.json() : fallback))
      .then((data) => setVidaaInfo(data || fallback))
      .catch(() => setVidaaInfo(fallback));
  }, [showVidaaGuideModal, vidaaInfo]);

  // Close burger drawer or VIDAA guide modal on TV Back button (461 / Escape)
  useEffect(() => {
    if (!isOpen && !showVidaaGuideModal) return;
    const onTvBack = (e: Event) => {
      e.preventDefault();
      if (showVidaaGuideModal) {
        setShowVidaaGuideModal(false);
        return;
      }
      if (isOpen) {
        setIsOpen(false);
        window.setTimeout(() => {
          burgerBtnRef.current?.focus({ preventScroll: true });
        }, 30);
      }
    };
    window.addEventListener('mj:tv-back', onTvBack);
    return () => window.removeEventListener('mj:tv-back', onTvBack);
  }, [isOpen, showVidaaGuideModal]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const docEl = document.documentElement as any;
      const docAny = document as any;
      if (!document.fullscreenElement && !docAny.webkitFullscreenElement) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (docAny.webkitExitFullscreen) {
          docAny.webkitExitFullscreen();
        }
      }
    } catch {
      // Ignore if browser blocks fullscreen
    }
  }, []);

  const togglePointerHelper = useCallback(() => {
    setShowPointerHelper((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mj_tv_pointer_helper', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedField(key);
    window.setTimeout(() => setCopiedField(null), 1800);
  };

  const scrollActiveContainer = useCallback((deltaY: number) => {
    const overlayEl = document.querySelector<HTMLElement>('[data-scroll-container="overlay"]');
    if (overlayEl) {
      overlayEl.scrollBy({ top: deltaY, behavior: 'smooth' });
      return;
    }
    const transitorEl = document.querySelector<HTMLElement>('[data-scroll-container="transitor"]');
    if (transitorEl) {
      transitorEl.scrollBy({ top: deltaY, behavior: 'smooth' });
      return;
    }
    const mainEl = document.querySelector<HTMLElement>('main');
    if (mainEl) {
      mainEl.scrollBy({ top: deltaY, behavior: 'smooth' });
      return;
    }
    window.scrollBy({ top: deltaY, behavior: 'smooth' });
  }, []);

  const startContinuousScroll = useCallback(
    (deltaY: number) => {
      scrollActiveContainer(deltaY);
      if (scrollHoldTimerRef.current) {
        window.clearInterval(scrollHoldTimerRef.current);
      }
      scrollHoldTimerRef.current = window.setInterval(() => {
        scrollActiveContainer(deltaY);
      }, 240);
    },
    [scrollActiveContainer]
  );

  const stopContinuousScroll = useCallback(() => {
    if (scrollHoldTimerRef.current) {
      window.clearInterval(scrollHoldTimerRef.current);
      scrollHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopContinuousScroll();
  }, [stopContinuousScroll]);

  const activeItem =
    TV_MENU_ITEMS.find((item) => item.view === currentView) || TV_MENU_ITEMS[0];

  const handleSelectView = (view: AppView) => {
    setIsOpen(false);
    if (hasActiveOverlay) {
      onGoBackOverlay();
    }
    navigate(view);
  };

  const handleTriggerSmartShuffle = () => {
    setIsOpen(false);
    if (hasActiveOverlay) {
      onGoBackOverlay();
    }
    navigate(AppView.HOME);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('mj:open-smart-shuffle'));
    }, 80);
  };

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '';
  const tvAppDirectUrl = vidaaInfo?.tvLaunchUrl || `${originUrl}/tv`;
  const tvIconUrl = `${originUrl}/vidaa/icon.svg`;

  const handleRunDirectHisenseInstall = () => {
    const res = tryDirectHisenseVidaaInstall(tvAppDirectUrl, tvIconUrl);
    setDirectInstallStatus({
      ok: res.ok,
      text: isDe ? res.messageDe : res.messageEn,
    });
  };

  return (
    <>
      {/* Minimal Frosted-Glass Top-Left Burger Trigger (matches SettingsView look) */}
      <div className="fixed top-4 left-5 z-[95] flex items-center gap-2.5 select-none">
        <button
          ref={burgerBtnRef}
          id="mj-tv-burger-trigger"
          data-tv-burger-trigger="true"
          type="button"
          tabIndex={0}
          aria-label={isDe ? 'Menü öffnen' : 'Open Menu'}
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#1C1C1E]/88 hover:bg-[#2C2C2E]/90 text-white backdrop-blur-2xl border border-white/[0.1] shadow-[0_8px_28px_rgba(0,0,0,0.65)] transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
        >
          <div className="w-4 h-3.5 flex flex-col justify-between items-center py-0.5 shrink-0">
            <span className="w-4 h-[1.5px] bg-white rounded-full" />
            <span className="w-4 h-[1.5px] bg-white/80 rounded-full" />
            <span className="w-4 h-[1.5px] bg-white rounded-full" />
          </div>
          <span className="text-xs font-semibold tracking-tight text-white">
            {isDe ? activeItem.labelDe : activeItem.labelEn}
          </span>
        </button>

        {hasActiveOverlay && (
          <button
            type="button"
            tabIndex={0}
            onClick={onGoBackOverlay}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-[#1C1C1E]/88 hover:bg-[#2C2C2E]/90 text-white backdrop-blur-2xl border border-white/[0.1] shadow-[0_8px_28px_rgba(0,0,0,0.65)] transition-all cursor-pointer active:scale-95 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <ChevronLeft size={16} />
            <span>{isDe ? 'Zurück' : 'Back'}</span>
          </button>
        )}
      </div>

      {/* Optional Right-Edge Pointer Scroll Dock (only shown when explicitly enabled for TV browser pointer) */}
      {showPointerHelper && (
        <div
          data-tv-ignore="true"
          className="fixed right-4 top-1/2 -translate-y-1/2 z-[90] flex flex-col items-center gap-2 p-2 rounded-2xl bg-[#1C1C1E]/88 backdrop-blur-2xl border border-white/[0.1] shadow-[0_12px_36px_rgba(0,0,0,0.75)] select-none"
        >
          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            title={isDe ? 'Menü öffnen' : 'Open Menu'}
            onClick={() => setIsOpen((prev) => !prev)}
            className="w-11 h-11 rounded-xl bg-white/[0.07] hover:bg-white hover:text-black text-white flex flex-col items-center justify-center transition-colors cursor-pointer active:scale-95"
          >
            <Tv size={16} />
            <span className="text-[8px] font-semibold text-zinc-400 mt-0.5">
              {isDe ? 'Menü' : 'Menu'}
            </span>
          </button>

          <div className="w-6 h-px bg-white/[0.08]" />

          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            title={isDe ? 'Nach oben scrollen' : 'Scroll Up'}
            onMouseDown={() => startContinuousScroll(-480)}
            onMouseUp={stopContinuousScroll}
            onMouseLeave={stopContinuousScroll}
            onClick={() => scrollActiveContainer(-480)}
            className="w-11 h-11 rounded-xl bg-white/[0.07] hover:bg-white hover:text-black text-white flex flex-col items-center justify-center transition-colors cursor-pointer active:scale-95"
          >
            <ChevronUp size={20} />
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            title={isDe ? 'Nach unten scrollen' : 'Scroll Down'}
            onMouseDown={() => startContinuousScroll(480)}
            onMouseUp={stopContinuousScroll}
            onMouseLeave={stopContinuousScroll}
            onClick={() => scrollActiveContainer(480)}
            className="w-11 h-11 rounded-xl bg-white/[0.07] hover:bg-white hover:text-black text-white flex flex-col items-center justify-center transition-colors cursor-pointer active:scale-95"
          >
            <ChevronDown size={20} />
          </button>

          <div className="w-6 h-px bg-white/[0.08]" />

          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            title={isDe ? 'Vollbild' : 'Fullscreen'}
            onClick={toggleFullscreen}
            className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-colors cursor-pointer active:scale-95 ${
              isFullscreen
                ? 'bg-white text-black'
                : 'bg-white/[0.07] hover:bg-white hover:text-black text-white'
            }`}
          >
            <Monitor size={16} />
          </button>
        </div>
      )}

      {/* Clean Monochrome Frosted-Glass Burger Drawer (matches SettingsView.tsx style) */}
      {isOpen && (
        <div
          data-tv-scope="modal"
          className="fixed inset-0 z-[180] bg-black/65 backdrop-blur-xl flex animate-fade-in select-none"
          onClick={() => setIsOpen(false)}
        >
          <aside
            className="w-full max-w-[360px] h-full bg-[#1C1C1E]/88 backdrop-blur-2xl border-r border-white/[0.08] px-6 py-7 flex flex-col justify-between overflow-y-auto no-scrollbar shadow-[20px_0_60px_rgba(0,0,0,0.85)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6">
              {/* Drawer Header */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-white leading-tight">
                    {isDe ? 'Navigation' : 'Navigation'}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    MovieJournal
                  </p>
                </div>
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Section 1: Views (SettingsView list style) */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  {isDe ? 'Bereiche' : 'Sections'}
                </h3>
                <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                  {TV_MENU_ITEMS.map((item, idx) => {
                    const isActive = currentView === item.view && !hasActiveOverlay;
                    return (
                      <button
                        key={item.view}
                        ref={idx === 0 ? firstMenuItemRef : undefined}
                        type="button"
                        tabIndex={0}
                        onClick={() => handleSelectView(item.view)}
                        className="w-full py-3.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-3 hover:bg-white/[0.05] active:opacity-70 transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                              isActive
                                ? 'bg-white text-black'
                                : 'bg-white/[0.07] text-zinc-300'
                            }`}
                          >
                            {item.icon}
                          </div>
                          <div className="min-w-0">
                            <div
                              className={`text-sm truncate ${
                                isActive ? 'font-bold text-white' : 'font-medium text-zinc-200'
                              }`}
                            >
                              {isDe ? item.labelDe : item.labelEn}
                            </div>
                            <div className="text-xs text-zinc-500 truncate mt-0.5">
                              {isDe ? item.subDe : item.subEn}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {(item.shortcutHintDe || item.shortcutHintEn) && (
                            <span className="text-[11px] text-zinc-500 font-medium">
                              {isDe ? item.shortcutHintDe : item.shortcutHintEn}
                            </span>
                          )}
                          {isActive ? (
                            <span className="w-2 h-2 rounded-full bg-white" />
                          ) : (
                            <ChevronRight size={15} className="text-zinc-600" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Quick Tools (SettingsView list style, zero garish colors) */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  {isDe ? 'Funktionen & Anzeige' : 'Tools & Display'}
                </h3>
                <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                  <button
                    type="button"
                    tabIndex={0}
                    onClick={handleTriggerSmartShuffle}
                    className="w-full py-3.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-3 hover:bg-white/[0.05] active:opacity-70 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/[0.07] text-zinc-300 flex items-center justify-center shrink-0">
                        <Sparkles size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate">
                          Smart Shuffle
                        </div>
                        <div className="text-xs text-zinc-500 truncate mt-0.5">
                          {isDe ? 'Film für heute Abend auslosen' : 'Pick a movie for tonight'}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] text-zinc-500 font-medium shrink-0">
                      {isDe ? 'Blau' : 'Blue'}
                    </span>
                  </button>

                  <button
                    type="button"
                    tabIndex={0}
                    onClick={togglePointerHelper}
                    className="w-full py-3.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-3 hover:bg-white/[0.05] active:opacity-70 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/[0.07] text-zinc-300 flex items-center justify-center shrink-0">
                        <ChevronDown size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate">
                          {isDe ? 'Browser Zeiger-Dock' : 'Browser Pointer Dock'}
                        </div>
                        <div className="text-xs text-zinc-500 truncate mt-0.5">
                          {isDe ? 'Scroll-Hilfe am rechten Rand' : 'Right-edge scroll helper'}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-400 font-medium shrink-0">
                      {showPointerHelper ? (isDe ? 'An' : 'On') : isDe ? 'Aus' : 'Off'}
                    </span>
                  </button>

                  <button
                    type="button"
                    tabIndex={0}
                    onClick={toggleFullscreen}
                    className="w-full py-3.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-3 hover:bg-white/[0.05] active:opacity-70 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/[0.07] text-zinc-300 flex items-center justify-center shrink-0">
                        <Monitor size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate">
                          {isDe ? 'Vollbildmodus' : 'Fullscreen Mode'}
                        </div>
                        <div className="text-xs text-zinc-500 truncate mt-0.5">
                          {isDe ? 'Browser-Leiste ausblenden' : 'Hide browser bar'}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-400 font-medium shrink-0">
                      {isFullscreen ? (isDe ? 'Aktiv' : 'On') : isDe ? 'Aus' : 'Off'}
                    </span>
                  </button>

                  <button
                    type="button"
                    tabIndex={0}
                    onClick={() => {
                      setIsOpen(false);
                      setDirectInstallStatus(null);
                      setShowVidaaGuideModal(true);
                    }}
                    className="w-full py-3.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-3 hover:bg-white/[0.05] active:opacity-70 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/[0.07] text-zinc-300 flex items-center justify-center shrink-0">
                        <Tv size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate">
                          {isDe ? 'VIDAA TV-Einrichtung' : 'VIDAA TV Setup'}
                        </div>
                        <div className="text-xs text-zinc-500 truncate mt-0.5">
                          {isDe ? 'DevKit & Startbildschirm' : 'DevKit & Home Screen'}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={15} className="text-zinc-600 shrink-0" />
                  </button>
                </div>
              </div>
            </div>

            {/* Subtle Footer Hint */}
            <div className="pt-4 border-t border-white/[0.08] text-[11px] text-zinc-500 leading-relaxed">
              {isDe
                ? 'Tipp: Mit den Pfeiltasten ▲ / ▼ springst du wie bei Netflix direkt von Reihe zu Reihe. Ganz oben öffnet ▲ dieses Menü.'
                : 'Tip: Use ▲ / ▼ to jump cleanly row by row. Pressing ▲ at the top opens this menu.'}
            </div>
          </aside>
        </div>
      )}

      {/* Clean Frosted-Glass VIDAA Setup Modal */}
      {showVidaaGuideModal && (
        <div
          data-tv-scope="modal"
          className="fixed inset-0 z-[195] bg-black/75 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in select-none"
          onClick={() => setShowVidaaGuideModal(false)}
        >
          <div
            className="w-full max-w-xl max-h-[88dvh] overflow-y-auto no-scrollbar rounded-3xl bg-[#1C1C1E]/95 backdrop-blur-2xl border border-white/[0.1] p-6 shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  {isDe
                    ? 'Hisense VIDAA TV-Einrichtung'
                    : 'Hisense VIDAA TV Setup'}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {isDe
                    ? 'DevKit App-Registrierung & direkte TV-URL'
                    : 'DevKit App Registration & Direct TV URL'}
                </p>
              </div>
              <button
                type="button"
                tabIndex={0}
                onClick={() => setShowVidaaGuideModal(false)}
                className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-zinc-300 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
              <div className="py-4 space-y-2.5">
                <div className="text-xs font-semibold text-white">
                  {isDe ? 'Direkte TV-Startadresse (/tv)' : 'Direct TV Launch URL (/tv)'}
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/[0.08] flex items-center justify-between gap-3">
                  <code className="text-xs font-mono text-zinc-200 truncate select-all">
                    {tvAppDirectUrl}
                  </code>
                  <button
                    type="button"
                    tabIndex={0}
                    onClick={() => handleCopyText(tvAppDirectUrl, 'tvUrl')}
                    className="px-3 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Copy size={12} />
                    <span>
                      {copiedField === 'tvUrl'
                        ? isDe
                          ? 'Kopiert'
                          : 'Copied'
                        : isDe
                        ? 'Kopieren'
                        : 'Copy'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="py-4 space-y-2.5">
                <div className="text-xs font-semibold text-white">
                  {isDe
                    ? 'Direkte Browser-Brücke (falls im VIDAA-Browser geöffnet)'
                    : 'Direct Browser Bridge (if opened inside VIDAA Browser)'}
                </div>
                <button
                  type="button"
                  tabIndex={0}
                  onClick={handleRunDirectHisenseInstall}
                  className="w-full py-2.5 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download size={14} />
                  <span>
                    {isDe
                      ? 'An TV-Startbildschirm senden'
                      : 'Send to TV Home Screen'}
                  </span>
                </button>
                {directInstallStatus && (
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {directInstallStatus.text}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                tabIndex={0}
                onClick={() => setShowVidaaGuideModal(false)}
                className="px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                {isDe ? 'Schließen' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
