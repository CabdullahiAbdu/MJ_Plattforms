import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from '../components/Icons';
import { MediaItem, AppView, Genre, WatchProvider } from '../types';
import { TmdbService } from '../services/tmdb';
import { TetrisGrid } from '../components/TetrisGrid';
import { useResponsive } from '../hooks/useResponsive';
import { useAmbientActions } from '../context/AmbientContext';
import { SafeImage } from '../components/SafeImage';

interface ProviderViewProps {
  providerId: number;
  providerName: string;
  logo: string;
  tmdb: TmdbService;
  navigate: (view: AppView, params?: any) => void;
  onBack: () => void;
}

const PROVIDER_SCOPE = 'provider-view-scope';

export const ProviderView: React.FC<ProviderViewProps> = ({
  providerId: initialProviderId,
  tmdb,
  navigate,
  onBack,
}) => {
  const [currentProviderId, setCurrentProviderId] = useState(initialProviderId);
  const [providers, setProviders] = useState<WatchProvider[]>([]);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartValRef = useRef(0);
  const currentIndexRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const observer = useRef<IntersectionObserver | null>(null);
  const { setContextualBackground } = useAmbientActions();
  const { providerWheelStride, providerTileSize } = useResponsive();

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const [pList, gList] = await Promise.all([
          tmdb.getWatchProviderList(mediaType),
          tmdb.getGenres(mediaType),
        ]);
        if (!mounted) return;
        setProviders(pList);
        setGenres(gList);

        const idx = pList.findIndex((p) => p.provider_id === currentProviderId);
        if (idx !== -1) {
          currentIndexRef.current = idx;
          setCarouselIndex(idx);
        }
      } catch (e) {
        console.error(e);
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [tmdb, mediaType]);

  useEffect(() => {
    tmdb.cancelScope(PROVIDER_SCOPE);
    setPage(1);
    setItems([]);
    setHasMore(true);
  }, [currentProviderId, mediaType, selectedGenre, tmdb]);

  useEffect(() => {
    let mounted = true;
    const isFirstPage = page === 1;
    setLoading(true);

    const timeout = setTimeout(
      async () => {
        if (!currentProviderId) return;
        try {
          const params: Record<string, string> = {
            with_watch_providers: currentProviderId.toString(),
            watch_region: tmdb.getRegion(),
            sort_by: 'popularity.desc',
          };
          if (selectedGenre) params.with_genres = selectedGenre.toString();

          const data = await tmdb.discover(mediaType, params, page, {
            scope: PROVIDER_SCOPE,
          });

          if (mounted) {
            if (isFirstPage) setItems(data.results || []);
            else setItems((prev) => [...prev, ...(data.results || [])]);
            setHasMore(data.page < data.total_pages);
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError') console.error(e);
        } finally {
          if (mounted) setLoading(false);
        }
      },
      isFirstPage ? 120 : 0
    );

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [page, mediaType, selectedGenre, currentProviderId, tmdb]);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading || !hasMore) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) setPage((p) => p + 1);
      });
      if (node) observer.current.observe(node);
    },
    [loading, hasMore]
  );

  const normalizeIndex = (idx: number, length: number) => {
    let res = idx % length;
    if (res < 0) res += length;
    return res;
  };

  const getShortestDistance = (from: number, to: number, length: number) => {
    let diff = (to - from) % length;
    if (diff > length / 2) diff -= length;
    if (diff < -length / 2) diff += length;
    return diff;
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    dragStartXRef.current = clientX;
    dragStartValRef.current = currentIndexRef.current;
  };

  const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || providers.length === 0) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const deltaX = clientX - dragStartXRef.current;
    const nextVal = dragStartValRef.current + deltaX * (-1 / Math.max(72, providerWheelStride * 1.15));
    currentIndexRef.current = nextVal;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setCarouselIndex(nextVal);
      rafRef.current = null;
    });
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (providers.length === 0) return;
    const nearestIndex = Math.round(currentIndexRef.current);
    currentIndexRef.current = nearestIndex;
    setCarouselIndex(nearestIndex);
    const normIdx = normalizeIndex(nearestIndex, providers.length);
    setCurrentProviderId(providers[normIdx].provider_id);
  };

  const navigateCarousel = (direction: 'prev' | 'next') => {
    if (providers.length === 0) return;
    const newIndex = Math.round(currentIndexRef.current) + (direction === 'next' ? 1 : -1);
    currentIndexRef.current = newIndex;
    setCarouselIndex(newIndex);
    const normIdx = normalizeIndex(newIndex, providers.length);
    setCurrentProviderId(providers[normIdx].provider_id);
  };

  const selectProvider = (p: WatchProvider) => {
    if (providers.length === 0) return;
    const targetBaseIndex = providers.findIndex((x) => x.provider_id === p.provider_id);
    const currentBaseIndex = normalizeIndex(Math.round(currentIndexRef.current), providers.length);
    const diff = getShortestDistance(currentBaseIndex, targetBaseIndex, providers.length);
    const nextIdx = Math.round(currentIndexRef.current) + diff;
    currentIndexRef.current = nextIdx;
    setCarouselIndex(nextIdx);
    setCurrentProviderId(p.provider_id);
  };

  const selectedGenreName = genres.find((g) => g.id === selectedGenre)?.name || 'All Genres';
  const currentProvider = providers.find((p) => p.provider_id === currentProviderId);

  useEffect(() => {
    if (currentProvider) {
      setContextualBackground(currentProvider.logo_path);
    }
  }, [currentProvider, setContextualBackground]);

  useEffect(() => {
    return () => {
      setContextualBackground(null);
    };
  }, [setContextualBackground]);

  return (
    <div className="min-h-screen bg-transparent animate-fade-in relative overflow-x-hidden">
      <div className="relative pt-[clamp(3.5rem,9dvh,6rem)] pb-6 z-20 flex flex-col items-center">
        <button
          type="button"
          onClick={onBack}
          style={{
            top: 'max(1rem, calc(env(safe-area-inset-top) + 0.5rem))',
            left: 'var(--fluid-page-px)',
          }}
          className="fixed z-50 bg-white/10 backdrop-blur-md p-2.5 rounded-full hover:bg-white/20 transition-all border border-white/10 active:scale-95"
        >
          <ChevronLeft size={22} />
        </button>

        <div
          style={{ height: 'clamp(145px, 24dvh, 196px)' }}
          className="relative w-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-pan-y select-none perspective-[1000px]"
          onMouseDown={handleDragStart}
          onMouseMove={handleDragMove}
          onMouseUp={handleDragEnd}
          onMouseLeave={handleDragEnd}
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigateCarousel('prev');
            }}
            className="absolute left-4 md:left-16 z-40 p-2.5 bg-white/5 hover:bg-white/20 rounded-full backdrop-blur-md border border-white/10 transition-colors hidden md:block"
          >
            <ChevronLeft size={22} />
          </button>

          <div className="relative w-full h-full flex items-center justify-center transform-style-3d">
            {providers.map((p, i) => {
              const len = providers.length;
              const current = carouselIndex;
              const k = Math.round((current - i) / len);
              const effectiveIndex = i + k * len;
              const dist = effectiveIndex - current;

              if (Math.abs(dist) > 3.2) return null;

              const isActive = Math.abs(dist) < 0.5;
              const scale = Math.max(0.58, 1.26 - Math.abs(dist) * 0.28);
              const opacity = Math.max(0, 1 - Math.abs(dist) * 0.26);
              const zIndex = 100 - Math.round(Math.abs(dist) * 10);
              const translateX = dist * providerWheelStride;

              return (
                <div
                  key={p.provider_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isDragging) selectProvider(p);
                  }}
                  style={{
                    width: `${providerTileSize}px`,
                    height: `${providerTileSize}px`,
                    transform: `translate3d(calc(-50% + ${translateX}px), -50%, 0) scale(${scale})`,
                    zIndex,
                    opacity,
                  }}
                  className={`absolute top-1/2 left-1/2 rounded-2xl shadow-2xl will-change-transform ${
                    isDragging
                      ? ''
                      : 'transition-all duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]'
                  }`}
                >
                  <SafeImage
                    src={tmdb.getImageUrl(p.logo_path, 'w200')}
                    fallbackTitle={p.provider_name}
                    className="w-full h-full object-cover rounded-2xl shadow-lg"
                    draggable={false}
                  />
                  {isActive && !isDragging && (
                    <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap font-bold text-white text-[clamp(0.8rem,2.3vw,1rem)] drop-shadow-md pointer-events-none">
                      {p.provider_name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigateCarousel('next');
            }}
            className="absolute right-4 md:right-16 z-40 p-2.5 bg-white/5 hover:bg-white/20 rounded-full backdrop-blur-md border border-white/10 transition-colors hidden md:block"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8 relative z-50 px-[var(--fluid-page-px)]">
          <div className="bg-zinc-900/80 backdrop-blur-md p-1 rounded-xl flex border border-white/10">
            <button
              type="button"
              onClick={() => setMediaType('movie')}
              className={`px-4 py-1.5 rounded-lg text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold transition-all ${
                mediaType === 'movie'
                  ? 'bg-white text-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Movies
            </button>
            <button
              type="button"
              onClick={() => setMediaType('tv')}
              className={`px-4 py-1.5 rounded-lg text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold transition-all ${
                mediaType === 'tv' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              TV
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 bg-zinc-900/80 hover:bg-zinc-800 px-4 py-2 rounded-xl border border-white/10 font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] backdrop-blur-md transition-all justify-between"
            >
              <span className="truncate max-w-[120px]">{selectedGenreName}</span>
              <ChevronDown
                size={14}
                className={`transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-56 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[60] animate-fade-in max-h-72 overflow-y-auto no-scrollbar ios-touch-rail">
                <div className="py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGenre(null);
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 text-white font-medium border-b border-white/5"
                  >
                    All Genres
                  </button>
                  {genres.map((g) => (
                    <button
                      type="button"
                      key={g.id}
                      onClick={() => {
                        setSelectedGenre(g.id);
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 font-medium ${
                        selectedGenre === g.id ? 'text-indigo-400' : 'text-zinc-300'
                      }`}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-[var(--fluid-page-px)] pb-32 relative z-10 min-h-[50vh]">
        <TetrisGrid
          items={items}
          tmdb={tmdb}
          onClick={(item) =>
            navigate(AppView.DETAILS, {
              id: item.id,
              type: mediaType,
              seedItem: { ...item, media_type: mediaType },
            })
          }
          loading={loading && page === 1}
        />

        {hasMore && (
          <div ref={lastElementRef} className="h-28 flex items-center justify-center mt-6">
            {loading && (
              <div className="w-7 h-7 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
            )}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-20 text-zinc-500 text-[length:var(--fluid-body)]">
            <p>No content found for this provider in your region.</p>
          </div>
        )}
      </div>

      {isDropdownOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
      )}
    </div>
  );
};