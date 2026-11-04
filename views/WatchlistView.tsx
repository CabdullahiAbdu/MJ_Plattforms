import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  MediaItem,
  AppView,
  TvShowDetails,
  Rect,
  ExpandHandler,
  resolveMediaType,
} from '../types';
import {
  Check,
  Play,
  Plus,
  Sparkles,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
} from '../components/Icons';
import { TmdbService } from '../services/tmdb';
import { useAmbientActions } from '../context/AmbientContext';
import { SafeImage } from '../components/SafeImage';
import { MediaCard } from '../components/MovieCard';

interface WatchlistViewProps {
  watchlist: MediaItem[];
  tmdb: TmdbService;
  navigate: (view: AppView, params?: any) => void;
  onExpand?: ExpandHandler;
  watchedEpisodes: Record<number, number[]>;
  watchedMovies: number[];
  manuallyWatchedShows: number[];
  onToggleMovieWatched: (id: number) => void;
  onToggleShowWatched: (id: number) => void;
  onToggleEpisode?: (showId: number, episodeId: number) => void;
}

type MediaFilter = 'all' | 'movie' | 'tv';

interface WatchlistRailProps {
  title: string;
  subtitle: string;
  items: MediaItem[];
  tmdb: TmdbService;
  onCardClick: (item: MediaItem, rect?: Rect) => void;
  isWatchedItem: (item: MediaItem) => boolean;
  onToggleWatchedItem: (e: React.MouseEvent, item: MediaItem) => void;
  getBottomBadge: (item: MediaItem) => { text?: string; color?: 'default' | 'blue' };
}

