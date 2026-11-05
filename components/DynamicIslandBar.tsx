import React from 'react';
import { Check, Info, WifiOff } from './Icons';
import { TmdbService } from '../services/tmdb';

interface DynamicIslandBarProps {
  tmdb: TmdbService | null;
  notification: { message: string; type: 'success' | 'info' } | null;
  isOnline: boolean;
  language: string;
}

/**
 * Minimal Toast Banner (No permanent top notch, halo, or tap-zone).
 * Renders nothing when idle (`return null`), and displays a clean floating toast only when
 * an action notification or offline status is active.
 */
export const DynamicIslandBar: React.FC<DynamicIslandBarProps> = ({
  notification,
  isOnline,
  language,
}) => {
  const isDe = language.toLowerCase().startsWith('de');
  const hasActivePill = Boolean(notification) || !isOnline;

  if (!hasActivePill) {
    return null;
  }

  return (
    <div
      style={{
        top: 'max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))',
      }}
      className="fixed left-1/2 -translate-x-1/2 z-[275] max-w-[92vw] pointer-events-none animate-fade-in"
    >
      {notification ? (
        <div
          className={`px-4 py-2 rounded-full bg-zinc-950/95 backdrop-blur-xl border shadow-2xl flex items-center gap-2.5 ${
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
            {notification.type === 'success' ? (
              <Check size={13} strokeWidth={3} />
            ) : (
              <Info size={13} />
            )}
          </div>
          <span className="font-bold text-[clamp(0.75rem,2vw,0.85rem)] tracking-tight truncate">
            {notification.message}
          </span>
        </div>
      ) : !isOnline ? (
        <div className="px-4 py-2 rounded-full bg-zinc-950/95 border border-amber-500/45 text-amber-200 backdrop-blur-xl shadow-2xl flex items-center gap-2 text-xs font-bold">
          <WifiOff size={14} className="text-amber-400 shrink-0" />
          <span className="truncate">
            {isDe
              ? 'Offline-Modus – Gespeicherte Mediathek aktiv'
              : 'Offline mode – Using saved library'}
          </span>
        </div>
      ) : null}
    </div>
  );
};
