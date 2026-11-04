import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { TmdbService } from '../services/tmdb';
import {
  MediaItem,
  AppView,
  TmdbResponse,
  ExpandHandler,
  Genre,
  WatchProvider,
  resolveMediaType,
} from '../types';
import { HeroItem } from '../components/HeroItem';
import { CinematicRow } from '../components/CinematicRow';
import { ChevronLeft, Sparkles, ArrowRight, RefreshCw, Plus, Play, Tv } from '../components/Icons';
import { Shuffle } from 'lucide-react';
import { TetrisGrid } from '../components/TetrisGrid';
import { RecommendationEngine } from '../services/recommendationEngine';
import { useAmbientActions } from '../context/AmbientContext';
import { SafeImage } from '../components/SafeImage';
import { SmartShuffleModal } from '../components/SmartShuffleModal';
import { haptics } from '../services/haptics';

interface HomeViewProps {
  tmdb: TmdbService;
  navigate: (view: AppView, params?: any) => void;
  onExpand: ExpandHandler;
  watchlist: MediaItem[];
  watchedCompositeKeys: Set<string>;
  watchedEpisodes?: Record<number, number[]>;
  onToggleWatchlist?: (item: MediaItem) => void;
  userGenres?: number[];
  userProviders?: number[];
}

interface ExtendedCategory {
  title: string;
  items: MediaItem[];
  fetcher: (page: number) => Promise<TmdbResponse<MediaItem>>;
  page: number;
  hasMore: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
  tmdb,
  navigate,
  onExpand,
  watchlist,
  watchedCompositeKeys,
  watchedEpisodes = {},
  onToggleWatchlist,
  userGenres = [],
  userProviders = [],
}) => {
  const [heroItems, setHeroItems] = useState<MediaItem[]>([]);
  const [heroLoading, setHeroLoading] = useState<boolean>(true);
  const [heroError, setHeroError] = useState<boolean>(false);
  const [spotlightItem, setSpotlightItem] = useState<MediaItem | null>(null);
  const [genreMap, setGenreMap] = useState<Record<number, string>>({});
  const [extendedCategory, setExtendedCategory] = useState<ExtendedCategory | null>(null);
  const [loadingExtended, setLoadingExtended] = useState(false);

  const [subscribedProviders, setSubscribedProviders] = useState<WatchProvider[]>([]);
  const [popularProviders, setPopularProviders] = useState<WatchProvider[]>([]);
  const [activeProviderFilter, setActiveProviderFilter] = useState<'all' | 'my_subs' | number>('all');

  const [trendingPeople, setTrendingPeople] = useState<MediaItem[]>([]);
  const [isSmartShuffleOpen, setIsSmartShuffleOpen] = useState(false);
  const [showStickyTopBar, setShowStickyTopBar] = useState(false);
  const heroWrapRef = useRef<HTMLDivElement>(null);

  const { setHeroBackground } = useAmbientActions();

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  // Apple TV+ Elastic Hero Overscroll & Progressive Sticky Header (60fps TV-optimized)
  useEffect(() => {
    const mainEl = scrollRef.current?.closest('main');
    if (!mainEl) return;

    const onMainScroll = () => {
      const y = mainEl.scrollTop;
      scrollTop.current = y;
      const shouldShowSticky = y > 260;
      setShowStickyTopBar((prev) => (prev === shouldShowSticky ? prev : shouldShowSticky));

      const isTv = document.documentElement.getAttribute('data-tv-mode') === 'true';
      if (heroWrapRef.current && !isTv) {
        if (y < 0) {
          const scale = 1 + Math.min(0.18, Math.abs(y) / 420);
          heroWrapRef.current.style.transform = `scale(${scale.toFixed(4)})`;
        } else if (y < 520) {
          const translateY = y * 0.16;
          heroWrapRef.current.style.transform = `translate3d(0, ${translateY.toFixed(1)}px, 0)`;
        }
      }
    };

    mainEl.addEventListener('scroll', onMainScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', onMainScroll);
  }, []);

  // Smart TV & VIDAA OS Remote: Blue Color Button opens Smart Shuffle, Back closes Smart Shuffle or Extended Grid
  useEffect(() => {
    const onOpenShuffle = () => {
      haptics.medium();
      setIsSmartShuffleOpen(true);
    };
    const onTvBack = (e: Event) => {
      if (isSmartShuffleOpen) {
        e.preventDefault();
        setIsSmartShuffleOpen(false);
        return;
      }
      if (extendedCategory) {
        e.preventDefault();
        setExtendedCategory(null);
      }
    };
    window.addEventListener('mj:open-smart-shuffle', onOpenShuffle);
    window.addEventListener('mj:tv-back', onTvBack);
    return () => {
      window.removeEventListener('mj:open-smart-shuffle', onOpenShuffle);
      window.removeEventListener('mj:tv-back', onTvBack);
    };
  }, [isSmartShuffleOpen, extendedCategory]);

  // Load Trending People of the Week (Endpoint #4: /trending/person/week)
  useEffect(() => {
    let mounted = true;
    tmdb
      .getTrendingPeople('week', 1)
      .then((res) => {
        if (mounted) setTrendingPeople((res.results || []).slice(0, 16));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [tmdb, tmdb.getLanguage()]);

  // Compute "Weiterstreamen" (Continue Watching) items from watchlist & active episode tracking
  const continueWatchingItems = useMemo(() => {
    const inProgressShows = watchlist.filter((item) => {
      const eps = watchedEpisodes[item.id];
      return eps && eps.length > 0;
    });
    const unseenWatchlist = watchlist.filter((item) => {
      const kind = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
      const eps = watchedEpisodes[item.id];
      return (!eps || eps.length === 0) && !watchedCompositeKeys.has(`${kind}:${item.id}`);
    });
    return [...inProgressShows, ...unseenWatchlist].slice(0, 12);
  }, [watchlist, watchedEpisodes, watchedCompositeKeys]);

  const regionCode = tmdb.getRegion();
  const languageCode = tmdb.getLanguage();

  // Reset active filter if user removes that provider
  useEffect(() => {
    if (activeProviderFilter === 'my_subs' && userProviders.length === 0) {
      setActiveProviderFilter('all');
    } else if (
      typeof activeProviderFilter === 'number' &&
      userProviders.length > 0 &&
      !userProviders.includes(activeProviderFilter)
    ) {
      setActiveProviderFilter('all');
    }
  }, [userProviders, activeProviderFilter]);

  // Load metadata for user's subscribed streaming services and top regional providers
  useEffect(() => {
    let mounted = true;
    tmdb
      .getWatchProviderList('movie')
      .then((allProviders) => {
        if (!mounted) return;
        setPopularProviders(allProviders.slice(0, 8));
        if (userProviders.length === 0) {
          setSubscribedProviders([]);
          return;
        }
        const userSet = new Set(userProviders);
        const matched = allProviders.filter((p) => userSet.has(p.provider_id));
        setSubscribedProviders(matched);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [tmdb, regionCode, userProviders.join(',')]);

  const effectiveProviderIds = useMemo<number[] | undefined>(() => {
    if (activeProviderFilter === 'all') return undefined;
    if (activeProviderFilter === 'my_subs') {
      return userProviders.length > 0 ? userProviders : undefined;
    }
    if (typeof activeProviderFilter === 'number') {
      return [activeProviderFilter];
    }
    return undefined;
  }, [activeProviderFilter, userProviders]);

  const providerFilterKey = effectiveProviderIds ? effectiveProviderIds.join('|') : 'all';

  const loadHeroFeed = async () => {
    setHeroLoading(true);
    setHeroError(false);
    try {
      const [nowPlaying, movieGenres] = await Promise.all([
        tmdb.getNowPlayingMovies(1, effectiveProviderIds),
        tmdb.getGenres('movie').catch(() => [] as Genre[]),
      ]);

      const gMap: Record<number, string> = {};
      movieGenres.forEach((g) => {
        gMap[g.id] = g.name;
      });
      setGenreMap(gMap);

      if (nowPlaying.results && nowPlaying.results.length > 0) {
        const topSlice = nowPlaying.results.slice(0, 8);
        setHeroItems(topSlice);
        if (topSlice[0].backdrop_path) {
          setHeroBackground(topSlice[0].backdrop_path);
        }
        // Asynchronously enrich hero items with official transparent PNG logos & FSK ratings
        tmdb
          .enrichHeroItems(topSlice)
          .then((enriched) => {
            setHeroItems(enriched);
          })
          .catch(() => {});
      } else {
        setHeroItems([]);
      }
    } catch (e) {
      console.error('Failed to load hero feed:', e);
      setHeroError(true);
    } finally {
      setHeroLoading(false);
    }
  };

  useEffect(() => {
    loadHeroFeed();
  }, [tmdb, regionCode, languageCode, providerFilterKey]);

  useEffect(() => {
    let mounted = true;
    const computeSpotlight = async () => {
      try {
        const engine = new RecommendationEngine(
          tmdb,
          watchlist,
          watchedCompositeKeys,
          userGenres
        );
        const smartPick = await engine.getSpotlightRecommendation();
        if (mounted && smartPick) {
          setSpotlightItem(smartPick);
        }
      } catch (e) {
        console.error('Spotlight recommendation error:', e);
      }
    };

    const timer = setTimeout(computeSpotlight, 150);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [
    tmdb,
    regionCode,
    languageCode,
    watchlist.length,
    watchedCompositeKeys.size,
    userGenres.join(','),
  ]);

  const openExtendedView = async (
    title: string,
    fetcher: (page: number) => Promise<TmdbResponse<MediaItem>>
  ) => {
    try {
      const initialData = await fetcher(1);
      setExtendedCategory({
        title,
        items: initialData.results || [],
        fetcher,
        page: 1,
        hasMore: initialData.page < initialData.total_pages,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const loadMoreExtended = async () => {
    if (!extendedCategory || !extendedCategory.hasMore || loadingExtended) return;
    setLoadingExtended(true);
    const nextPage = extendedCategory.page + 1;
    try {
      const data = await extendedCategory.fetcher(nextPage);
      setExtendedCategory((prev) =>
        prev
          ? {
              ...prev,
              items: [...prev.items, ...(data.results || [])],
              page: nextPage,
              hasMore: data.page < data.total_pages,
            }
          : null
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingExtended(false);
    }
  };

  useEffect(() => {
    if (!extendedCategory) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMoreExtended();
    });
    const sentinel = document.getElementById('extended-sentinel');
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  }, [extendedCategory, loadingExtended]);

  const handleCardOpen = (item: MediaItem, rect?: any) => {
    if (rect) {
      onExpand(item, rect);
    } else {
      navigate(AppView.DETAILS, {
        id: item.id,
        type: resolveMediaType(item),
        seedItem: item,
      });
    }
  };

  if (extendedCategory) {
    return (
      <div className="animate-fade-in px-[var(--fluid-page-px)] pb-10 min-h-screen bg-transparent">
        <div
          style={{
            paddingTop: 'max(0.85rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))',
          }}
          className="flex items-center gap-3 md:gap-5 mb-6 sticky top-0 bg-black/85 backdrop-blur-xl z-30 pb-3.5 -mx-[var(--fluid-page-px)] px-[var(--fluid-page-px)] border-b border-white/10"
        >
          <button
            type="button"
            onClick={() => setExtendedCategory(null)}
            className="min-w-[42px] min-h-[42px] flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-all active:scale-95 group"
          >
            <ChevronLeft size={20} className="text-zinc-300 group-hover:text-white" />
          </button>
          <h2 className="text-[length:var(--fluid-h1)] font-black tracking-tight text-white truncate">
            {extendedCategory.title}
          </h2>
        </div>

        <TetrisGrid items={extendedCategory.items} tmdb={tmdb} onClick={handleCardOpen} />

        {extendedCategory.hasMore && (
          <div id="extended-sentinel" className="h-28 flex items-center justify-center mt-6">
            <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  const personalizedGenres = userGenres.slice(0, 2);
  const displayedProviders =
    subscribedProviders.length > 0 ? subscribedProviders : popularProviders;
  const activeFilterProviderObj =
    typeof activeProviderFilter === 'number'
      ? [...subscribedProviders, ...popularProviders].find(
          (p) => p.provider_id === activeProviderFilter
        )
      : null;

  return (
    <div
      ref={scrollRef}
      data-scroll-container="home-view"
      className="min-h-full bg-transparent relative"
    >
      {/* Progressive Blurred Sticky Top Bar (Feature #4: Apple TV+ Sticky Header) */}
      <div
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))',
        }}
        className={`fixed top-0 left-0 right-0 z-40 px-[var(--fluid-page-px)] pb-2.5 bg-black/75 backdrop-blur-2xl border-b border-white/10 transition-all duration-300 flex items-center justify-between ${
          showStickyTopBar
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-black tracking-widest uppercase text-white">MOVIES</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-zinc-300">
            {activeFilterProviderObj
              ? activeFilterProviderObj.provider_name
              : activeProviderFilter === 'my_subs'
              ? 'Meine Abos'
              : regionCode}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            haptics.medium();
            setIsSmartShuffleOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 text-black font-black text-[11px] uppercase tracking-wider active:scale-95 transition-transform shadow-lg shadow-amber-500/20"
        >
          <Shuffle size={12} /> Überrasch mich
        </button>
      </div>

      {/* HERO (Edge-to-Edge behind the Dynamic Island on mobile with Apple TV+ Elastic Overscroll Zoom) */}
      <div
        ref={heroWrapRef}
        style={{ transformOrigin: 'top center' }}
        className="pt-0 md:pt-4 px-0 md:px-[var(--fluid-page-px)] pb-1 md:pb-2.5 z-20 relative"
      >
        {heroLoading && heroItems.length === 0 ? (
          <div
            style={{
              height: 'var(--fluid-hero-h)',
            }}
            className="w-full max-w-[2200px] mx-auto rounded-b-[clamp(1.25rem,3vw,2.25rem)] rounded-t-none md:rounded-[clamp(1.25rem,3vw,2.25rem)] cinema-shimmer"
          />
        ) : heroError && heroItems.length === 0 ? (
          <div
            style={{
              marginTop: 'max(1rem, calc(env(safe-area-inset-top, 0px) + 0.75rem))',
            }}
            className="w-full max-w-[2200px] mx-auto rounded-3xl p-8 md:p-12 bg-zinc-900/80 text-center space-y-4"
          >
            <h2 className="text-[length:var(--fluid-h2)] font-bold text-white">
              Unable to load featured catalogue
            </h2>
            <p className="text-[length:var(--fluid-body)] text-zinc-400">
              Please verify your network connection.
            </p>
            <button
              type="button"
              onClick={loadHeroFeed}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-200 transition-colors"
            >
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        ) : (
          heroItems.length > 0 && (
            <HeroItem
              items={heroItems}
              tmdb={tmdb}
              onPlay={(item, rect) => onExpand(item, rect, { autoPlayTrailer: true })}
              onDetails={(item, rect) => onExpand(item, rect, { autoPlayTrailer: false })}
            />
          )
        )}
      </div>

      {/* FRAMELESS STREAMING PROVIDERS + SMART SHUFFLE BELOW HERO */}
      {displayedProviders.length > 0 && (
        <div className="px-[var(--fluid-page-px)] pt-1 pb-1.5 md:pb-3 z-20 relative">
          <div
            data-tv-row="true"
            className="w-full max-w-[2200px] mx-auto flex items-center gap-3 sm:gap-3.5 overflow-x-auto no-scrollbar ios-touch-rail py-1"
          >
            {/* Feature #8: Netflix "Überrasch mich" Smart Shuffle Button */}
            <button
              type="button"
              onClick={() => {
                haptics.medium();
                setIsSmartShuffleOpen(true);
              }}
              className="min-h-[36px] px-3.5 py-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black text-xs tracking-tight flex items-center gap-1.5 shrink-0 shadow-[0_0_20px_rgba(245,158,11,0.35)] active:scale-95 transition-transform"
            >
              <Shuffle size={13} />
              <span>Überrasch mich</span>
            </button>

            <div className="h-4 w-px bg-white/10 shrink-0" />

            <button
              type="button"
              onClick={() => {
                haptics.selection();
                setActiveProviderFilter('all');
              }}
              className={`min-h-[44px] px-1.5 flex items-center justify-center relative text-xs sm:text-[13px] tracking-tight transition-all duration-200 whitespace-nowrap shrink-0 ${
                activeProviderFilter === 'all'
                  ? 'text-white font-bold drop-shadow-[0_0_12px_rgba(255,255,255,0.55)]'
                  : 'text-zinc-500 hover:text-zinc-300 font-semibold'
              }`}
            >
              <span>Alle</span>
              {activeProviderFilter === 'all' && (
                <span className="absolute bottom-1.5 left-1.5 right-1.5 h-[2px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
              )}
            </button>

            {subscribedProviders.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  haptics.selection();
                  setActiveProviderFilter(
                    activeProviderFilter === 'my_subs' ? 'all' : 'my_subs'
                  );
                }}
                className={`min-h-[44px] px-1.5 flex items-center justify-center relative text-xs sm:text-[13px] tracking-tight transition-all duration-200 whitespace-nowrap shrink-0 ${
                  activeProviderFilter === 'my_subs'
                    ? 'text-white font-bold drop-shadow-[0_0_12px_rgba(255,255,255,0.55)]'
                    : 'text-zinc-500 hover:text-zinc-300 font-semibold'
                }`}
              >
                <span>Meine Abos</span>
                {activeProviderFilter === 'my_subs' && (
                  <span className="absolute bottom-1.5 left-1.5 right-1.5 h-[2px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                )}
              </button>
            )}

            <div className="h-4 w-px bg-white/10 shrink-0" />

            <div className="flex items-center gap-2.5 sm:gap-3.5">
              {displayedProviders.map((provider) => {
                const isSelected = activeProviderFilter === provider.provider_id;
                const isActiveGroup = activeProviderFilter === 'my_subs' && subscribedProviders.length > 0;
                return (
                  <button
                    key={provider.provider_id}
                    type="button"
                    title={provider.provider_name}
                    aria-label={provider.provider_name}
                    onClick={() => {
                      haptics.selection();
                      setActiveProviderFilter(isSelected ? 'all' : provider.provider_id);
                    }}
                    className="min-w-[44px] min-h-[44px] flex flex-col items-center justify-center relative group shrink-0 focus:outline-none"
                  >
                    <img
                      src={tmdb.getImageUrl(provider.logo_path, 'w200')}
                      alt={provider.provider_name}
                      referrerPolicy="no-referrer"
                      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover transition-all duration-200 ${
                        isSelected
                          ? 'opacity-100 scale-110 drop-shadow-[0_0_14px_rgba(255,255,255,0.65)]'
                          : isActiveGroup
                          ? 'opacity-90 scale-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.35)] hover:opacity-100 hover:scale-105'
                          : activeProviderFilter === 'all'
                          ? 'opacity-75 hover:opacity-100 hover:scale-105 drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]'
                          : 'opacity-35 hover:opacity-80 hover:scale-105'
                      }`}
                    />
                    {isSelected && (
                      <span className="w-4 h-[2px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.95)] mt-1" />
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => navigate(AppView.SETTINGS)}
                title="Streaming-Abos verwalten"
                aria-label="Streaming-Abos verwalten"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-500 hover:text-white transition-colors shrink-0"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CINEMATIC STRIPS */}
      <div className="relative z-10 space-y-1 md:space-y-3">
        {/* Feature #7: Apple TV+ "Als Nächstes / Weiterstreamen" (Continue Watching) Shelf */}
        {continueWatchingItems.length > 0 && (
          <div className="py-2 md:py-3.5">
            <div className="px-[var(--fluid-page-px)] mb-2 md:mb-3 flex items-end justify-between">
              <div>
                <h3 className="text-[length:var(--fluid-h2)] font-bold text-white tracking-tight">
                  Als Nächstes & Weiterstreamen
                </h3>
                <p className="text-zinc-400 font-normal text-[clamp(0.68rem,calc(0.64rem+0.15vw),0.8rem)] mt-0.5">
                  Deine begonnenen Serien & Watchlist-Favoriten
                </p>
              </div>
            </div>
            <div
              data-tv-row="true"
              className="flex overflow-x-auto gap-[clamp(0.65rem,1.8vw,1rem)] px-[var(--fluid-page-px)] pb-3 pt-1 no-scrollbar ios-touch-rail ios-snap-rail"
            >
              {continueWatchingItems.map((item) => {
                const epCount = watchedEpisodes[item.id]?.length || 0;
                const mediaKind = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
                const progressPct = epCount > 0 ? Math.min(92, 18 + epCount * 9) : 12;
                return (
                  <div
                    key={`cw-${item.id}`}
                    tabIndex={0}
                    data-tv-card="true"
                    onClick={(e) => {
                      haptics.light();
                      const r = e.currentTarget.getBoundingClientRect();
                      handleCardOpen(item, {
                        top: r.top,
                        left: r.left,
                        width: r.width,
                        height: r.height,
                      });
                    }}
                    onKeyDown={(e) => {
                      const code = e.keyCode || e.which;
                      if (e.key === 'Enter' || e.key === ' ' || code === 13) {
                        e.preventDefault();
                        haptics.light();
                        const r = e.currentTarget.getBoundingClientRect();
                        handleCardOpen(item, {
                          top: r.top,
                          left: r.left,
                          width: r.width,
                          height: r.height,
                        });
                      }
                    }}
                    style={{ width: 'var(--fluid-backdrop-w)' }}
                    className="focusable group relative flex-shrink-0 aspect-video rounded-2xl overflow-hidden bg-zinc-900 cursor-pointer active:scale-[0.98] transition-transform shadow-lg border border-white/10 ios-snap-card outline-none"
                  >
                    <SafeImage
                      src={tmdb.getImageUrl(item.backdrop_path || item.poster_path, 'w780')}
                      fallbackTitle={item.title || item.name}
                      className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent flex flex-col justify-between p-3">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded-md bg-black/75 border border-white/15 text-[10px] font-bold tracking-wide text-zinc-200">
                          {epCount > 0
                            ? `${epCount} ${epCount === 1 ? 'Folge' : 'Folgen'} gesehen`
                            : mediaKind === 'tv'
                            ? 'Staffel 1 · Folge 1'
                            : 'Bereit zum Abspielen'}
                        </span>
                        <div className="w-7 h-7 rounded-full bg-white/95 text-black flex items-center justify-center shadow-md">
                          <Play size={12} fill="currentColor" />
                        </div>
                      </div>
                      <div>
                        <h4 className="text-white font-bold text-[clamp(0.76rem,calc(0.7rem+0.25vw),0.92rem)] leading-tight line-clamp-1">
                          {item.title || item.name}
                        </h4>
                        <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden mt-1.5">
                          <div
                            style={{ width: `${progressPct}%` }}
                            className="h-full bg-white rounded-full"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <CinematicRow
          title={
            activeFilterProviderObj
              ? `Top 10 auf ${activeFilterProviderObj.provider_name}`
              : activeProviderFilter === 'my_subs'
              ? 'Top 10 in deinen Abos'
              : 'Top 10 Movies Today'
          }
          subtitle={`Most watched in ${regionCode}`}
          queryKey={`home:top10-movie:${languageCode}:${regionCode}:${providerFilterKey}`}
          fetcher={(p) =>
            tmdb.discoverRegional(
              'movie',
              { sort_by: 'popularity.desc' },
              p,
              { providerIds: effectiveProviderIds }
            )
          }
          tmdb={tmdb}
          onClick={handleCardOpen}
          onExtend={() =>
            openExtendedView('Top Movies Today', (p) =>
              tmdb.discoverRegional(
                'movie',
                { sort_by: 'popularity.desc' },
                p,
                { providerIds: effectiveProviderIds }
              )
            )
          }
          variant="ranked"
        />

        <CinematicRow
          title={
            activeFilterProviderObj
              ? `Serien-Highlights auf ${activeFilterProviderObj.provider_name}`
              : activeProviderFilter === 'my_subs'
              ? 'Serien in deinen Abos'
              : 'Essential Television'
          }
          subtitle={`Series trending in ${regionCode}`}
          queryKey={`home:essential-tv:${languageCode}:${regionCode}:${providerFilterKey}`}
          fetcher={(p) =>
            tmdb.discoverRegional(
              'tv',
              { sort_by: 'popularity.desc' },
              p,
              { providerIds: effectiveProviderIds }
            )
          }
          tmdb={tmdb}
          onClick={handleCardOpen}
          onExtend={() =>
            openExtendedView('Essential Television', (p) =>
              tmdb.discoverRegional(
                'tv',
                { sort_by: 'popularity.desc' },
                p,
                { providerIds: effectiveProviderIds }
              )
            )
          }
          variant="backdrop"
        />

        {/* Endpoint #5: /tv/airing_today (Heute mit neuer Folge im TV & Stream) */}
        <CinematicRow
          title="Heute mit neuer Folge"
          subtitle="Serien mit brandneuer Episode heute im Stream & TV"
          queryKey={`home:airing-today-tv:${languageCode}:${regionCode}`}
          fetcher={(p) => tmdb.getAiringTodayTv(p)}
          tmdb={tmdb}
          onClick={handleCardOpen}
          onExtend={() =>
            openExtendedView('Heute mit neuer Folge', (p) => tmdb.getAiringTodayTv(p))
          }
          variant="backdrop"
        />

        {personalizedGenres.map((genreId) => {
          const gName = genreMap[genreId];
          if (!gName) return null;
          return (
            <CinematicRow
              key={genreId}
              title={`Curated ${gName}`}
              subtitle={`Because you enjoy ${gName}`}
              queryKey={`home:genre:${genreId}:${languageCode}:${regionCode}:${providerFilterKey}`}
              fetcher={(p) =>
                tmdb.discoverRegional(
                  'movie',
                  { with_genres: genreId.toString(), sort_by: 'popularity.desc' },
                  p,
                  { providerIds: effectiveProviderIds }
                )
              }
              tmdb={tmdb}
              onClick={handleCardOpen}
              onExtend={() =>
                openExtendedView(`Curated ${gName}`, (p) =>
                  tmdb.discoverRegional(
                    'movie',
                    { with_genres: genreId.toString(), sort_by: 'popularity.desc' },
                    p,
                    { providerIds: effectiveProviderIds }
                  )
                )
              }
              variant="poster"
            />
          );
        })}

        {/* FLUID SPOTLIGHT BREAK */}
        {spotlightItem && (
          <div data-tv-row="true" className="px-[var(--fluid-page-px)] py-3 md:py-5">
            <div
              tabIndex={0}
              data-tv-card="true"
              onClick={(e) => {
                haptics.light();
                const rect = e.currentTarget.getBoundingClientRect();
                onExpand(spotlightItem, {
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                });
              }}
              onKeyDown={(e) => {
                const code = e.keyCode || e.which;
                if (e.key === 'Enter' || e.key === ' ' || code === 13) {
                  e.preventDefault();
                  haptics.light();
                  const rect = e.currentTarget.getBoundingClientRect();
                  onExpand(spotlightItem, {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                  });
                }
              }}
              style={{
                height: 'clamp(240px, 40dvh, 410px)',
                borderRadius: 'clamp(1.15rem, 2.5vw, 1.85rem)',
              }}
              className="focusable relative w-full overflow-hidden group cursor-pointer shadow-[0_18px_45px_-12px_rgba(0,0,0,0.85)] bg-zinc-900 active:scale-[0.99] transition-transform outline-none"
            >
              <SafeImage
                src={tmdb.getImageUrl(
                  spotlightItem.backdrop_path || spotlightItem.poster_path,
                  'w1280'
                )}
                fallbackTitle={spotlightItem.title || spotlightItem.name}
                className="absolute inset-0 w-full h-full object-cover"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent md:bg-gradient-to-r md:from-black md:via-black/60 md:to-transparent" />

              <div
                style={{ padding: 'clamp(1.15rem, 3.2vw, 2.5rem)' }}
                className="absolute bottom-0 left-0 w-full flex flex-col justify-end items-start h-full"
              >
                <div className="flex items-center gap-2 text-zinc-300 text-[clamp(0.68rem,calc(0.62rem+0.15vw),0.78rem)] font-semibold tracking-wide mb-1.5">
                  <Sparkles size={13} />
                  <span>Recommended For Your Taste</span>
                </div>
                <h2
                  style={{
                    fontSize: 'clamp(1.25rem, calc(1rem + 1.4vw), 2.35rem)',
                    textWrap: 'balance',
                  }}
                  className="font-black text-white leading-[1.06] mb-2 drop-shadow-xl max-w-2xl line-clamp-2"
                >
                  {spotlightItem.title || spotlightItem.name}
                </h2>
                <p
                  style={{ fontSize: 'clamp(0.75rem, calc(0.7rem + 0.18vw), 0.9rem)' }}
                  className="text-zinc-300 line-clamp-2 font-normal max-w-xl mb-3 leading-relaxed"
                >
                  {spotlightItem.overview}
                </p>
                <div className="flex items-center gap-2.5 group/btn">
                  <span className="text-white font-bold text-[clamp(0.75rem,calc(0.7rem+0.18vw),0.88rem)] border-b border-white pb-0.5 transition-colors">
                    Explore Recommendation
                  </span>
                  <div className="w-8 h-8 bg-white text-black rounded-full flex items-center justify-center">
                    <ArrowRight size={15} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Endpoint #6: /movie/top_rated (All-Time Top 250 Meisterwerke) */}
        <CinematicRow
          title="All-Time Meisterwerke (Top 250)"
          subtitle="Der zeitlose Film-Kanon der Filmgeschichte"
          queryKey={`home:official-top250:${languageCode}:${regionCode}`}
          fetcher={(p) => tmdb.getOfficialTopRated('movie', p)}
          tmdb={tmdb}
          onClick={handleCardOpen}
          onExtend={() =>
            openExtendedView('All-Time Meisterwerke (Top 250)', (p) =>
              tmdb.getOfficialTopRated('movie', p)
            )
          }
          variant="poster"
        />

        {/* Endpoint #4: /trending/person/week (Stars & Regisseure der Woche — Apple TV+ Circular Rail) */}
        {trendingPeople.length > 0 && (
          <div className="py-2 md:py-3.5">
            <div className="px-[var(--fluid-page-px)] mb-2.5">
              <h3 className="text-[length:var(--fluid-h2)] font-bold text-white tracking-tight">
                Stars & Regisseure der Woche
              </h3>
              <p className="text-zinc-400 font-normal text-[clamp(0.68rem,calc(0.64rem+0.15vw),0.8rem)] mt-0.5">
                Meistgesuchte Persönlichkeiten weltweit
              </p>
            </div>
            <div
              data-tv-row="true"
              className="flex overflow-x-auto gap-3.5 sm:gap-4 px-[var(--fluid-page-px)] pb-3 pt-1 no-scrollbar ios-touch-rail ios-snap-rail"
            >
              {trendingPeople.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  data-tv-card="true"
                  onClick={() => {
                    haptics.light();
                    navigate(AppView.PERSON, {
                      id: person.id,
                      type: 'person',
                      seedItem: person,
                    });
                  }}
                  className="focusable group flex-shrink-0 flex flex-col items-center w-22 sm:w-24 text-center outline-none rounded-2xl p-1 ios-snap-card active:scale-95 transition-transform"
                >
                  <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-zinc-900 border border-white/15 group-hover:border-white transition-colors shadow-lg">
                    <SafeImage
                      src={tmdb.getImageUrl(person.profile_path, 'w300')}
                      fallbackTitle={person.name}
                      mediaType="person"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="mt-1.5 text-xs font-semibold text-white line-clamp-1 group-hover:text-zinc-200 transition-colors">
                    {person.name}
                  </span>
                  {person.known_for_department && (
                    <span className="text-[10px] text-zinc-500 font-medium">
                      {person.known_for_department}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <CinematicRow
          title="Critically Acclaimed"
          subtitle={`Highest rated cinema in ${regionCode}`}
          queryKey={`home:top-rated-movie:${languageCode}:${regionCode}:${providerFilterKey}`}
          fetcher={(p) => tmdb.getTopRated('movie', p, effectiveProviderIds)}
          tmdb={tmdb}
          onClick={handleCardOpen}
          onExtend={() =>
            openExtendedView('Top Rated Movies', (p) =>
              tmdb.getTopRated('movie', p, effectiveProviderIds)
            )
          }
          variant="poster"
        />

        <CinematicRow
          title="On The Air"
          subtitle={`New episodes available in ${regionCode}`}
          queryKey={`home:on-the-air-tv:${languageCode}:${regionCode}:${providerFilterKey}`}
          fetcher={(p) => tmdb.getOnTheAirTv(p, effectiveProviderIds)}
          tmdb={tmdb}
          onClick={handleCardOpen}
          onExtend={() =>
            openExtendedView('On The Air', (p) =>
              tmdb.getOnTheAirTv(p, effectiveProviderIds)
            )
          }
          variant="backdrop"
        />
      </div>

      {/* Feature #8: Smart Shuffle ("Überrasch mich") Modal */}
      <SmartShuffleModal
        isOpen={isSmartShuffleOpen}
        onClose={() => setIsSmartShuffleOpen(false)}
        tmdb={tmdb}
        candidates={[...heroItems, ...(spotlightItem ? [spotlightItem] : []), ...watchlist]}
        watchedCompositeKeys={watchedCompositeKeys}
        watchlist={watchlist}
        onToggleWatchlist={(item) => onToggleWatchlist?.(item)}
        navigate={navigate}
      />
    </div>
  );
};