const WatchlistRail: React.FC<WatchlistRailProps> = ({
  title,
  subtitle,
  items,
  tmdb,
  onCardClick,
  isWatchedItem,
  onToggleWatchedItem,
  getBottomBadge,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { clientWidth } = rowRef.current;
      const scrollAmount = direction === 'left' ? -clientWidth / 1.5 : clientWidth / 1.5;
      rowRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative py-2.5 md:py-4 group/row">
      {/* Row Header matching HomeView */}
      <div className="relative z-10 px-[var(--fluid-page-px)] mb-2.5 md:mb-3.5 flex items-end justify-between">
        <div>
          <h2 className="text-[length:var(--fluid-h2)] font-bold text-white tracking-tight flex items-center gap-2">
            <span>{title}</span>
            <span className="text-xs font-semibold text-zinc-500 tabular-nums">
              {items.length}
            </span>
          </h2>
          <p className="text-zinc-400 font-normal text-[clamp(0.7rem,2vw,0.85rem)] mt-0.5">
            {subtitle}
          </p>
        </div>

        {/* Desktop Scroll Arrows */}
        {items.length > 3 && (
          <div className="hidden md:flex items-center gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity duration-200">
            <button
              type="button"
              onClick={() => scroll('left')}
              aria-label="Scroll left"
              className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-full bg-white/5 hover:bg-white/20 backdrop-blur-sm transition-all active:scale-95"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              aria-label="Scroll right"
              className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-full bg-white/5 hover:bg-white/20 backdrop-blur-sm transition-all active:scale-95"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Horizontal Cinema Rail (60fps iOS momentum scroll) */}
      <div
        ref={rowRef}
        className="relative z-10 flex overflow-x-auto overflow-y-hidden gap-[clamp(0.65rem,2.4vw,1.1rem)] px-[var(--fluid-page-px)] pb-4 pt-1 no-scrollbar ios-touch-rail items-stretch"
      >
        {items.map((item, idx) => {
          const badge = getBottomBadge(item);
          return (
            <div key={`${resolveMediaType(item)}-${item.id}-${idx}`} className="flex-shrink-0">
              <MediaCard
                item={item}
                imageUrl={tmdb.getImageUrl(
                  item.poster_path || item.backdrop_path,
                  'w500'
                )}
                onClick={onCardClick}
                variant="poster"
                index={idx}
                tmdb={tmdb}
                isWatched={isWatchedItem(item)}
                onToggleWatched={(e) => onToggleWatchedItem(e, item)}
                bottomInfo={badge.text}
                bottomInfoColor={badge.color}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  watchlist,
  tmdb,
  navigate,
  onExpand,
  watchedEpisodes,
  watchedMovies,
  manuallyWatchedShows,
  onToggleMovieWatched,
  onToggleShowWatched,
}) => {
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [tvDetailsCache, setTvDetailsCache] = useState<Record<number, TvShowDetails>>({});
  const { setContextualBackground } = useAmbientActions();

  const isDe = tmdb.getLanguage().toLowerCase().startsWith('de');

  // Hydrate TV show episode counts for accurate progress bars and badges
  useEffect(() => {
    let cancelled = false;
    const tvItems = watchlist.filter((item) => resolveMediaType(item) === 'tv');
    const missingIds = tvItems.map((i) => i.id).filter((id) => !tvDetailsCache[id]);

    if (missingIds.length === 0) return;

    Promise.all(
      missingIds.slice(0, 20).map((id) =>
        tmdb
          .getTvDetails(id)
          .then((detail) => ({ id, detail }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const nextMap: Record<number, TvShowDetails> = {};
      results.forEach((res) => {
        if (res && res.detail) {
          nextMap[res.id] = res.detail;
        }
      });
      if (Object.keys(nextMap).length > 0) {
        setTvDetailsCache((prev) => ({ ...prev, ...nextMap }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [watchlist, tmdb]);

  const isItemCompleted = (item: MediaItem): boolean => {
    const mType = resolveMediaType(item);
    if (mType === 'movie') {
      return watchedMovies.includes(item.id);
    }
    if (manuallyWatchedShows.includes(item.id)) return true;
    const detail = tvDetailsCache[item.id];
    const totalEps = detail?.number_of_episodes || 0;
    const watchedCount = (watchedEpisodes[item.id] || []).length;
    return totalEps > 0 && watchedCount >= totalEps;
  };

  const isItemInProgress = (item: MediaItem): boolean => {
    if (isItemCompleted(item)) return false;
    const mType = resolveMediaType(item);
    if (mType === 'tv') {
      const watchedCount = (watchedEpisodes[item.id] || []).length;
      return watchedCount > 0;
    }
    return false;
  };

  const isUpcomingRelease = (item: MediaItem): boolean => {
    const rawDate = item.release_date || item.first_air_date;
    if (!rawDate) return false;
    const releaseTime = new Date(rawDate).getTime();
    if (Number.isNaN(releaseTime)) return false;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return releaseTime > todayStart.getTime();
  };

  // Organize into horizontal cinema rows split by status:
  // 1. Weiter schauen & Aktive Watchlist (Up Next / Active Watchlist)
  // 2. Demnächst (Upcoming releases)
  // 3. Bereits gesehen (Watched archive)
  const sections = useMemo(() => {
    const continueAndActive: MediaItem[] = [];
    const upcoming: MediaItem[] = [];
    const watched: MediaItem[] = [];

    const q = searchQuery.trim().toLowerCase();

    for (const item of watchlist) {
      const mType = resolveMediaType(item);
      if (mediaFilter !== 'all' && mType !== mediaFilter) continue;

      if (q) {
        const title = (item.title || item.name || '').toLowerCase();
        if (!title.includes(q)) continue;
      }

      if (isItemCompleted(item)) {
        watched.push(item);
      } else if (isUpcomingRelease(item)) {
        upcoming.push(item);
      } else {
        continueAndActive.push(item);
      }
    }

    // Sort continueAndActive so series with active episode progress appear first
    continueAndActive.sort((a, b) => {
      const aProg = isItemInProgress(a) ? 1 : 0;
      const bProg = isItemInProgress(b) ? 1 : 0;
      return bProg - aProg;
    });

    upcoming.sort((a, b) => {
      const dA = new Date(a.release_date || a.first_air_date || '2099-01-01').getTime();
      const dB = new Date(b.release_date || b.first_air_date || '2099-01-01').getTime();
      return dA - dB;
    });

    return {
      active: continueAndActive,
      upcoming,
      watched,
    };
  }, [
    watchlist,
    mediaFilter,
    searchQuery,
    watchedMovies,
    manuallyWatchedShows,
    watchedEpisodes,
    tvDetailsCache,
  ]);

  const heroItem =
    sections.active[0] || sections.upcoming[0] || sections.watched[0] || null;

  useEffect(() => {
    if (heroItem?.backdrop_path) {
      setContextualBackground(heroItem.backdrop_path);
    }
  }, [heroItem?.id]);

  const handleOpenItem = (item: MediaItem, rect?: Rect) => {
    const normalized = { ...item, media_type: resolveMediaType(item) };
    if (rect && onExpand) {
      onExpand(normalized, rect);
    } else {
      navigate(AppView.DETAILS, {
        id: item.id,
        type: resolveMediaType(item),
        seedItem: normalized,
      });
    }
  };

  const handleToggleWatched = (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    const mType = resolveMediaType(item);
    if (mType === 'tv') {
      onToggleShowWatched(item.id);
    } else {
      onToggleMovieWatched(item.id);
    }
  };

  const getBottomBadge = (
    item: MediaItem
  ): { text?: string; color?: 'default' | 'blue' } => {
    const mType = resolveMediaType(item);

    if (isUpcomingRelease(item)) {
      const rawDate = item.release_date || item.first_air_date;
      if (rawDate) {
        const d = new Date(rawDate);
        if (!Number.isNaN(d.getTime())) {
          const formatted = d.toLocaleDateString(isDe ? 'de-DE' : 'en-US', {
            day: '2-digit',
            month: 'short',
          });
          return { text: isDe ? `Ab ${formatted}` : formatted, color: 'blue' };
        }
      }
    }

    if (mType === 'tv') {
      const watchedCount = (watchedEpisodes[item.id] || []).length;
      const totalEps = tvDetailsCache[item.id]?.number_of_episodes || 0;
      if (watchedCount > 0 && totalEps > 0) {
        const pct = Math.min(100, Math.round((watchedCount / totalEps) * 100));
        return {
          text: `${watchedCount}/${totalEps} EP · ${pct}%`,
          color: 'blue',
        };
      }
      if (watchedCount > 0) {
        return { text: `${watchedCount} EP`, color: 'blue' };
      }
    }

    return {};
  };

  // Hero progress metadata if hero is a TV series
  const heroProgress = useMemo(() => {
    if (!heroItem || resolveMediaType(heroItem) !== 'tv') return null;
    const epList = watchedEpisodes[heroItem.id] || [];
    const detail = tvDetailsCache[heroItem.id];
    const totalEps = detail?.number_of_episodes || 0;
    if (epList.length === 0 && totalEps === 0) return null;
    const pct = totalEps > 0 ? Math.min(100, Math.round((epList.length / totalEps) * 100)) : 0;
    return {
      watched: epList.length,
      total: totalEps,
      pct,
    };
  }, [heroItem, watchedEpisodes, tvDetailsCache]);

  const totalVisibleCount =
    sections.active.length + sections.upcoming.length + sections.watched.length;

  return (
    <div
      style={{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
      }}
      className="min-h-screen bg-transparent sm:pt-10 pb-36 max-w-[1700px] mx-auto animate-fade-in"
    >
      {/* Header Bar with Apple-TV Segmented Filter & Search */}
      <div className="px-[var(--fluid-page-px)] flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-5 sm:mb-7">
        <div>
          <span className="text-[clamp(0.65rem,1.8vw,0.72rem)] font-bold uppercase tracking-[0.2em] text-accent block mb-1">
            {isDe ? 'Persönliches Programm' : 'Personal Cinema'}
          </span>
          <h1 className="text-[length:var(--fluid-h1)] font-black tracking-tight text-white font-display leading-tight">
            {isDe ? 'Watchlist' : 'Watchlist'}
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Expandable Search Filter */}
          {isSearchOpen ? (
            <div className="relative flex-1 sm:w-56">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isDe ? 'Titel filtern...' : 'Filter titles...'}
                autoFocus
                className="w-full pl-8 pr-8 py-2 rounded-xl bg-zinc-900/90 border border-white/15 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchOpen(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              aria-label={isDe ? 'Watchlist durchsuchen' : 'Search Watchlist'}
              className="w-9 h-9 rounded-full bg-zinc-950/90 border border-white/15 text-zinc-300 hover:text-white flex items-center justify-center shrink-0 transition-colors"
            >
              <Search size={15} />
            </button>
          )}

          {/* True Sliding Capsule Toggle (Alle | Filme | Serien) */}
          <div className="bg-zinc-950/90 border border-white/15 rounded-full p-1 backdrop-blur-xl shadow-inner">
            <div className="relative grid grid-cols-3 items-center min-w-[clamp(192px,48vw,240px)] select-none">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 left-0 w-1/3 rounded-full bg-white shadow-[0_2px_12px_rgba(255,255,255,0.28)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  transform: `translate3d(${
                    (['all', 'movie', 'tv'] as const).indexOf(mediaFilter) * 100
                  }%, 0, 0)`,
                }}
              />
              {(
                [
                  { id: 'all', labelDe: 'Alle', labelEn: 'All' },
                  { id: 'movie', labelDe: 'Filme', labelEn: 'Movies' },
                  { id: 'tv', labelDe: 'Serien', labelEn: 'Series' },
                ] as const
              ).map((f) => {
                const active = mediaFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMediaFilter(f.id)}
                    className={`relative z-10 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors duration-300 text-center whitespace-nowrap ${
                      active ? 'text-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isDe ? f.labelDe : f.labelEn}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {totalVisibleCount === 0 ? (
        <div className="px-[var(--fluid-page-px)]">
          <div className="rounded-3xl bg-zinc-900/50 border border-white/10 p-10 sm:p-14 text-center max-w-lg mx-auto my-8 space-y-3.5">
            <div className="w-12 h-12 rounded-2xl bg-white/10 text-zinc-300 flex items-center justify-center mx-auto">
              <Plus size={24} />
            </div>
            <h3 className="text-[length:var(--fluid-h2)] font-bold text-white">
              {searchQuery
                ? isDe
                  ? 'Keine Treffer in deiner Watchlist'
                  : 'No matches in your Watchlist'
                : isDe
                ? 'Deine Watchlist ist noch leer'
                : 'Your Watchlist is empty'}
            </h3>
            <p className="text-[length:var(--fluid-body)] text-zinc-400 leading-relaxed">
              {isDe
                ? 'Füge Filme und Serien über das Plus-Symbol hinzu. Sie erscheinen hier automatisch geordnet nach „Weiter schauen“, „Demnächst“ und „Gesehen“.'
                : 'Add movies and series via the Plus icon. They will automatically appear organized by Up Next, Upcoming, and Watched.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {/* 1. CINEMA UP-NEXT HERO SPOTLIGHT CARD (Matches HomeView Spotlight 1:1) */}
          {heroItem && (
            <div className="px-[var(--fluid-page-px)] mb-2">
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  handleOpenItem(heroItem, {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                  });
                }}
                style={{
                  height: 'clamp(250px, 40dvh, 430px)',
                  borderRadius: 'clamp(1.25rem, 3.2vw, 2rem)',
                }}
                className="group relative w-full overflow-hidden bg-zinc-900 border border-white/10 cursor-pointer shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] active:scale-[0.99] transition-transform"
              >
                <SafeImage
                  src={tmdb.getImageUrl(
                    heroItem.backdrop_path || heroItem.poster_path,
                    'w1280'
                  )}
                  fallbackTitle={heroItem.title || heroItem.name}
                  className="absolute inset-0 w-full h-full object-cover object-top"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" />

                <div
                  style={{ padding: 'clamp(1.1rem, 4vw, 2.75rem)' }}
                  className="absolute bottom-0 left-0 right-0 flex flex-col sm:flex-row sm:items-end justify-between gap-4"
                >
                  <div className="space-y-2 max-w-2xl">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md text-[clamp(0.625rem,1.8vw,0.72rem)] font-bold uppercase tracking-wider text-white">
                      <Sparkles size={11} className="text-accent" />
                      <span>
                        {isItemInProgress(heroItem)
                          ? isDe
                            ? 'Weiter schauen'
                            : 'Continue Watching'
                          : isUpcomingRelease(heroItem)
                          ? isDe
                            ? 'Demnächst vormerken'
                            : 'Upcoming Release'
                          : isDe
                          ? 'Als Nächstes schauen'
                          : 'Up Next'}
                      </span>
                    </div>

                    <h2
                      style={{
                        fontSize: 'clamp(1.4rem, 4.6vw, 2.75rem)',
                        textWrap: 'balance',
                      }}
                      className="font-black text-white leading-[1.06] font-display line-clamp-2 drop-shadow-2xl"
                    >
                      {heroItem.title || heroItem.name}
                    </h2>

                    {heroProgress && (
                      <div className="max-w-xs space-y-1 pt-0.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 tabular-nums">
                          <span>
                            {heroProgress.total > 0
                              ? `${heroProgress.watched} / ${heroProgress.total} ${
                                  isDe ? 'Folgen gesehen' : 'Episodes watched'
                                }`
                              : `${heroProgress.watched} ${
                                  isDe ? 'Folgen gesehen' : 'Episodes watched'
                                }`}
                          </span>
                          {heroProgress.total > 0 && (
                            <span className="text-accent">{heroProgress.pct}%</span>
                          )}
                        </div>
                        {heroProgress.total > 0 && (
                          <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                            <div
                              className="h-full bg-accent rounded-full transition-all duration-300"
                              style={{ width: `${heroProgress.pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {!heroProgress && heroItem.overview && (
                      <p className="text-[clamp(0.75rem,2vw,0.9rem)] text-zinc-300 line-clamp-2 max-w-xl">
                        {heroItem.overview}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect =
                          e.currentTarget.parentElement?.parentElement?.parentElement?.getBoundingClientRect();
                        handleOpenItem(
                          heroItem,
                          rect
                            ? {
                                top: rect.top,
                                left: rect.left,
                                width: rect.width,
                                height: rect.height,
                              }
                            : undefined
                        );
                      }}
                      className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-white text-black font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] hover:bg-zinc-200 transition-transform active:scale-95 shadow-lg"
                    >
                      <Play size={14} fill="currentColor" />
                      <span>{isDe ? 'Details & Stream' : 'Details & Stream'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleToggleWatched(e, heroItem)}
                      className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-white/15 hover:bg-emerald-500 hover:text-black text-white font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] backdrop-blur-md border border-white/15 transition-all active:scale-95"
                      title={isDe ? 'Als gesehen markieren' : 'Mark as watched'}
                    >
                      <Check size={15} strokeWidth={3} />
                      <span className="hidden sm:inline">
                        {isDe ? 'Gesehen' : 'Watched'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. HORIZONTAL CINEMA RAILS SPLIT BY WATCHLIST / UPCOMING / WATCHED */}
          <WatchlistRail
            title={isDe ? 'Meine Watchlist' : 'Up Next on Watchlist'}
            subtitle={
              isDe
                ? 'Aktuelle Serien & vorgemerkte Filme zum Anschauen'
                : 'Active series and saved movies ready to watch'
            }
            items={sections.active}
            tmdb={tmdb}
            onCardClick={handleOpenItem}
            isWatchedItem={isItemCompleted}
            onToggleWatchedItem={handleToggleWatched}
            getBottomBadge={getBottomBadge}
          />

          <WatchlistRail
            title={isDe ? 'Demnächst' : 'Upcoming Releases'}
            subtitle={
              isDe
                ? 'Vorgemerkte Kinostarts und kommende Staffeln'
                : 'Saved upcoming theatrical and streaming releases'
            }
            items={sections.upcoming}
            tmdb={tmdb}
            onCardClick={handleOpenItem}
            isWatchedItem={isItemCompleted}
            onToggleWatchedItem={handleToggleWatched}
            getBottomBadge={getBottomBadge}
          />

          <WatchlistRail
            title={isDe ? 'Bereits gesehen' : 'Watched Archive'}
            subtitle={
              isDe
                ? 'Abgeschlossene Filme und komplett gesehene Serien'
                : 'Completed movies and finished series'
            }
            items={sections.watched}
            tmdb={tmdb}
            onCardClick={handleOpenItem}
            isWatchedItem={isItemCompleted}
            onToggleWatchedItem={handleToggleWatched}
            getBottomBadge={getBottomBadge}
          />
        </div>
      )}
    </div>
  );
};