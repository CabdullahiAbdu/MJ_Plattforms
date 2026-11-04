import React, { useEffect, useState, useCallback } from 'react';
import { Check, Info, WifiOff, ChevronUp } from './Icons';
import { TmdbService } from '../services/tmdb';
import { useActiveAmbientImage } from '../context/AmbientContext';

interface DynamicIslandBarProps {
  tmdb: TmdbService | null;
  notification: { message: string; type: 'success' | 'info' } | null;
  isOnline: boolean;
  language: string;
}

/**
 * DynamicIslandBar
 * ----------------
 * Integrates the iPhone 17 Dynamic Island / Notch area with:
 * 1. Subtle Ambient Cinema Halo synchronized with the active movie backdrop (`useActiveAmbientImage`).
 * 2. Top Status-Bar Contrast Scrim so iOS time/Wi-Fi/battery icons stay crisp over edge-to-edge hero backdrops.
 * 3. Tap-to-Scroll-Top interactive sensor at the Notch zone with subtle tactile feedback.
 * 4. Dynamic Island Morphing Pill for app notifications and offline connectivity status.
 */
export const DynamicIslandBar: React.FC<DynamicIslandBarProps> = ({
  tmdb,
  notification,
  isOnline,
  language,
}) => {
  const ambientPath = useActiveAmbientImage();
  const [ambientUrl, setAmbientUrl] = useState<string | null>(null);
  const [scrollPulse, setScrollPulse] = useState(false);

  const isDe = language.toLowerCase().startsWith('de');

  useEffect(() => {
    if (ambientPath && tmdb) {
      const nextUrl = tmdb.getImageUrl(ambientPath, 'w300');
      if (nextUrl && nextUrl !== ambientUrl) {
        setAmbientUrl(nextUrl);
      }
    }
  }, [ambientPath, tmdb, ambientUrl]);

  const handleNotchTapScrollTop = useCallback(() => {
    // Find the top-most active scrollable container (Overlay -> Transitor -> HomeView -> Main)
    const overlayScroll = document.querySelector<HTMLElement>('[data-scroll-container="overlay"]');
    const transitorScroll = document.querySelector<HTMLElement>('[data-scroll-container="transitor"]');
    const homeScroll = document.querySelector<HTMLElement>('[data-scroll-container="home-view"]');
    const mainScroll = document.querySelector<HTMLElement>('main');

    const targets = [overlayScroll, transitorScroll, homeScroll, mainScroll].filter(
      (el): el is HTMLElement => Boolean(el && el.scrollTop > 0)
    );

    if (targets.length > 0) {
      targets.forEach((el) => {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } else if (mainScroll) {
      mainScroll.scrollTo({ top: 0, behavior: 'smooth' });
    }

    setScrollPulse(true);
    setTimeout(() => setScrollPulse(false), 520);
  }, []);

  const hasActivePill = Boolean(notification) || !isOnline;

  return (
    <>
      {/* 1. Top Status-Bar Contrast Scrim & Subtle Movie Ambient Halo around the Notch */}
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 z-[240] pointer-events-none overflow-hidden"
        style={{
          height: 'max(3.75rem, calc(env(safe-area-inset-top, 0px) + 1.75rem))',
        }}
      >
        {/* Top Contrast Scrim so iOS Status Bar (clock, Wi-Fi, battery) is always legible over Edge-to-Edge Hero */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />

        {/* Subtle Film-Synchronized Ambient Glow hugging the Dynamic Island / Notch */}
        {ambientUrl && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-[260px] h-[58px] rounded-full overflow-hidden opacity-60">
            <img
              src={ambientUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover transition-opacity duration-700"
              style={{
                filter: 'blur(22px) saturate(185%) brightness(0.95)',
                transform: 'translate3d(0, 0, 0) scale(1.25)',
              }}
            />
          </div>
        )}

        {/* Subtle Accent Rim Glow around the Dynamic Island when a notification or tap-to-top triggers */}
        <div
          className={`absolute top-1 left-1/2 -translate-x-1/2 rounded-full transition-all duration-300 ${
            scrollPulse || hasActivePill
              ? 'w-[168px] h-[34px] opacity-80 bg-accent/35 blur-xl'
              : 'w-[126px] h-[28px] opacity-25 bg-accent/20 blur-xl'
          }`}
        />
      </div>

      {/* 2. Interactive Notch Tap-to-Scroll-Top Zone */}
      <button
        type="button"
        onClick={handleNotchTapScrollTop}
        aria-label={isDe ? 'Nach oben scrollen' : 'Scroll to top'}
        title={isDe ? 'Nach oben scrollen' : 'Scroll to top'}
        style={{
          height: 'max(28px, env(safe-area-inset-top, 28px))',
        }}
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[210px] z-[265] bg-transparent cursor-pointer focus:outline-none group flex items-start justify-center pt-1"
      >
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/85 border border-white/15 text-[10px] font-bold text-white/90 shadow-lg transition-all duration-200 ${
            scrollPulse
              ? 'opacity-100 translate-y-1 scale-100'
              : 'opacity-0 -translate-y-2 scale-90 pointer-events-none'
          }`}
        >
          <ChevronUp size={11} className="text-accent" />
          <span>Top</span>
        </span>
      </button>

      {/* 3. Dynamic Island Morphing Notification & Connectivity Capsule */}
      {hasActivePill && (
        <div
          style={{
            top: 'max(0.55rem, calc(env(safe-area-inset-top, 0px) + 0.25rem))',
          }}
          className="fixed left-1/2 -translate-x-1/2 z-[275] max-w-[92vw] pointer-events-none animate-dynamic-island"
        >
          {notification ? (
            <div
              className={`px-4 py-2 rounded-full bg-black/95 backdrop-blur-2xl border shadow-[0_18px_42px_rgba(0,0,0,0.92),0_0_24px_rgba(var(--accent-color),0.25)] flex items-center gap-2.5 ${
                notification.type === 'success'
                  ? 'border-emerald-500/45 text-emerald-200'
                  : 'border-white/15 text-white'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                  notification.type === 'success'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-accent/25 text-accent'
                }`}
              >
                {notification.type === 'success' ? <Check size={13} strokeWidth={3} /> : <Info size={13} />}
              </div>
              <span className="font-bold text-[clamp(0.75rem,2vw,0.85rem)] tracking-tight truncate">
                {notification.message}
              </span>
            </div>
          ) : !isOnline ? (
            <div className="px-4 py-2 rounded-full bg-black/95 border border-amber-500/45 text-amber-200 backdrop-blur-2xl shadow-[0_18px_42px_rgba(0,0,0,0.92)] flex items-center gap-2 text-xs font-bold">
              <WifiOff size={14} className="text-amber-400 shrink-0" />
              <span className="truncate">
                {isDe
                  ? 'Offline-Modus – Gespeicherte Mediathek aktiv'
                  : 'Offline mode – Using saved library'}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
};
