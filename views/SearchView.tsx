import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
} from '../components/Icons';
import { TmdbService } from '../services/tmdb';
import {
  MediaItem,
  AppView,
  Genre,
  WatchProvider,
  Keyword,
  ExpandHandler,
  resolveMediaType,
} from '../types';
import { TetrisGrid } from '../components/TetrisGrid';
import { MediaCard as MovieCard } from '../components/MovieCard';
import { useResponsive } from '../hooks/useResponsive';
import { useAmbientActions } from '../context/AmbientContext';
import { SafeImage } from '../components/SafeImage';
import {
  RecommendationEngine,
  PersonalizedSearchHubData,
} from '../services/recommendationEngine';

interface SearchViewProps {
  tmdb: TmdbService;
  navigate: (view: AppView, params?: any) => void;
  onExpand: ExpandHandler;
  userProviders?: number[];
  watchlist?: MediaItem[];
  watchedCompositeKeys?: Set<string>;
  userGenres?: number[];
}

const DISCOVER_SCOPE = 'search-discover-scope';
const MULTI_SEARCH_SCOPE = 'search-query-scope';

interface ProviderWheel3DProps {
  providers: WatchProvider[];
  currentProviderId: number | null;
  userProviderSet: Set<number>;
  regionCode: string;
  dimmed: boolean;
  tmdb: TmdbService;
  onSelectProvider: (providerId: number) => void;
}

/**
 * Isolated 60fps 3D Provider Wheel
 * Manages touch drag state locally via requestAnimationFrame so dragging never re-renders TetrisGrid.
 */
