import React, { useRef, useEffect, useState, memo } from 'react';
import { MediaItem, Rect, AppView, resolveMediaType } from '../types';
import { Star, Check, Eye } from './Icons';
import { TmdbService } from '../services/tmdb';
import { SafeImage } from './SafeImage';
import { haptics } from '../services/haptics';
import { detectTvUserAgent, getOptimalCardPosterSize } from '../services/performanceMonitor';

interface MediaCardProps {
  item: MediaItem;
  onClick: (item: MediaItem, rect?: Rect) => void;
  imageUrl?: string;
  className?: string;
  index?: number;
  variant?: 'poster' | 'backdrop' | 'ranked' | 'masonry' | 'landscape';
  onHover?: (item: MediaItem | null) => void;
  tmdb?: TmdbService | null;

  isWatched?: boolean;
  onToggleWatched?: (e: React.MouseEvent) => void;
  bottomInfo?: string;
  bottomInfoColor?: string;
}

/**
 * MediaCard
 * ---------
 * Fluid viewport-proportional poster, backdrop, ranked, and grid cards
 * with instant tap response, 380ms iOS Long-Press Quick Peek, and 150ms Hover/Focus Intent preloading.
 */
const MediaCardComponent: React.FC<MediaCardProps> = ({
  item,
  onClick,
  imageUrl,
  className = '',
  index,
  variant = 'poster',
  onHover,
  tmdb,
  isWatched,
  onToggleWatched,
  bottomInfo,
  bottomInfoColor = 'default',
}) => {
  const title = item?.title || item?.name || 'Untitled';
  const numVote = Number(item?.vote_average || 0);
  const rating = Number.isFinite(numVote) && numVote > 0 ? numVote.toFixed(1) : null;
  const mediaType = resolveMediaType(item);
  const year = String(item?.release_date || item?.first_air_date || '').substring(0, 4);

  const rawImagePath =
    variant === 'backdrop' || variant === 'landscape'
      ? item?.backdrop_path || item?.poster_path || item?.profile_path
      : item?.poster_path || item?.profile_path || item?.backdrop_path;
  const optimalSize = getOptimalCardPosterSize(variant);
  const resolvedImageUrl =
    imageUrl ||
    (rawImagePath
      ? tmdb
        ? tmdb.getImageUrl(rawImagePath, optimalSize)
        : rawImagePath.startsWith('http')
        ? rawImagePath
        : `https://image.tmdb.org/t/p/${optimalSize}${rawImagePath.startsWith('/') ? '' : '/'}${rawImagePath}`
      : '');

  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const [isPressing, setIsPressing] = useState(false);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsPressing(false);
  };

  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearLongPressTimer();
    };
  }, []);

  const triggerIntentPreload = () => {
    clearHoverTimer();
    if (!tmdb) return;
    // Phase 5: Disable hover-intent network preloading on touch devices & Smart TVs
    if (detectTvUserAgent()) return;
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: none)').matches
    ) {
      return;
    }
    hoverTimerRef.current = setTimeout(() => {
      let view = AppView.DETAILS;
      if (mediaType === 'person') view = AppView.PERSON;
      else if (mediaType === 'collection') view = AppView.COLLECTION;
      else if (mediaType === 'company') view = AppView.COMPANY;
      tmdb.preloadDetails(item.id, mediaType, view);
    }, 220);
  };

  const handleEnter = () => {
    if (onHover) onHover(item);
    triggerIntentPreload();
  };

  const handleLeave = () => {
    clearHoverTimer();
    clearLongPressTimer();
    if (onHover) onHover(null);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') {
      triggerIntentPreload();
    }
    didLongPressRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      setIsPressing(true);
      window.dispatchEvent(
        new CustomEvent('mj:quick-peek', {
          detail: { item: { ...item, media_type: mediaType } },
        })
      );
      setTimeout(() => setIsPressing(false), 260);
    }, 380);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startPosRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearHoverTimer();
      clearLongPressTimer();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const code = e.keyCode || e.which;
    // Allow 'i' (Info) or VIDAA Yellow key (405) or ContextMenu key to open QuickPeekSheet on TV
    if (e.key === 'i' || e.key === 'I' || e.key === 'ContextMenu' || code === 405) {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('mj:quick-peek', {
          detail: { item: { ...item, media_type: mediaType } },
        })
      );
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || code === 13) {
      e.preventDefault();
      if (cardRef.current) {
        haptics.light();
        const rect = cardRef.current.getBoundingClientRect();
        onClick(
          { ...item, media_type: mediaType },
          { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        );
      }
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    clearHoverTimer();
    clearLongPressTimer();
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    haptics.light();
    const rect = e.currentTarget.getBoundingClientRect();
    onClick(
      { ...item, media_type: mediaType },
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    );
  };

  const WatchedOverlay = () =>
    isWatched ? (
      <div className="absolute inset-0 bg-black/25 z-10 rounded-2xl pointer-events-none transition-opacity duration-300" />
    ) : null;

  const ActionButtons = () =>
    onToggleWatched ? (
      <button
        type="button"
        tabIndex={-1}
        data-tv-ignore="true"
        aria-label={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleWatched(e);
        }}
        className={`absolute top-2 right-2 z-30 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-full shadow-lg transition-all duration-200 ${
          isWatched
            ? 'bg-green-500 text-black hover:bg-green-400'
            : 'bg-black/65 text-white/85 hover:bg-white hover:text-black'
        }`}
      >
        {isWatched ? <Check size={14} strokeWidth={3} /> : <Eye size={14} />}
      </button>
    ) : isWatched ? (
      <div className="absolute top-2 right-2 z-30 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-full bg-green-500 text-black shadow-lg pointer-events-none">
        <Check size={13} strokeWidth={3} />
      </div>
    ) : null;

  const BottomBadge = () =>
    bottomInfo ? (
      <div
        className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide shadow-lg z-20 whitespace-nowrap ${
          bottomInfoColor === 'blue' ? 'bg-indigo-600/90 text-white' : 'bg-zinc-900/90 text-zinc-200'
        }`}
      >
        {bottomInfo}
      </div>
    ) : null;

  // --- RANKED (Fluid viewport-scaled Top 10 card with natural 2:3 aspect ratio) ---
  if (variant === 'ranked' && index !== undefined) {
    return (
      <div
        ref={cardRef}
        tabIndex={0}
        data-tv-card="true"
        style={{
          width: 'var(--fluid-ranked-w)',
        }}
        className={`focusable relative group flex-shrink-0 flex items-end overflow-visible outline-none rounded-2xl ios-snap-card transition-transform duration-150 py-1 ${
          isPressing ? 'scale-95' : ''
        } ${className}`}
        onMouseEnter={handleEnter}
        onFocus={handleEnter}
        onMouseLeave={handleLeave}
        onBlur={handleLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span
          style={{
            fontSize: 'var(--fluid-ranked-num)',
            WebkitTextStroke: '2px rgba(255,255,255,0.18)',
            color: '#09090b',
          }}
          className="absolute left-0.5 bottom-1 font-black leading-[0.82] tracking-tighter z-0 select-none pointer-events-none transition-transform duration-200 group-hover:-translate-x-0.5 tabular-nums"
        >
          {index + 1}
        </span>
        <div
          style={{ width: 'var(--fluid-ranked-poster-w)' }}
          className="relative z-10 aspect-[2/3] ml-auto mr-1 sm:mr-2 rounded-2xl overflow-hidden shadow-xl transition-transform duration-150 ease-out active:scale-[0.97] bg-zinc-900 cursor-pointer"
        >
          <WatchedOverlay />
          <ActionButtons />
          <SafeImage
            src={resolvedImageUrl}
            fallbackTitle={title}
            mediaType={mediaType}
            className="w-full h-full object-cover"
          />
          <BottomBadge />
        </div>
      </div>
    );
  }

  // --- BACKDROP (Fluid 16:9 card) ---
  if (variant === 'backdrop') {
    return (
      <div
        ref={cardRef}
        tabIndex={0}
        data-tv-card="true"
        style={{ width: 'var(--fluid-backdrop-w)' }}
        className={`focusable group relative flex-shrink-0 aspect-video cursor-pointer transition-transform duration-150 ease-out active:scale-[0.98] outline-none rounded-2xl ios-snap-card ${
          isPressing ? 'scale-95' : ''
        } ${className}`}
        onMouseEnter={handleEnter}
        onFocus={handleEnter}
        onMouseLeave={handleLeave}
        onBlur={handleLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <div className="absolute inset-0 rounded-2xl overflow-hidden shadow-lg bg-zinc-900">
          <WatchedOverlay />
          <ActionButtons />
          <SafeImage
            src={resolvedImageUrl}
            fallbackTitle={title}
            mediaType={mediaType}
            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-end p-3 sm:p-3.5">
            <h4 className="text-white font-bold text-[clamp(0.76rem,calc(0.7rem+0.25vw),0.92rem)] leading-tight line-clamp-1">
              {title}
            </h4>
            <div className="flex items-center gap-2 text-[clamp(0.66rem,calc(0.62rem+0.15vw),0.75rem)] text-zinc-300 mt-0.5 tabular-nums">
              {year && <span>{year}</span>}
              {year && rating && <span aria-hidden="true">·</span>}
              {rating && (
                <span className="inline-flex items-center gap-1 text-yellow-400 font-semibold">
                  <Star size={11} fill="currentColor" /> {rating}
                </span>
              )}
            </div>
            <BottomBadge />
          </div>
        </div>
      </div>
    );
  }

  // --- MASONRY / FLUID GRID CARD ---
  if (variant === 'masonry') {
    return (
      <div
        ref={cardRef}
        tabIndex={0}
        data-tv-card="true"
        className={`focusable group relative w-full cursor-pointer outline-none rounded-2xl active:scale-[0.98] transition-transform duration-150 ${
          isPressing ? 'scale-95' : ''
        } ${className}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleEnter}
        onFocus={handleEnter}
        onMouseLeave={handleLeave}
        onBlur={handleLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="relative rounded-2xl overflow-hidden bg-zinc-900 shadow-md aspect-[2/3]">
          <WatchedOverlay />
          <ActionButtons />
          <SafeImage
            src={resolvedImageUrl}
            fallbackTitle={title}
            mediaType={mediaType}
            className="w-full h-full object-cover"
          />
          <BottomBadge />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5">
            <h4 className="text-white font-bold text-[clamp(0.72rem,calc(0.66rem+0.2vw),0.85rem)] leading-tight line-clamp-2">
              {title}
            </h4>
            <div className="flex items-center gap-1.5 mt-1 text-[clamp(0.65rem,calc(0.6rem+0.15vw),0.72rem)] text-zinc-300 tabular-nums">
              {year && <span>{year}</span>}
              {year && rating && <span aria-hidden="true">·</span>}
              {rating && (
                <span className="flex items-center text-yellow-400 font-semibold gap-1">
                  <Star size={10} fill="currentColor" /> {rating}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- POSTER (Standard Horizontal Rail Card) ---
  return (
    <div
      ref={cardRef}
      tabIndex={0}
      data-tv-card="true"
      style={{ width: 'var(--fluid-card-w)' }}
      className={`focusable group relative flex-shrink-0 cursor-pointer transition-transform duration-150 ease-out active:scale-[0.97] outline-none rounded-2xl ios-snap-card ${
        isPressing ? 'scale-95' : ''
      } ${className}`}
      onMouseEnter={handleEnter}
      onFocus={handleEnter}
      onMouseLeave={handleLeave}
      onBlur={handleLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onContextMenu={(e) => e.preventDefault()}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="relative overflow-hidden bg-zinc-900 rounded-2xl shadow-lg aspect-[2/3]">
        <WatchedOverlay />
        <ActionButtons />
        <SafeImage
          src={resolvedImageUrl}
          fallbackTitle={title}
          mediaType={mediaType}
          className="w-full h-full object-cover"
        />
        <BottomBadge />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5">
          <div className="flex items-center gap-1.5 text-[clamp(0.66rem,calc(0.6rem+0.18vw),0.75rem)] text-zinc-200 font-semibold tabular-nums">
            {rating && (
              <span className="flex items-center text-yellow-400">
                <Star size={11} className="fill-current mr-1" /> {rating}
              </span>
            )}
            {rating && year && <span aria-hidden="true">·</span>}
            {year && <span>{year}</span>}
          </div>
        </div>
      </div>
      <div className="mt-1.5 px-0.5">
        <h4 className="text-zinc-100 font-medium text-[clamp(0.72rem,calc(0.66rem+0.2vw),0.84rem)] leading-tight truncate group-hover:text-white transition-colors">
          {title}
        </h4>
      </div>
    </div>
  );
};

export const MediaCard = memo(
  MediaCardComponent,
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.item.poster_path === next.item.poster_path &&
    prev.item.backdrop_path === next.item.backdrop_path &&
    prev.item.profile_path === next.item.profile_path &&
    prev.imageUrl === next.imageUrl &&
    prev.variant === next.variant &&
    prev.index === next.index &&
    prev.isWatched === next.isWatched &&
    prev.bottomInfo === next.bottomInfo &&
    prev.bottomInfoColor === next.bottomInfoColor &&
    prev.className === next.className
);
