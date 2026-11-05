import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Calendar as CalIcon, Star, Tv, Film, ChevronLeft, ChevronRight } from '../components/Icons';
import { MediaItem, AppView, Rect, resolveMediaType, toMediaKey } from '../types';
import { TmdbService } from '../services/tmdb';
import { useAmbientActions } from '../context/AmbientContext';
import { useResponsive } from '../hooks/useResponsive';
import { SafeImage } from '../components/SafeImage';

interface CalendarViewProps {
  tmdb: TmdbService;
  watchlist: MediaItem[];
  navigate: (view: AppView, params?: any) => void;
  onExpand: (item: MediaItem, rect: Rect) => void;
}

interface ReleaseCardProps {
  item: MediaItem;
  isHero: boolean;
  tmdb: TmdbService;
  onExpand: (item: MediaItem, rect: Rect) => void;
}

const ReleaseCard: React.FC<ReleaseCardProps> = ({ item, isHero, tmdb, onExpand }) => {
  const numVote = Number(item?.vote_average || 0);
  const rating = Number.isFinite(numVote) && numVote > 0 ? numVote.toFixed(1) : null;
  const year = String(item?.release_date || item?.first_air_date || '').split('-')[0];
  const mType = resolveMediaType(item);
  const typeLabel = mType === 'tv' ? 'Series' : 'Movie';

  if (isHero) {
    return (
      <div
        style={{
          height: 'clamp(220px, 38dvh, 420px)',
          borderRadius: 'clamp(1.1rem, 3vw, 1.75rem)',
        }}
        className="group relative w-full overflow-hidden shadow-2xl cursor-pointer bg-zinc-900 active:scale-[0.99] transition-transform"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onExpand(
            { ...item, media_type: mType },
            { top: r.top, left: r.left, width: r.width, height: r.height }
          );
        }}
      >
        <SafeImage
          src={tmdb.getImageUrl(item.backdrop_path || item.poster_path, 'w1280')}
          alt={item.title || item.name}
          fallbackLabel={item.title || item.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

        <div
          style={{ padding: 'clamp(1rem, 4vw, 2.75rem)' }}
          className="absolute bottom-0 left-0 w-full"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <span className="bg-white text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">
              {typeLabel}
            </span>
            {rating && (
              <span className="flex items-center gap-1 text-yellow-400 text-xs font-bold tabular-nums font-mono">
                <Star size={10} fill="currentColor" /> {rating}
              </span>
            )}
          </div>
          <h3
            style={{ fontSize: 'clamp(1.4rem, 4.6vw, 3rem)' }}
            className="font-black text-white leading-[1.06] mb-1.5 drop-shadow-xl line-clamp-2 max-w-4xl font-display"
          >
            {item.title || item.name}
          </h3>
          <p
            style={{ fontSize: 'clamp(0.75rem, 2.1vw, 0.95rem)' }}
            className="text-zinc-300 line-clamp-2 max-w-2xl font-medium"
          >
            {item.overview}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ height: 'clamp(6rem, 14dvh, 8.75rem)' }}
      className="group relative w-full rounded-2xl overflow-hidden cursor-pointer bg-zinc-900 active:scale-[0.99] transition-transform shadow-lg"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onExpand(
          { ...item, media_type: mType },
          { top: r.top, left: r.left, width: r.width, height: r.height }
        );
      }}
    >
      <div className="absolute inset-0">
        <SafeImage
          src={tmdb.getImageUrl(item.backdrop_path || item.poster_path, 'w780')}
          alt={item.title || item.name}
          fallbackLabel={item.title || item.name}
          className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/65 to-transparent" />
      </div>

      <div className="absolute inset-0 flex flex-col justify-center px-[clamp(1rem,3.5vw,2rem)] z-10">
        <div className="flex items-center gap-2 mb-1 opacity-85">
          {mType === 'tv' ? (
            <Tv size={12} className="text-accent" />
          ) : (
            <Film size={12} className="text-accent" />
          )}
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            {typeLabel}
          </span>
          {year && (
            <>
              <span className="w-1 h-1 rounded-full bg-zinc-500" />
              <span className="text-[10px] font-bold text-zinc-400 tabular-nums font-mono">
                {year}
              </span>
            </>
          )}
        </div>

        <h4
          style={{ fontSize: 'clamp(1.05rem, 3.2vw, 1.5rem)' }}
          className="font-black text-white leading-tight truncate max-w-2xl group-hover:text-accent transition-colors font-display"
        >
          {item.title || item.name}
        </h4>

        {item.overview && (
          <p className="text-zinc-400 text-xs mt-1 line-clamp-1 max-w-xl hidden sm:block">
            {item.overview}
          </p>
        )}
      </div>
    </div>
  );
};

