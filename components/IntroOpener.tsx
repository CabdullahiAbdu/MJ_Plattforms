import React, { useEffect, useState } from 'react';
import { TmdbService } from '../services/tmdb';
import { BrandLogo, LogoMorphPhase } from './BrandLogo';
import { CinemaProjectorStage } from './CinemaProjectorStage';

interface IntroOpenerProps {
  tmdb: TmdbService;
  region: string;
  onComplete: () => void;
}

/**
 * Fluid Camera-to-'M' Transition -> Real-Time Pacifico Handwriting ('ovieJournal')
 */
export const IntroOpener: React.FC<IntroOpenerProps> = ({ tmdb, onComplete }) => {
  const [logoPhase, setLogoPhase] = useState<LogoMorphPhase>('camera-spin');
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const tMorphToM = setTimeout(() => setLogoPhase('morph-to-m'), 600);
    const tStartWriting = setTimeout(() => setLogoPhase('writing'), 1120);
    const tComplete = setTimeout(() => setLogoPhase('complete'), 2480);
    const tExit = setTimeout(() => setIsExiting(true), 2900);
    const tDone = setTimeout(() => onComplete(), 3350);

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.keyCode || e.which;
      if (
        e.key === 'Enter' ||
        e.key === ' ' ||
        e.key === 'Escape' ||
        code === 13 ||
        code === 461 ||
        code === 10009
      ) {
        e.preventDefault();
        onComplete();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(tMorphToM);
      clearTimeout(tStartWriting);
      clearTimeout(tComplete);
      clearTimeout(tExit);
      clearTimeout(tDone);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[250] bg-zinc-950 overflow-hidden flex items-center justify-center px-[var(--fluid-page-px)] select-none transition-opacity duration-400 ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Ambient Movie Backdrop */}
      <CinemaProjectorStage tmdb={tmdb} />

      {/* Skip Button */}
      <button
        type="button"
        tabIndex={0}
        onClick={onComplete}
        style={{
          top: 'max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))',
          right: 'var(--fluid-page-px)',
        }}
        className="focusable-rounded fixed z-30 px-3.5 py-1.5 rounded-full text-[clamp(0.625rem,1.8vw,0.72rem)] font-bold uppercase tracking-[0.18em] text-white/60 hover:text-white bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 backdrop-blur-md transition-all"
      >
        Skip
      </button>

      {/* Center Monochrome Camera -> 'M' -> Real-Time Pacifico 'ovieJournal' Choreography */}
      <div
        className={`relative z-20 flex flex-col items-center justify-center transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isExiting ? 'scale-[1.02] opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        <BrandLogo size="lg" phase={logoPhase} />
      </div>
    </div>
  );
};