const ProviderWheel3D = React.memo<ProviderWheel3DProps>(
  ({
    providers,
    currentProviderId,
    userProviderSet,
    regionCode,
    dimmed,
    tmdb,
    onSelectProvider,
  }) => {
    const { providerWheelStride, providerTileSize } = useResponsive();
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    const dragStartXRef = useRef(0);
    const dragStartValRef = useRef(0);
    const currentIndexRef = useRef(0);
    const rafRef = useRef<number | null>(null);

    const normalizeIndex = (idx: number, length: number) => {
      if (length === 0) return 0;
      let res = idx % length;
      if (res < 0) res += length;
      return res;
    };

    const getShortestDistance = (from: number, to: number, length: number) => {
      if (length === 0) return 0;
      let diff = (to - from) % length;
      if (diff > length / 2) diff -= length;
      if (diff < -length / 2) diff += length;
      return diff;
    };

    useEffect(() => {
      if (!currentProviderId || providers.length === 0) return;
      const targetIdx = providers.findIndex((p) => p.provider_id === currentProviderId);
      if (targetIdx === -1) return;
      const currentBase = normalizeIndex(Math.round(currentIndexRef.current), providers.length);
      if (currentBase !== targetIdx) {
        const diff = getShortestDistance(currentBase, targetIdx, providers.length);
        const nextVal = Math.round(currentIndexRef.current) + diff;
        currentIndexRef.current = nextVal;
        setCarouselIndex(nextVal);
      }
    }, [currentProviderId, providers]);

    useEffect(() => {
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
      if (providers.length === 0) return;
      setIsDragging(true);
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      dragStartXRef.current = clientX;
      dragStartValRef.current = currentIndexRef.current;
    };

    const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDragging || providers.length === 0) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const deltaX = clientX - dragStartXRef.current;
      const nextVal =
        dragStartValRef.current + deltaX * (-1 / Math.max(72, providerWheelStride * 1.15));
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
      if (providers[normIdx]) {
        onSelectProvider(providers[normIdx].provider_id);
      }
    };

    const navigateCarousel = (direction: 'prev' | 'next') => {
      if (providers.length === 0) return;
      const newIndex = Math.round(currentIndexRef.current) + (direction === 'next' ? 1 : -1);
      currentIndexRef.current = newIndex;
      setCarouselIndex(newIndex);
      const normIdx = normalizeIndex(newIndex, providers.length);
      if (providers[normIdx]) {
        onSelectProvider(providers[normIdx].provider_id);
      }
    };

    const selectProvider = (p: WatchProvider) => {
      if (providers.length === 0) return;
      const targetBaseIndex = providers.findIndex((x) => x.provider_id === p.provider_id);
      if (targetBaseIndex === -1) return;
      const currentBaseIndex = normalizeIndex(
        Math.round(currentIndexRef.current),
        providers.length
      );
      const diff = getShortestDistance(currentBaseIndex, targetBaseIndex, providers.length);
      const targetIndex = Math.round(currentIndexRef.current) + diff;
      currentIndexRef.current = targetIndex;
      setCarouselIndex(targetIndex);
      onSelectProvider(p.provider_id);
    };

    return (
      <div
        style={{ height: 'clamp(145px, 24dvh, 196px)' }}
        className={`relative w-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-pan-y select-none perspective-[1000px] transition-opacity duration-300 ${
          dimmed ? 'opacity-20 pointer-events-none' : 'opacity-100'
        }`}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        {providers.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigateCarousel('prev');
              }}
              aria-label="Previous streaming service"
              className="focusable-rounded absolute left-3 md:left-16 z-40 p-2.5 bg-white/10 hover:bg-white/25 rounded-full backdrop-blur-md transition-colors"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigateCarousel('next');
              }}
              aria-label="Next streaming service"
              className="focusable-rounded absolute right-3 md:right-16 z-40 p-2.5 bg-white/10 hover:bg-white/25 rounded-full backdrop-blur-md transition-colors"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}

        <div className="relative w-full h-full flex items-center justify-center transform-style-3d">
          {providers.map((p, i) => {
            const len = providers.length;
            const current = carouselIndex;
            const k = Math.round((current - i) / len);
            const effectiveIndex = i + k * len;
            const dist = effectiveIndex - current;

            if (Math.abs(dist) > 3.2) return null;

            const isActive = Math.abs(dist) < 0.5;
            const isSubscribed = userProviderSet.has(p.provider_id);
            const scale = Math.max(0.58, 1.26 - Math.abs(dist) * 0.28);
            const opacity = Math.max(0, 1 - Math.abs(dist) * 0.26);
            const zIndex = 100 - Math.round(Math.abs(dist) * 10);
            const translateX = dist * providerWheelStride;

            return (
              <div
                key={`${p.provider_id}-${k}`}
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
                  className={`w-full h-full object-cover rounded-2xl shadow-lg ${
                    isActive ? 'shadow-[0_0_28px_rgba(255,255,255,0.28)]' : ''
                  }`}
                  draggable={false}
                />

                {isSubscribed && (
                  <div
                    title="In meinen Abos"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-accent text-white flex items-center justify-center shadow-lg border-2 border-black"
                  >
                    <Check size={11} strokeWidth={4} />
                  </div>
                )}

                {isActive && !isDragging && (
                  <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap flex flex-col items-center pointer-events-none">
                    <span className="font-bold text-white text-[clamp(0.8rem,2.3vw,1rem)] drop-shadow-md">
                      {p.provider_name}
                    </span>
                    {isSubscribed && (
                      <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-accent">
                        Mein Abo · {regionCode}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

export const SearchView: React.FC<SearchViewProps> = ({
  tmdb,
  navigate,
  onExpand,
  userProviders = [],
  watchlist = [],
  watchedCompositeKeys = new Set<string>(),
  userGenres = [],
}) => {
  const [providers, setProviders] = useState<WatchProvider[]>([]);
  const [currentProviderId, setCurrentProviderId] = useState<number | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<MediaItem & { matchPercent?: number }>>([]);
  const [matchedKeywords, setMatchedKeywords] = useState<Keyword[]>([]);
  const [activeKeyword, setActiveKeyword] = useState<Keyword | null>(null);
  const [keywordItems, setKeywordItems] = useState<MediaItem[]>([]);
  const [topHitSimilarItems, setTopHitSimilarItems] = useState<MediaItem[]>([]);
  const [topHitSeedTitle, setTopHitSeedTitle] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [activeCategory, setActiveCategory] = useState<'movies' | 'shows'>('movies');
  const [discoveryMode, setDiscoveryMode] = useState<'forYou' | 'catalogue'>('forYou');

  const [personalizedHub, setPersonalizedHub] = useState<PersonalizedSearchHubData>({
    forYouItems: [],
    becauseYouWatchedRows: [],
    acclaimedGems: [],
  });
  const [hubLoading, setHubLoading] = useState(false);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreSearch, setHasMoreSearch] = useState(true);

  const [loading, setLoading] = useState(false);
  const [isPaginationLoading, setIsPaginationLoading] = useState(false);

  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const observer = useRef<IntersectionObserver | null>(null);
  const { setContextualBackground } = useAmbientActions();

  const regionCode = tmdb.getRegion();
  const languageCode = tmdb.getLanguage();
  const isDe = languageCode.toLowerCase().startsWith('de');
  const userProviderSet = useMemo(() => new Set(userProviders), [userProviders]);

  const recEngine = useMemo(
    () =>
      new RecommendationEngine(
        tmdb,
        watchlist,
        watchedCompositeKeys,
        userGenres,
        userProviders.length > 0 ? userProviders : undefined
      ),
    [tmdb, watchlist, watchedCompositeKeys, userGenres, userProviders]
  );

  // 1. Load Personalized Search & Recommendation Hub ("Für dich empfohlen", "Weil du X gesehen hast")
  useEffect(() => {
    let mounted = true;
    setHubLoading(true);
    recEngine
      .getPersonalizedSearchHub(activeCategory)
      .then((hubData) => {
        if (!mounted) return;
        setPersonalizedHub(hubData);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setHubLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [recEngine, activeCategory, regionCode, languageCode]);

  // 2. Load regional providers & genres
  useEffect(() => {
    let mounted = true;
    const mediaEndpoint = activeCategory === 'movies' ? 'movie' : 'tv';

    const init = async () => {
      try {
        const [pList, gList] = await Promise.all([
          tmdb.getWatchProviderList(mediaEndpoint),
          tmdb.getGenres(mediaEndpoint),
        ]);
        if (!mounted) return;

        const userSet = new Set(userProviders);
        const sortedProviders = [...pList].sort((a, b) => {
          const aIsSub = userSet.has(a.provider_id) ? 0 : 1;
          const bIsSub = userSet.has(b.provider_id) ? 0 : 1;
          if (aIsSub !== bIsSub) return aIsSub - bIsSub;
          return a.display_priority - b.display_priority;
        });

        setProviders(sortedProviders);
        setGenres(gList);

        if (sortedProviders.length > 0) {
          setCurrentProviderId((prev) => {
            if (prev && sortedProviders.some((p) => p.provider_id === prev)) {
              return prev;
            }
            return sortedProviders[0].provider_id;
          });
        } else {
          setCurrentProviderId(null);
        }
      } catch (e) {
        console.error(e);
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [tmdb, regionCode, languageCode, userProviders.join(','), activeCategory]);

  // 3. Reset page when provider, genre, category, or region changes
  useEffect(() => {
    tmdb.cancelScope(DISCOVER_SCOPE);
    setPage(1);
    setItems([]);
    setHasMore(true);
  }, [currentProviderId, selectedGenre, activeCategory, regionCode, languageCode, tmdb]);

  // 4. Regional Discover Fetch
  useEffect(() => {
    if (!currentProviderId || searchQuery.trim()) return;

    let mounted = true;
    const isFirstPage = page === 1;
    if (isFirstPage) setLoading(true);
    else setIsPaginationLoading(true);

    const timer = setTimeout(
      async () => {
        try {
          const mediaEndpoint = activeCategory === 'movies' ? 'movie' : 'tv';
          const params: Record<string, string> = {
            with_watch_providers: currentProviderId.toString(),
            watch_region: regionCode,
            with_watch_monetization_types: 'flatrate',
            sort_by: 'popularity.desc',
          };
          if (selectedGenre) {
            params.with_genres = selectedGenre.toString();
          }

          const res = await tmdb.discover(mediaEndpoint, params, page, {
            scope: DISCOVER_SCOPE,
          });

          if (!mounted) return;
          setItems((prev) => {
            if (isFirstPage) return res.results || [];
            const seen = new Set(prev.map((x) => x.id));
            const nextBatch = (res.results || []).filter((x) => !seen.has(x.id));
            return [...prev, ...nextBatch];
          });
          setHasMore(res.page < res.total_pages);
        } catch (e: any) {
          if (e?.name !== 'AbortError') {
            console.error('SearchView discover error:', e);
          }
        } finally {
          if (mounted) {
            setLoading(false);
            setIsPaginationLoading(false);
          }
        }
      },
      isFirstPage ? 100 : 0
    );

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [currentProviderId, selectedGenre, activeCategory, page, searchQuery, regionCode, languageCode, tmdb]);

  // 5. Live Multi-Search + Keyword Search + Taste-Weighted Ranking + "Similar to Top Hit"
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      tmdb.cancelScope(MULTI_SEARCH_SCOPE);
      setSearchResults([]);
      setMatchedKeywords([]);
      setActiveKeyword(null);
      setKeywordItems([]);
      setTopHitSimilarItems([]);
      setTopHitSeedTitle('');
      setSearchPage(1);
      return;
    }

    let mounted = true;
    const isFirstPage = searchPage === 1;
    if (isFirstPage) setLoading(true);
    else setIsPaginationLoading(true);

    const timer = setTimeout(
      async () => {
        try {
          const [multiRes, kwRes] = await Promise.all([
            tmdb.multiSearch(trimmed, searchPage, { scope: MULTI_SEARCH_SCOPE }),
            isFirstPage
              ? tmdb.searchKeywords(trimmed, 1, { scope: MULTI_SEARCH_SCOPE }).catch(() => ({
                  results: [] as Keyword[],
                }))
              : Promise.resolve({ results: [] as Keyword[] }),
          ]);

          if (!mounted) return;

          if (isFirstPage) {
            setMatchedKeywords((kwRes.results || []).slice(0, 8));
            setActiveKeyword(null);
            setKeywordItems([]);
          }

          const filtered = (multiRes.results || []).filter(
            (i) => i.media_type !== 'person' || i.profile_path
          );
          const ranked = recEngine.rankSearchResultsByTaste(filtered, trimmed);

          setSearchResults((prev) => {
            if (isFirstPage) return ranked;
            const seen = new Set(prev.map((x) => `${x.media_type}:${x.id}`));
            return [
              ...prev,
              ...ranked.filter((x) => !seen.has(`${x.media_type}:${x.id}`)),
            ];
          });
          setHasMoreSearch(multiRes.page < multiRes.total_pages);

          // Automatically fetch "Because you searched for [Top Hit]" recommendations for #1 movie/tv match
          if (isFirstPage) {
            const topMedia = ranked.find(
              (r) => (r.media_type === 'movie' || r.media_type === 'tv') && r.id > 0
            );
            if (topMedia) {
              const mType = resolveMediaType(topMedia) === 'tv' ? 'tv' : 'movie';
              setTopHitSeedTitle(topMedia.title || topMedia.name || '');
              tmdb
                .getRecommendations(topMedia.id, mType, 1)
                .then((recData) => {
                  if (!mounted) return;
                  setTopHitSimilarItems(
                    (recData.results || [])
                      .filter((x) => x.poster_path || x.backdrop_path)
                      .slice(0, 12)
                  );
                })
                .catch(() => {});
            } else {
              setTopHitSimilarItems([]);
              setTopHitSeedTitle('');
            }
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError') console.error(e);
        } finally {
          if (mounted) {
            setLoading(false);
            setIsPaginationLoading(false);
          }
        }
      },
      isFirstPage ? 180 : 0
    );

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery, searchPage, tmdb, recEngine]);

  const handleSelectKeywordChip = async (kw: Keyword) => {
    if (activeKeyword?.id === kw.id) {
      setActiveKeyword(null);
      setKeywordItems([]);
      return;
    }
    setActiveKeyword(kw);
    setLoading(true);
    try {
      const targetType = activeCategory === 'shows' ? 'tv' : 'movie';
      const res = await tmdb.discoverByKeyword(kw.id, targetType, 1);
      setKeywordItems(res.results || []);
    } catch {
      setKeywordItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (cat: 'movies' | 'shows') => {
    if (cat === activeCategory) return;
    setSelectedGenre(null);
    setActiveCategory(cat);
  };

  const handleSelectProvider = useCallback((providerId: number) => {
    setSearchQuery('');
    setCurrentProviderId(providerId);
  }, []);

  const toggleSearch = () => {
    setIsSearchExpanded((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 60);
      } else {
        setSearchQuery('');
      }
      return next;
    });
  };

  // Handle Smart TV / VIDAA Back button for dropdowns & active search bar
  useEffect(() => {
    const onTvBack = (e: Event) => {
      if (isDropdownOpen) {
        e.preventDefault();
        setIsDropdownOpen(false);
        return;
      }
      if (activeKeyword) {
        e.preventDefault();
        setActiveKeyword(null);
        setKeywordItems([]);
        return;
      }
      if (searchQuery || isSearchExpanded) {
        e.preventDefault();
        setSearchQuery('');
        setIsSearchExpanded(false);
      }
    };
    window.addEventListener('mj:tv-back', onTvBack);
    return () => window.removeEventListener('mj:tv-back', onTvBack);
  }, [isDropdownOpen, activeKeyword, searchQuery, isSearchExpanded]);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading || isPaginationLoading || activeKeyword) return;
      const canLoadMore = searchQuery.trim() ? hasMoreSearch : hasMore;
      if (!canLoadMore) return;

      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            if (searchQuery.trim()) setSearchPage((p) => p + 1);
            else setPage((p) => p + 1);
          }
        },
        { rootMargin: '800px' }
      );

      if (node) observer.current.observe(node);
    },
    [loading, isPaginationLoading, searchQuery, hasMoreSearch, hasMore, activeKeyword]
  );

  const selectedGenreName =
    genres.find((g) => g.id === selectedGenre)?.name ||
    (isDe ? 'Alle Genres' : 'All Genres');
  const currentProvider = providers.find((p) => p.provider_id === currentProviderId);

  useEffect(() => {
    if (searchQuery.trim()) setContextualBackground(null);
    else if (currentProvider) setContextualBackground(currentProvider.logo_path);
  }, [searchQuery, currentProvider, setContextualBackground]);

  useEffect(() => {
    return () => {
      setContextualBackground(null);
    };
  }, [setContextualBackground]);

  const handleGridItemClick = (item: MediaItem, rect?: any) => {
    const resolvedType = resolveMediaType(
      item,
      activeCategory === 'movies' ? 'movie' : 'tv'
    );
    const enriched = { ...item, media_type: resolvedType };
    if (rect && resolvedType !== 'person') {
      onExpand(enriched, rect);
    } else {
      navigate(
        resolvedType === 'person' ? AppView.PERSON : AppView.DETAILS,
        { id: item.id, type: resolvedType, seedItem: enriched }
      );
    }
  };

  // Separate found People (Cast/Crew) from Movies/TV Shows in live search results
  const personSearchResults = useMemo(
    () => searchResults.filter((r) => r.media_type === 'person' && r.profile_path),
    [searchResults]
  );
  const mediaSearchResults = useMemo(
    () => searchResults.filter((r) => r.media_type !== 'person'),
    [searchResults]
  );

  return (
    <div className="min-h-screen bg-transparent animate-fade-in relative overflow-x-hidden">
      <div
        style={{
          paddingTop: 'max(2.75rem, calc(env(safe-area-inset-top, 0px) + 1.5rem))',
        }}
        className="relative pb-4 z-20 flex flex-col items-center"
      >
        {/* --- ISOLATED 60FPS 3D PROVIDER CAROUSEL --- */}
        <ProviderWheel3D
          providers={providers}
          currentProviderId={currentProviderId}
          userProviderSet={userProviderSet}
          regionCode={regionCode}
          dimmed={Boolean(searchQuery.trim())}
          tmdb={tmdb}
          onSelectProvider={handleSelectProvider}
        />

        {/* --- FLUID RESPONSIVE CONTROL BAR --- */}
        <div className="w-full max-w-[94vw] sm:max-w-fit flex flex-col sm:flex-row items-center justify-center gap-2.5 mt-9 sm:mt-10 relative z-50 px-2">
          <div className="w-full sm:w-auto bg-black border border-white/10 rounded-full p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.95)] flex items-center justify-between sm:justify-center gap-1 sm:gap-1.5">
            {/* Sliding Toggle for Movies / TV Shows */}
            <div className="relative grid grid-cols-2 bg-black rounded-full p-0.5 min-w-[clamp(146px,42vw,210px)] select-none">
              <div
                aria-hidden="true"
                className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-white shadow-[0_2px_12px_rgba(255,255,255,0.25)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  activeCategory === 'shows' ? 'translate-x-full' : 'translate-x-0'
                } ${searchQuery.trim() ? 'opacity-25' : 'opacity-100'}`}
              />
              <button
                type="button"
                onClick={() => handleCategoryChange('movies')}
                className={`relative z-10 px-3 sm:px-5 py-1.5 sm:py-2 rounded-full text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold transition-colors duration-300 whitespace-nowrap text-center ${
                  activeCategory === 'movies' && !searchQuery.trim()
                    ? 'text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {isDe ? 'Filme' : 'Movies'}
              </button>
              <button
                type="button"
                onClick={() => handleCategoryChange('shows')}
                className={`relative z-10 px-3 sm:px-5 py-1.5 sm:py-2 rounded-full text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold transition-colors duration-300 whitespace-nowrap text-center ${
                  activeCategory === 'shows' && !searchQuery.trim()
                    ? 'text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {isDe ? 'Serien' : 'TV Shows'}
              </button>
            </div>

            <div className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />

            {/* Search Toggle Button */}
            <button
              type="button"
              onClick={toggleSearch}
              aria-label="Toggle search"
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                isSearchExpanded || searchQuery
                  ? 'bg-white text-black'
                  : 'text-zinc-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Search size={17} />
            </button>

            <div className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />

            {/* Genre Dropdown Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full hover:bg-white/10 font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] text-zinc-200 hover:text-white transition-all whitespace-nowrap"
              >
                <span className="truncate max-w-[clamp(76px,22vw,130px)]">
                  {selectedGenreName}
                </span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 shrink-0 ${
                    isDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isDropdownOpen && (
                <div className="absolute top-full right-0 mt-3 w-56 bg-black border border-white/10 rounded-3xl shadow-2xl overflow-hidden z-[70] animate-fade-in max-h-[55dvh] overflow-y-auto no-scrollbar ios-touch-rail">
                  <div className="py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGenre(null);
                        setIsDropdownOpen(false);
                      }}
                      className="w-full text-left px-5 py-2.5 text-sm hover:bg-white/10 text-white font-bold border-b border-white/5"
                    >
                      {isDe ? 'Alle Genres' : 'All Genres'}
                    </button>
                    {genres.map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        onClick={() => {
                          setSelectedGenre(g.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm hover:bg-white/10 font-medium ${
                          selectedGenre === g.id ? 'text-accent font-bold' : 'text-zinc-300'
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

          {/* Dedicated Fluid Search Input Bar + Smart TV D-Pad Quick Keyboard when Expanded */}
          {(isSearchExpanded || searchQuery) && (
            <div className="w-[min(94vw,680px)] flex flex-col items-center gap-2.5 animate-fade-in">
              <div className="w-full flex items-center bg-zinc-950/95 border border-white/15 rounded-full px-4 py-2.5 shadow-2xl">
                <Search size={16} className="text-zinc-400 mr-2.5 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchPage(1);
                    setSearchQuery(e.target.value);
                  }}
                  placeholder={
                    isDe
                      ? 'Filme, Serien, Schauspieler oder Themen suchen...'
                      : 'Search movies, shows, actors, or themes...'
                  }
                  className="bg-transparent border-none outline-none text-white font-medium text-[clamp(0.8125rem,2.2vw,0.95rem)] w-full placeholder-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setIsSearchExpanded(false);
                  }}
                  aria-label="Clear search"
                  className="ml-2 p-1 text-zinc-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              {/* D-Pad On-Screen Quick Keyboard Bar (for Smart TV & Remote Navigation without OS Keyboard Overlay) */}
              <div className="w-full bg-zinc-950/90 border border-white/10 rounded-2xl p-2 shadow-xl">
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => {
                        setSearchPage(1);
                        setSearchQuery((prev) => prev + ch.toLowerCase());
                      }}
                      className="min-w-[30px] h-8 px-1.5 rounded-lg bg-white/[0.06] hover:bg-white/20 text-xs font-bold text-zinc-200 hover:text-white transition-colors active:scale-95"
                    >
                      {ch}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchPage(1);
                      setSearchQuery((prev) => prev + ' ');
                    }}
                    className="h-8 px-3 rounded-lg bg-white/[0.08] hover:bg-white/20 text-[11px] font-bold text-zinc-200 hover:text-white transition-colors active:scale-95"
                  >
                    {isDe ? 'Leertaste' : 'Space'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchPage(1);
                      setSearchQuery((prev) => prev.slice(0, -1));
                    }}
                    className="h-8 px-2.5 rounded-lg bg-white/[0.08] hover:bg-white/20 text-xs font-bold text-zinc-200 hover:text-white transition-colors active:scale-95"
                  >
                    ⌫
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchPage(1);
                      setSearchQuery('');
                    }}
                    className="h-8 px-2.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-[11px] font-bold text-red-300 transition-colors active:scale-95"
                  >
                    {isDe ? 'Löschen' : 'Clear'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Discovery Hub Mode Selector (when not searching) */}
        {!searchQuery.trim() && !selectedGenre && (
          <div className="mt-4 flex items-center gap-1 p-1 rounded-full bg-white/[0.05] border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setDiscoveryMode('forYou')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                discoveryMode === 'forYou'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {isDe ? 'Für dich & Katalog' : 'For You & Catalogue'}
            </button>
            <button
              type="button"
              onClick={() => setDiscoveryMode('catalogue')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                discoveryMode === 'catalogue'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {currentProvider
                ? `${currentProvider.provider_name} (${regionCode})`
                : isDe
                ? 'Nur Anbieter-Raster'
                : 'Provider Grid Only'}
            </button>
          </div>
        )}
      </div>

      {/* Results & Personalized Discovery Stage */}
      <div className="pb-28 relative z-10 min-h-[50vh] mt-2">
        <div className="max-w-[2400px] mx-auto px-[var(--fluid-page-px)] space-y-10">
          {searchQuery.trim() ? (
            /* --- STATE B: LIVE MULTI-SEARCH (KEYWORDS + PEOPLE + TASTE-RANKED GRID + SIMILAR) --- */
            <div className="animate-fade-in space-y-8">
              {/* 1. Interactive Keyword / Theme Filter Strip */}
              {matchedKeywords.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-400">
                    {isDe ? 'Themen & Keywords' : 'Themes & Keywords'}
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    {matchedKeywords.map((kw) => {
                      const active = activeKeyword?.id === kw.id;
                      return (
                        <button
                          key={kw.id}
                          type="button"
                          onClick={() => handleSelectKeywordChip(kw)}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                            active
                              ? 'bg-white text-black border-white'
                              : 'bg-white/[0.06] text-zinc-300 border-white/10 hover:bg-white/15 hover:text-white'
                          }`}
                        >
                          {kw.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Dedicated Actors & Directors Horizontal Rail */}
              {!activeKeyword && personSearchResults.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-base sm:text-lg font-bold text-white">
                      {isDe ? 'Schauspieler & Regie' : 'Cast & Crew'}
                    </h3>
                    <span className="text-xs text-zinc-500 tabular-nums">
                      {personSearchResults.length}{' '}
                      {isDe ? 'Personen' : 'People'}
                    </span>
                  </div>
                  <div className="flex items-start gap-4 overflow-x-auto no-scrollbar ios-snap-row pb-2">
                    {personSearchResults.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() =>
                          navigate(AppView.PERSON, {
                            id: person.id,
                            type: 'person',
                            seedItem: person,
                          })
                        }
                        className="group flex flex-col items-center text-center w-24 sm:w-28 shrink-0 focus:outline-none"
                      >
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-zinc-900 border border-white/15 group-hover:border-white/50 transition-all shadow-lg">
                          <SafeImage
                            src={tmdb.getImageUrl(person.profile_path, 'w300')}
                            fallbackTitle={person.name || person.title || 'Star'}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <span className="mt-2 text-xs font-bold text-white group-hover:text-accent line-clamp-1">
                          {person.name || person.title}
                        </span>
                        <span className="text-[11px] text-zinc-500 line-clamp-1">
                          {person.known_for_department || (isDe ? 'Film & Serie' : 'Cinema')}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 3. Main Movies & Series Grid (or Keyword-Filtered Grid) */}
              <section className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[length:var(--fluid-h3)] font-bold text-zinc-300">
                    {activeKeyword ? (
                      <>
                        {isDe ? 'Thema:' : 'Theme:'}{' '}
                        <span className="text-white">{activeKeyword.name}</span>
                      </>
                    ) : (
                      <>
                        {isDe ? 'Ergebnisse für' : 'Results for'}{' '}
                        <span className="text-white">"{searchQuery}"</span>
                      </>
                    )}
                  </h2>
                  {activeKeyword && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveKeyword(null);
                        setKeywordItems([]);
                      }}
                      className="text-xs font-semibold text-zinc-400 hover:text-white"
                    >
                      {isDe ? 'Filter zurücksetzen' : 'Clear Filter'}
                    </button>
                  )}
                </div>

                {!loading &&
                (activeKeyword ? keywordItems.length === 0 : mediaSearchResults.length === 0) ? (
                  <div className="py-16 text-center text-zinc-500 text-[length:var(--fluid-body)]">
                    {isDe
                      ? 'Keine passenden Filme oder Serien gefunden.'
                      : 'No matching movies or series found.'}
                  </div>
                ) : (
                  <TetrisGrid
                    items={activeKeyword ? keywordItems : mediaSearchResults}
                    tmdb={tmdb}
                    onClick={handleGridItemClick}
                    loading={loading}
                  />
                )}
              </section>

              {/* 4. "Because you searched for [Top Hit]" Automatic Recommendation Row */}
              {!activeKeyword && topHitSimilarItems.length > 0 && (
                <section className="space-y-3 pt-4 border-t border-white/[0.08]">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-base sm:text-lg font-bold text-white">
                      {isDe
                        ? `Ähnliche Titel wie „${topHitSeedTitle}“`
                        : `Similar to "${topHitSeedTitle}"`}
                    </h3>
                    <span className="text-xs text-zinc-500">
                      {isDe ? 'Empfehlungs-Engine' : 'Recommended'}
                    </span>
                  </div>
                  <div className="flex items-start gap-3.5 overflow-x-auto no-scrollbar ios-snap-row pb-2">
                    {topHitSimilarItems.map((simItem) => (
                      <div
                        key={`${simItem.id}-${simItem.media_type}`}
                        className="w-[136px] sm:w-[164px] shrink-0"
                      >
                        <MovieCard
                          item={simItem}
                          tmdb={tmdb}
                          imageUrl={tmdb.getImageUrl(simItem.poster_path || simItem.backdrop_path, 'w500')}
                          onClick={handleGridItemClick}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            /* --- STATE A: ZERO-QUERY PERSONALIZED DISCOVERY HUB + PROVIDER CATALOGUE --- */
            <div className="space-y-10">
              {discoveryMode === 'forYou' && !selectedGenre && (
                <div className="space-y-9">
                  {/* Row 1: Top-Auswahl für dich (Personalized Taste Score) */}
                  {personalizedHub.forYouItems.length > 0 && (
                    <section className="space-y-3">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                            {isDe ? 'Top-Auswahl für dich' : 'Top Picks for You'}
                          </h2>
                        </div>
                      </div>

                      <div className="flex items-start gap-3.5 overflow-x-auto no-scrollbar ios-snap-row pb-2">
                        {personalizedHub.forYouItems.map((recItem) => {
                          const year = (
                            recItem.release_date ||
                            recItem.first_air_date ||
                            ''
                          ).slice(0, 4);
                          return (
                            <div
                              key={`foryou-${recItem.id}`}
                              className="w-[142px] sm:w-[172px] shrink-0 space-y-1.5"
                            >
                              <MovieCard
                                item={recItem}
                                tmdb={tmdb}
                                imageUrl={tmdb.getImageUrl(recItem.poster_path || recItem.backdrop_path, 'w500')}
                                onClick={handleGridItemClick}
                              />
                              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 px-0.5 tabular-nums">
                                {recItem.matchPercent && (
                                  <span className="font-semibold text-emerald-400">
                                    {recItem.matchPercent}% Match
                                  </span>
                                )}
                                {year && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{year}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* Row 2 & 3: "Weil du [Seed] gesehen / auf deiner Liste hast" */}
                  {personalizedHub.becauseYouWatchedRows.map((row) => (
                    <section key={`seed-${row.seedItem.id}`} className="space-y-3">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                          {isDe
                            ? `Weil dir „${row.seedTitle}“ gefällt`
                            : `Because You Liked "${row.seedTitle}"`}
                        </h2>
                      </div>

                      <div className="flex items-start gap-3.5 overflow-x-auto no-scrollbar ios-snap-row pb-2">
                        {row.items.map((seedRec) => {
                          const year = (
                            seedRec.release_date ||
                            seedRec.first_air_date ||
                            ''
                          ).slice(0, 4);
                          const matchPct = (seedRec as any).matchPercent;
                          return (
                            <div
                              key={`seedrec-${row.seedItem.id}-${seedRec.id}`}
                              className="w-[142px] sm:w-[172px] shrink-0 space-y-1.5"
                            >
                              <MovieCard
                                item={seedRec}
                                tmdb={tmdb}
                                imageUrl={tmdb.getImageUrl(seedRec.poster_path || seedRec.backdrop_path, 'w500')}
                                onClick={handleGridItemClick}
                              />
                              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 px-0.5 tabular-nums">
                                {matchPct && (
                                  <span className="font-semibold text-emerald-400">
                                    {matchPct}% Match
                                  </span>
                                )}
                                {year && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{year}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  {/* Row 4: Kritiker-Favoriten in deinen Abos */}
                  {personalizedHub.acclaimedGems.length > 0 && (
                    <section className="space-y-3">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                          {isDe
                            ? 'Kritiker-Meisterwerke für deinen Geschmack'
                            : 'Critically Acclaimed for Your Taste'}
                        </h2>
                      </div>

                      <div className="flex items-start gap-3.5 overflow-x-auto no-scrollbar ios-snap-row pb-2">
                        {personalizedHub.acclaimedGems.map((gem) => (
                          <div
                            key={`gem-${gem.id}`}
                            className="w-[142px] sm:w-[172px] shrink-0"
                          >
                            <MovieCard
                              item={gem}
                              tmdb={tmdb}
                              imageUrl={tmdb.getImageUrl(gem.poster_path || gem.backdrop_path, 'w500')}
                              onClick={handleGridItemClick}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {/* Regional Provider Catalogue Grid */}
              <section className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    {currentProvider
                      ? isDe
                        ? `${currentProvider.provider_name} Katalog (${regionCode})`
                        : `${currentProvider.provider_name} Catalogue (${regionCode})`
                      : isDe
                      ? 'Streaming-Katalog'
                      : 'Streaming Catalogue'}
                  </h2>
                  {selectedGenre && (
                    <span className="text-xs text-zinc-400">{selectedGenreName}</span>
                  )}
                </div>

                {!loading && !hubLoading && items.length === 0 ? (
                  <div className="py-16 text-center text-zinc-500 text-[length:var(--fluid-body)]">
                    {isDe
                      ? `Keine Titel für diesen Anbieter in deiner Region (${regionCode}) gefunden.`
                      : `No titles found for this provider in your region (${regionCode}).`}
                  </div>
                ) : (
                  <TetrisGrid
                    items={items}
                    tmdb={tmdb}
                    onClick={handleGridItemClick}
                    loading={loading}
                  />
                )}
              </section>
            </div>
          )}

          {(hasMore || hasMoreSearch) && <div ref={lastElementRef} className="h-12 w-full" />}
        </div>
      </div>

      {isDropdownOpen && (
        <div className="fixed inset-0 z-[60]" onClick={() => setIsDropdownOpen(false)} />
      )}
    </div>
  );
};