interface MonthWheel3DProps {
  months: Date[];
  selectedMonthIndex: number;
  languageCode: string;
  onSelectMonthIndex: (idx: number) => void;
}

/**
 * Isolated 60fps 3D Month Wheel
 * Manages touch drag state via requestAnimationFrame and only commits the selected month
 * on touchEnd/mouseUp or click so dragging never triggers mid-gesture API fetches or list re-renders.
 */
const MonthWheel3D = React.memo<MonthWheel3DProps>(
  ({ months, selectedMonthIndex, languageCode, onSelectMonthIndex }) => {
    const { monthWheelStride, monthCardWidth } = useResponsive();
    const [carouselIndex, setCarouselIndex] = useState(selectedMonthIndex);
    const [isDragging, setIsDragging] = useState(false);

    const dragStartXRef = useRef(0);
    const dragStartValRef = useRef(selectedMonthIndex);
    const currentIndexRef = useRef(selectedMonthIndex);
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
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
      setIsDragging(true);
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      dragStartXRef.current = clientX;
      dragStartValRef.current = currentIndexRef.current;
    };

    const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDragging || months.length === 0) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const deltaX = clientX - dragStartXRef.current;
      const nextVal = dragStartValRef.current + deltaX * (-1 / Math.max(85, monthWheelStride));
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
      const nearestIndex = Math.round(currentIndexRef.current);
      currentIndexRef.current = nearestIndex;
      setCarouselIndex(nearestIndex);
      const normIdx = normalizeIndex(nearestIndex, months.length);
      onSelectMonthIndex(normIdx);
    };

    const navigateMonthWheel = (direction: 'prev' | 'next') => {
      const nextIdx = Math.round(currentIndexRef.current) + (direction === 'next' ? 1 : -1);
      currentIndexRef.current = nextIdx;
      setCarouselIndex(nextIdx);
      const normIdx = normalizeIndex(nextIdx, months.length);
      onSelectMonthIndex(normIdx);
    };

    const selectMonthByIndex = (targetBaseIndex: number) => {
      const currentBaseIndex = normalizeIndex(Math.round(currentIndexRef.current), months.length);
      const diff = getShortestDistance(currentBaseIndex, targetBaseIndex, months.length);
      const nextIdx = Math.round(currentIndexRef.current) + diff;
      currentIndexRef.current = nextIdx;
      setCarouselIndex(nextIdx);
      onSelectMonthIndex(targetBaseIndex);
    };

    return (
      <div
        style={{ height: 'clamp(140px, 23dvh, 184px)' }}
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
            navigateMonthWheel('prev');
          }}
          aria-label="Previous month"
          className="absolute left-2 md:left-16 z-40 p-2.5 bg-white/5 hover:bg-white/20 rounded-full backdrop-blur-md transition-colors hidden md:block"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigateMonthWheel('next');
          }}
          aria-label="Next month"
          className="absolute right-2 md:right-16 z-40 p-2.5 bg-white/5 hover:bg-white/20 rounded-full backdrop-blur-md transition-colors hidden md:block"
        >
          <ChevronRight size={22} />
        </button>

        <div className="relative w-full h-full flex items-center justify-center transform-style-3d">
          {months.map((m, i) => {
            const len = months.length;
            const current = carouselIndex;
            const k = Math.round((current - i) / len);
            const effectiveIndex = i + k * len;
            const dist = effectiveIndex - current;

            if (Math.abs(dist) > 3.1) return null;

            const isActive = Math.abs(dist) < 0.5;
            const scale = Math.max(0.6, 1.22 - Math.abs(dist) * 0.26);
            const opacity = Math.max(0.15, 1 - Math.abs(dist) * 0.28);
            const zIndex = 100 - Math.round(Math.abs(dist) * 10);
            const translateX = dist * monthWheelStride;

            const shortMonth = m.toLocaleString(languageCode, { month: 'short' }).toUpperCase();
            const fullMonth = m.toLocaleString(languageCode, { month: 'long' });
            const yearNum = m.getFullYear();

            return (
              <div
                key={`${m.getFullYear()}-${m.getMonth()}-${k}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isDragging) selectMonthByIndex(i);
                }}
                style={{
                  width: `${monthCardWidth}px`,
                  height: `${monthCardWidth}px`,
                  transform: `translate3d(calc(-50% + ${translateX}px), -50%, 0) scale(${scale})`,
                  zIndex,
                  opacity,
                }}
                className={`absolute top-1/2 left-1/2 rounded-3xl flex flex-col items-center justify-center will-change-transform ${
                  isDragging
                    ? ''
                    : 'transition-all duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]'
                } ${
                  isActive
                    ? 'bg-white text-black shadow-[0_0_36px_rgba(255,255,255,0.28)]'
                    : 'bg-zinc-900/90 text-zinc-300 shadow-2xl'
                }`}
              >
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  {yearNum}
                </span>
                <span className="text-[clamp(1.2rem,3.6vw,1.7rem)] font-black tracking-tight font-display leading-none mt-0.5">
                  {shortMonth}
                </span>

                {isActive && !isDragging && (
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
                    <span className="text-xs font-bold text-zinc-300 tracking-wide">
                      {fullMonth} {yearNum}
                    </span>
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

export const CalendarView: React.FC<CalendarViewProps> = ({ tmdb, watchlist, onExpand }) => {
  const months = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    return Array.from({ length: 12 }, (_, i) => {
      return new Date(base.getFullYear(), base.getMonth() + (i - 1), 1);
    });
  }, []);

  const [activeMonthIndex, setActiveMonthIndex] = useState(1);
  const currentDate = months[activeMonthIndex] || months[1];

  const [monthData, setMonthData] = useState<Record<string, MediaItem[]>>({});
  const [sortedDates, setSortedDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [airingToday, setAiringToday] = useState<MediaItem[]>([]);

  const dateRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { setContextualBackground } = useAmbientActions();

  const regionCode = tmdb.getRegion();
  const languageCode = tmdb.getLanguage();

  // Endpoint #5: /tv/airing_today — Live series airing a new episode today
  useEffect(() => {
    let mounted = true;
    tmdb
      .getAiringTodayTv(1)
      .then((res) => {
        if (mounted) {
          setAiringToday((res.results || []).slice(0, 12));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [tmdb, languageCode]);

  const handleSelectMonthIndex = useCallback((idx: number) => {
    setActiveMonthIndex(idx);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchMonth = async () => {
      setLoading(true);
      setMonthData({});
      setSortedDates([]);

      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endDate = `${year}-${month.toString().padStart(2, '0')}-${new Date(
          year,
          month,
          0
        ).getDate()}`;

        const [movies, tv] = await Promise.all([
          tmdb.discover('movie', {
            'primary_release_date.gte': startDate,
            'primary_release_date.lte': endDate,
            watch_region: regionCode,
            sort_by: 'popularity.desc',
          }),
          tmdb.discover('tv', {
            'first_air_date.gte': startDate,
            'first_air_date.lte': endDate,
            watch_region: regionCode,
            sort_by: 'popularity.desc',
          }),
        ]);

        if (cancelled) return;

        const wlItems = watchlist.filter((i) => {
          const d = i.release_date || i.first_air_date;
          if (!d) return false;
          const date = new Date(d);
          return date.getFullYear() === year && date.getMonth() === month - 1;
        });

        const taggedMovies = (movies.results || []).map((m) => ({
          ...m,
          media_type: 'movie' as const,
        }));
        const taggedTv = (tv.results || []).map((t) => ({ ...t, media_type: 'tv' as const }));

        const all = [...taggedMovies, ...taggedTv, ...wlItems];
        const grouped: Record<string, MediaItem[]> = {};
        const seenPerDay: Record<string, Set<string>> = {};

        all.forEach((item) => {
          const d = item.release_date || item.first_air_date;
          if (!d) return;
          if (!grouped[d]) {
            grouped[d] = [];
            seenPerDay[d] = new Set();
          }
          const key = toMediaKey(item.id, resolveMediaType(item));
          if (!seenPerDay[d].has(key)) {
            seenPerDay[d].add(key);
            grouped[d].push(item);
          }
        });

        Object.keys(grouped).forEach((k) => {
          grouped[k].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        });

        const dates = Object.keys(grouped).sort();
        setMonthData(grouped);
        setSortedDates(dates);

        if (dates.length > 0 && grouped[dates[0]]?.[0]?.backdrop_path) {
          setContextualBackground(grouped[dates[0]][0].backdrop_path);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchMonth();
    return () => {
      cancelled = true;
    };
  }, [currentDate.getFullYear(), currentDate.getMonth(), regionCode, languageCode, tmdb, watchlist, setContextualBackground]);

  const DateDivider = ({ dateStr }: { dateStr: string }) => {
    const d = new Date(dateStr);
    const dayName = d.toLocaleString(languageCode, { weekday: 'long' });
    const dayNum = d.getDate();
    const isToday = new Date().toDateString() === d.toDateString();

    return (
      <div className="flex items-center justify-center gap-4 sm:gap-6 py-7 md:py-12 relative">
        <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1" />
        <div className="flex flex-col items-center relative group">
          {isToday && (
            <span className="absolute -top-5 text-[10px] font-black uppercase tracking-[0.3em] text-accent">
              {languageCode.startsWith('de') ? 'Heute' : 'Today'}
            </span>
          )}
          <div
            style={{ fontSize: 'clamp(1.65rem, 5.5vw, 3.5rem)' }}
            className="font-black text-white tracking-tighter flex items-baseline gap-2.5 font-display"
          >
            <span
              style={{ fontSize: 'clamp(1rem, 3.2vw, 1.75rem)' }}
              className="text-zinc-500 font-bold uppercase tracking-widest"
            >
              {dayName}
            </span>
            <span className="tabular-nums font-mono">{dayNum}</span>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1" />
      </div>
    );
  };

  return (
    <div className="min-h-full bg-transparent px-[var(--fluid-page-px)] pb-32">
      {/* --- ISOLATED 60FPS 3D MONTH CAROUSEL WHEEL --- */}
      <div
        style={{
          paddingTop: 'max(2.75rem, calc(env(safe-area-inset-top, 0px) + 1.5rem))',
        }}
        className="pb-4 flex flex-col items-center relative z-30"
      >
        <MonthWheel3D
          months={months}
          selectedMonthIndex={activeMonthIndex}
          languageCode={languageCode}
          onSelectMonthIndex={handleSelectMonthIndex}
        />
      </div>

      {/* --- ENDPOINT #5: HEUTE MIT NEUER FOLGE IM TV & STREAM (/tv/airing_today) --- */}
      {airingToday.length > 0 && (
        <div className="max-w-5xl mx-auto mt-2 mb-6">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-sm sm:text-base font-black tracking-tight text-white">
              {languageCode.startsWith('de')
                ? 'Heute mit neuer Episode'
                : 'New Episodes Airing Today'}
            </h3>
          </div>
          <div className="flex overflow-x-auto gap-3 pb-2 no-scrollbar ios-touch-rail ios-snap-rail">
            {airingToday.map((item) => (
              <div
                key={`airing-today-${item.id}`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onExpand(
                    { ...item, media_type: 'tv' },
                    { top: r.top, left: r.left, width: r.width, height: r.height }
                  );
                }}
                style={{ width: 'clamp(210px, 56vw, 280px)' }}
                className="group relative flex-shrink-0 aspect-video rounded-2xl overflow-hidden bg-zinc-900 cursor-pointer border border-white/10 active:scale-95 transition-transform ios-snap-card"
              >
                <SafeImage
                  src={tmdb.getImageUrl(item.backdrop_path || item.poster_path, 'w500')}
                  alt={item.name || item.title}
                  fallbackLabel={item.name || item.title}
                  className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent flex flex-col justify-end p-3">
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400 mb-0.5">
                    {languageCode.startsWith('de') ? 'Heute neue Folge' : 'New Episode Today'}
                  </span>
                  <h4 className="text-white font-bold text-xs sm:text-sm leading-tight line-clamp-1">
                    {item.name || item.title}
                  </h4>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- DAY-BY-DAY RELEASE SCHEDULE --- */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-[42vh] space-y-6">
          <div className="w-9 h-9 border-3 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[42vh] opacity-45 text-center">
          <CalIcon size={44} className="mb-3 text-zinc-500" />
          <h3 className="text-[length:var(--fluid-h2)] font-bold text-white">
            {languageCode.startsWith('de') ? 'Ruhiger Monat' : 'Quiet Month'}
          </h3>
          <p className="text-zinc-500 text-[length:var(--fluid-body)]">
            {languageCode.startsWith('de')
              ? 'Keine großen Neustarts für diesen Monat gefunden.'
              : 'No major releases found for this month.'}
          </p>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto">
          {sortedDates.map((dateStr) => {
            const items = monthData[dateStr];
            if (!items || items.length === 0) return null;
            const headliner = items[0];
            const support = items.slice(1);

            return (
              <div
                key={dateStr}
                ref={(el) => {
                  dateRefs.current[dateStr] = el;
                }}
                className="animate-fade-in mb-6 sm:mb-8"
              >
                <DateDivider dateStr={dateStr} />

                <div className="space-y-2.5 sm:space-y-3">
                  {headliner && (
                    <ReleaseCard
                      item={headliner}
                      isHero={true}
                      tmdb={tmdb}
                      onExpand={onExpand}
                    />
                  )}

                  {support.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3 mt-2.5">
                      {support.map((item) => (
                        <ReleaseCard
                          key={toMediaKey(item.id, resolveMediaType(item))}
                          item={item}
                          isHero={false}
                          tmdb={tmdb}
                          onExpand={onExpand}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};