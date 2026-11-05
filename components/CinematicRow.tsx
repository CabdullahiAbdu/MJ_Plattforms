import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ChevronRight, ChevronLeft, RefreshCw } from './Icons';
import { MediaItem, TmdbResponse, Rect } from '../types';
import { TmdbService } from '../services/tmdb';
import { MediaCard } from './MovieCard';
import { getOptimalCardPosterSize } from '../services/performanceMonitor';

interface CinematicRowProps {
  title: string;
  subtitle?: string;
  queryKey?: string;
  fetcher: (page: number) => Promise<TmdbResponse<MediaItem>>;
  tmdb: TmdbService;
  onClick: (item: MediaItem, rect?: Rect) => void;
  onExtend: () => void;
  variant?: 'poster' | 'backdrop' | 'ranked';
  priority?: 'eager' | 'lazy';
}

const CinematicRowComponent: React.FC<CinematicRowProps> = ({
  title,
  subtitle,
  queryKey,
  fetcher,
  tmdb,
  onClick,
  onExtend,
  variant = 'poster',
  priority = 'lazy',
}) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [shouldFetch, setShouldFetch] = useState<boolean>(
    priority === 'eager' || typeof IntersectionObserver === 'undefined'
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const effectiveKey = queryKey || `${title}:${tmdb.getLanguage()}:${tmdb.getRegion()}`;

  // Phase 2: Defer offscreen row network requests until near viewport (360px rootMargin)
  useEffect(() => {
    if (shouldFetch || typeof IntersectionObserver === 'undefined') {
      setShouldFetch(true);
      return;
    }
    const el = containerRef.current;
    if (!el) {
      setShouldFetch(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldFetch(true);
          observer.disconnect();
        }
      },
      { rootMargin: '360px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldFetch]);

  const loadRow = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetcherRef.current(1);
      setItems(data.results || []);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error(`Failed loading row "${title}":`, e);
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [title]);

  useEffect(() => {
    if (!shouldFetch) return;
    let mounted = true;
    setLoading(true);
    setError(false);

    fetcherRef
      .current(1)
      .then((data) => {
        if (mounted && data?.results) {
          setItems(data.results);
        }
      })
      .catch((e) => {
        if (mounted && e?.name !== 'AbortError') {
          setError(true);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [effectiveKey, shouldFetch]);

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { clientWidth } = rowRef.current;
      const scrollAmount = direction === 'left' ? -clientWidth / 1.5 : clientWidth / 1.5;
      rowRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const optimalPosterSize = getOptimalCardPosterSize(
    variant as 'poster' | 'backdrop' | 'ranked' | 'masonry' | 'landscape'
  );

  if ((!shouldFetch || loading) && items.length === 0) {
    return (
      <div ref={containerRef} className="py-2.5 md:py-4 px-[var(--fluid-page-px)]">
        <div className="h-5 w-40 cinema-shimmer rounded-lg mb-2.5" />
        <div className="flex gap-[clamp(0.65rem,1.8vw,1rem)] overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                width:
                  variant === 'backdrop'
                    ? 'var(--fluid-backdrop-w)'
                    : 'var(--fluid-card-w)',
              }}
              className={`flex-shrink-0 rounded-2xl cinema-shimmer ${
                variant === 'backdrop' ? 'aspect-video' : 'aspect-[2/3]'
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div ref={containerRef} className="py-2.5 md:py-4 px-[var(--fluid-page-px)]">
        <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-900/60">
          <div>
            <h3 className="text-[length:var(--fluid-h3)] font-bold text-white">{title}</h3>
            <p className="text-xs text-zinc-400">Could not load this strip right now.</p>
          </div>
          <button
            type="button"
            onClick={loadRow}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className="relative py-2 md:py-3.5 group/row">
      {/* Fluid Header */}
      <div className="relative z-10 px-[var(--fluid-page-px)] mb-2 md:mb-3 flex items-end justify-between">
        <button
          type="button"
          tabIndex={-1}
          data-tv-ignore="true"
          onClick={onExtend}
          className="text-left cursor-pointer group/title focus:outline-none"
        >
          <h3 className="text-[length:var(--fluid-h2)] font-bold text-white tracking-tight flex items-center gap-1.5">
            <span>{title}</span>
            <ChevronRight
              className="text-zinc-500 group-hover/title:text-white transition-colors"
              size={17}
              strokeWidth={2.5}
            />
          </h3>
        </button>

        {/* Desktop & Smart TV Pointer Nav Controls (Ignored by D-Pad Remote) */}
        <div className="hidden sm:flex items-center gap-1.5 opacity-80 group-hover/row:opacity-100 transition-opacity duration-200">
          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            onClick={() => scroll('left')}
            aria-label="Scroll left"
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white hover:text-black text-white border border-white/[0.1] transition-all active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            data-tv-ignore="true"
            onClick={() => scroll('right')}
            aria-label="Scroll right"
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white hover:text-black text-white border border-white/[0.1] transition-all active:scale-95 cursor-pointer"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {/* Native 60fps Momentum Rail with TV Row Registration */}
      <div
        ref={rowRef}
        data-tv-row="true"
        className="relative z-10 flex overflow-x-auto overflow-y-hidden gap-[clamp(0.65rem,1.8vw,1rem)] px-[var(--fluid-page-px)] pb-3 pt-1 no-scrollbar ios-touch-rail ios-snap-rail items-stretch"
      >
        {items.map((item, idx) => (
          <div key={`${item.id}-${idx}`} className="flex-shrink-0 ios-snap-card">
            <MediaCard
              item={item}
              imageUrl={tmdb.getImageUrl(
                variant === 'backdrop'
                  ? item.backdrop_path || item.poster_path
                  : item.poster_path || item.profile_path || item.backdrop_path,
                optimalPosterSize
              )}
              onClick={onClick}
              variant={variant}
              index={idx}
              tmdb={tmdb}
            />
          </div>
        ))}

        {/* "See All" End Card */}
        <div
          data-tv-ignore="true"
          className="flex-shrink-0 flex items-center justify-center w-[64px] md:w-[84px] group/more cursor-pointer"
          onClick={onExtend}
        >
          <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover/more:bg-white group-hover/more:text-black transition-all active:scale-95">
            <ChevronRight size={18} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const CinematicRow = memo(CinematicRowComponent);