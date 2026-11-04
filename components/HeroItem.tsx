import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Info, Star } from './Icons';
import { MediaItem, Rect } from '../types';
import { TmdbService } from '../services/tmdb';
import { useAmbientActions } from '../context/AmbientContext';
import { SafeImage } from './SafeImage';

interface HeroItemProps {
  items: MediaItem[];
  tmdb: TmdbService;
  onPlay: (i: MediaItem, rect: Rect) => void;
  onDetails: (i: MediaItem, rect: Rect) => void;
}

/**
 * HeroItem
 * --------
 * Fluid viewport-proportional hero stage (`clamp(370px, 58dvh, 720px)`)
 * with continuous clamp() typography and button sizing across all devices.
 */
export const HeroItem: React.FC<HeroItemProps> = ({ items, tmdb, onPlay, onDetails }) => {
  const [index, setIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { setHeroBackground } = useAmbientActions();

  const extendedItems = useMemo(() => {
    if (items.length < 2) return items;
    return [...items, items[0]];
  }, [items]);

  const realIndex = items.length > 0 ? index % items.length : 0;

  useEffect(() => {
    setIndex(0);
    setIsTransitioning(true);
  }, [items]);

  useEffect(() => {
    if (items.length <= 1) return;
    timeoutRef.current = setTimeout(() => {
      setIndex((prev) => prev + 1);
      setIsTransitioning(true);
    }, 8000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [index, items.length]);

  useEffect(() => {
    if (index === items.length && items.length > 1) {
      const resetTimer = setTimeout(() => {
        setIsTransitioning(false);
        setIndex(0);
      }, 750);
      return () => clearTimeout(resetTimer);
    }
  }, [index, items.length]);

  useEffect(() => {
    if (items.length > 0) {
      const activeItem = items[realIndex];
      if (activeItem?.backdrop_path) {
        setHeroBackground(activeItem.backdrop_path);
      }
    }
  }, [realIndex, items, setHeroBackground]);

  const handleAction = (cb: (i: MediaItem, r: Rect) => void, item: MediaItem) => {
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      cb(item, { top: r.top, left: r.left, width: r.width, height: r.height });
    }
  };

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        height: 'var(--fluid-hero-h)',
      }}
      className="relative w-full max-w-[2200px] mx-auto overflow-hidden rounded-b-[clamp(1.25rem,3vw,2.25rem)] rounded-t-none md:rounded-[clamp(1.25rem,3vw,2.25rem)] shadow-[0_16px_40px_-10px_rgba(0,0,0,0.75)] group bg-zinc-900 z-0 transform-gpu"
    >
      {/* Sliding Track */}
      <div
        className="flex h-full w-full will-change-transform"
        style={{
          transform: `translate3d(-${index * 100}%, 0, 0)`,
          transition: isTransitioning ? 'transform 650ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
        }}
      >
        {extendedItems.map((item, idx) => {
          const key = `${item.id}-${idx}`;
          const isActive = idx === index || (index === items.length && idx === 0);
          const isNear =
            Math.abs(idx - index) <= 1 ||
            (index === 0 && idx === extendedItems.length - 1) ||
            (index >= items.length - 1 && idx === 0);
          const bgImage = tmdb.getImageUrl(item.backdrop_path || item.poster_path, 'w1280');
          const year = String(item.release_date || item.first_air_date || '').substring(0, 4);
          const numVote = Number(item.vote_average || 0);
          const rating = Number.isFinite(numVote) && numVote > 0 ? numVote.toFixed(1) : null;

          return (
            <div key={key} className="relative min-w-full h-full flex-shrink-0">
              <div className="absolute inset-0">
                {isNear && (
                  <SafeImage
                    src={bgImage}
                    fallbackTitle={item.title || item.name}
                    className="w-full h-full object-cover object-center sm:object-top"
                    loading={idx === 0 ? 'eager' : 'lazy'}
                    draggable={false}
                  />
                )}
                {/* Top Dynamic Island & Status Bar Scrim */}
                <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-black/70 via-black/25 to-transparent pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent md:via-black/20" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/30 to-transparent md:via-transparent" />
              </div>

              {/* Fluid Content Overlay with Safe-Area Top Clearance */}
              <div
                style={{
                  paddingInline: 'clamp(1.15rem, 3.5vw, 3.25rem)',
                  paddingBottom: 'clamp(1.1rem, 3.2vw, 2.75rem)',
                  paddingTop: 'max(3rem, calc(env(safe-area-inset-top, 0px) + 1.25rem))',
                }}
                className={`absolute bottom-0 left-0 w-full z-20 flex flex-col justify-end h-full transition-opacity duration-300 ${
                  isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="max-w-2xl space-y-[clamp(0.4rem,1.2dvh,0.85rem)]">
                  {/* Editorial Metadata Line */}
                  <div className="flex flex-wrap items-center gap-2 text-[clamp(0.68rem,calc(0.62rem+0.2vw),0.82rem)] font-semibold text-zinc-300 tabular-nums">
                    <span className="text-zinc-100 font-bold">Premiere</span>
                    {year && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{year}</span>
                      </>
                    )}
                    {item.certification && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-zinc-200 font-bold">{item.certification}</span>
                      </>
                    )}
                    {rating && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-yellow-400">
                          <Star size={11} fill="currentColor" /> {rating}
                        </span>
                      </>
                    )}
                  </div>

                  {item.logo_path ? (
                    <div className="py-0.5">
                      <img
                        src={tmdb.getImageUrl(item.logo_path, 'w500')}
                        alt={item.title || item.name || 'Title'}
                        referrerPolicy="no-referrer"
                        draggable={false}
                        style={{
                          maxHeight: 'clamp(2.5rem, 8.5dvh, 4.75rem)',
                          maxWidth: 'min(72%, 340px)',
                        }}
                        className="w-auto object-contain object-left drop-shadow-[0_8px_20px_rgba(0,0,0,0.9)] select-none"
                      />
                      <span className="sr-only">{item.title || item.name}</span>
                    </div>
                  ) : (
                    <h1
                      style={{
                        fontSize: 'clamp(1.35rem, calc(1.05rem + 1.6vw), 2.65rem)',
                        textWrap: 'balance',
                      }}
                      className="font-black tracking-tight text-white drop-shadow-xl leading-[1.06] line-clamp-2"
                    >
                      {item.title || item.name}
                    </h1>
                  )}

                  <p
                    style={{
                      fontSize: 'clamp(0.75rem, calc(0.7rem + 0.2vw), 0.92rem)',
                    }}
                    className="text-zinc-200 line-clamp-2 font-normal leading-relaxed drop-shadow max-w-xl"
                  >
                    {item.overview}
                  </p>

                  <div
                    data-tv-row={isActive ? 'true' : undefined}
                    className="flex items-center gap-2.5 pt-1"
                  >
                    <button
                      type="button"
                      tabIndex={isActive ? 0 : -1}
                      data-tv-ignore={!isActive ? 'true' : undefined}
                      onClick={() => handleAction(onPlay, item)}
                      style={{
                        height: 'clamp(2.35rem, 5.2dvh, 2.9rem)',
                        paddingInline: 'clamp(1rem, 2.5vw, 1.5rem)',
                        fontSize: 'clamp(0.75rem, calc(0.7rem + 0.18vw), 0.88rem)',
                      }}
                      className="focusable-rounded bg-white text-black rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg hover:bg-zinc-200 active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Play size={15} fill="currentColor" />
                      <span>Play Trailer</span>
                    </button>
                    <button
                      type="button"
                      tabIndex={isActive ? 0 : -1}
                      data-tv-ignore={!isActive ? 'true' : undefined}
                      onClick={() => handleAction(onDetails, item)}
                      style={{
                        height: 'clamp(2.35rem, 5.2dvh, 2.9rem)',
                        paddingInline: 'clamp(1rem, 2.5vw, 1.5rem)',
                        fontSize: 'clamp(0.75rem, calc(0.7rem + 0.18vw), 0.88rem)',
                      }}
                      className="focusable-rounded bg-white/12 backdrop-blur-xl border border-white/15 text-white rounded-xl font-bold hover:bg-white/20 transition-all flex items-center gap-2 shadow-lg active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Info size={15} />
                      <span>Details</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Indicators (Pointer-only, ignored by TV D-Pad) */}
      <div
        style={{
          bottom: 'clamp(0.85rem, 2vw, 1.75rem)',
          right: 'clamp(1rem, 3vw, 2.25rem)',
        }}
        className="absolute z-30 flex gap-1.5"
      >
        {items.map((_, idx) => (
          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            key={idx}
            onClick={() => {
              setIsTransitioning(true);
              setIndex(idx);
            }}
            className={`h-1.5 rounded-full transition-all duration-300 shadow ${
              idx === realIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/60'
            }`}
            aria-label={`Go to slide ${idx + 1}`}
          />
        ))}
      </div>
    </div>
  );
};
