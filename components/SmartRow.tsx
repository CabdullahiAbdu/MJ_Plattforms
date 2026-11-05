import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { MediaItem, TmdbResponse, Rect } from '../types';
import { TmdbService } from '../services/tmdb';
import { MediaCard } from './MovieCard';

interface SmartRowProps {
  title: string;
  queryKey?: string;
  initialItems?: MediaItem[];
  fetcher: (page: number) => Promise<TmdbResponse<MediaItem>>;
  tmdb: TmdbService | null;
  onClick: (item: MediaItem, rect?: Rect) => void;
  onExtend?: () => void;
  onSeeAll?: () => void;
}

export const SmartRow: React.FC<SmartRowProps> = ({
  title,
  queryKey,
  initialItems,
  fetcher,
  tmdb,
  onClick,
  onExtend,
  onSeeAll,
}) => {
  const [items, setItems] = useState<MediaItem[]>(initialItems || []);
  const [initialLoading, setInitialLoading] = useState<boolean>(
    !(initialItems && initialItems.length > 0)
  );
  const [isNearViewport, setIsNearViewport] = useState<boolean>(
    Boolean(initialItems && initialItems.length > 0)
  );
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const handleSeeAll = onSeeAll || onExtend;
  const effectiveKey = queryKey || title;

  useEffect(() => {
    if (isNearViewport) return;
    if (typeof IntersectionObserver === 'undefined' || !containerRef.current) {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isNearViewport]);

  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setItems(initialItems);
      setInitialLoading(false);
      setPage(1);
      setHasMore(true);
      return;
    }

    if (!isNearViewport) return;

    let mounted = true;
    setInitialLoading(true);
    const load = async () => {
      try {
        const data = await fetcherRef.current(1);
        if (mounted) {
          setItems(data.results || []);
          setHasMore(data.page < data.total_pages);
        }
      } catch (e) {
        console.error('SmartRow load failed', e);
      } finally {
        if (mounted) {
          setInitialLoading(false);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [effectiveKey, initialItems, isNearViewport]);

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { clientWidth } = rowRef.current;
      const scrollAmount = direction === 'left' ? -clientWidth / 1.5 : clientWidth / 1.5;
      rowRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    if (!rowRef.current || !hasMore || loadingMore) return;
    const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
    if (scrollWidth - (scrollLeft + clientWidth) < 400) {
      loadMore();
    }
  };

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const data = await fetcherRef.current(nextPage);
      setItems((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        const newItems = (data.results || []).filter((i) => !existing.has(i.id));
        return [...prev, ...newItems];
      });
      setPage(nextPage);
      setHasMore(data.page < data.total_pages);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!tmdb) return null;
  if (!initialLoading && items.length === 0) return null;

  return (
    <div ref={containerRef} className="group/row relative z-10 mb-6 sm:mb-8">
      <div className="flex items-center justify-between pr-[var(--fluid-page-px)] mb-3">
        <div
          className={`flex items-center gap-2 ${
            handleSeeAll ? 'cursor-pointer group/title' : ''
          }`}
          onClick={handleSeeAll}
        >
          <h3 className="text-[length:var(--fluid-h2)] font-bold text-zinc-100 flex items-center gap-2">
            <span>{title}</span>
            {handleSeeAll && (
              <ChevronRight
                className="opacity-70 group-hover/title:opacity-100 transition-opacity text-zinc-400"
                size={18}
              />
            )}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {handleSeeAll && (
            <button
              type="button"
              tabIndex={-1}
              data-tv-ignore="true"
              onClick={(e) => {
                e.stopPropagation();
                handleSeeAll();
              }}
              className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/15 text-xs font-semibold text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              See All
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1.5">
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
      </div>

      <div className="relative group/list">
        <div
          ref={rowRef}
          data-tv-row="true"
          onScroll={handleScroll}
          className="flex gap-[clamp(0.65rem,1.8vw,1rem)] overflow-x-auto overflow-y-hidden pb-3 pt-1 pr-6 no-scrollbar ios-touch-rail"
        >
          {initialLoading && items.length === 0
            ? Array.from({ length: 7 }).map((_, idx) => (
                <div
                  key={`skel-${idx}`}
                  style={{ width: 'var(--fluid-card-w)' }}
                  className="flex-shrink-0"
                >
                  <div className="aspect-[2/3] rounded-2xl bg-zinc-900/90 cinema-shimmer" />
                  <div className="h-3.5 w-3/4 rounded bg-zinc-900/80 mt-2" />
                </div>
              ))
            : items.map((item) => (
                <div key={item.id} className="flex-shrink-0">
                  <MediaCard
                    item={item}
                    onClick={onClick}
                    imageUrl={tmdb.getImageUrl(item.poster_path || item.backdrop_path, 'w500')}
                    tmdb={tmdb}
                  />
                </div>
              ))}
          {loadingMore && (
            <div className="flex items-center justify-center min-w-[90px]">
              <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};