import React, { useEffect, useState } from 'react';
import { MediaItem, WatchProviderCountryData, AppView, resolveMediaType } from '../types';
import { TmdbService } from '../services/tmdb';
import { haptics } from '../services/haptics';
import { shareMediaItem } from '../services/share';
import { Star, Plus, Check, Eye, Share2, Info, X, Tv, Film, Sparkles, Play } from 'lucide-react';

interface QuickPeekSheetProps {
  tmdb: TmdbService;
  navigate: (view: AppView, params?: any) => void;
  isInWatchlist: (id: number, type: 'movie' | 'tv') => boolean;
  onToggleWatchlist: (item: MediaItem) => void;
  watchedCompositeKeys: Set<string>;
  onToggleWatched: (item: MediaItem) => void;
}

export const QuickPeekSheet: React.FC<QuickPeekSheetProps> = ({
  tmdb,
  navigate,
  isInWatchlist,
  onToggleWatchlist,
  watchedCompositeKeys,
  onToggleWatched,
}) => {
  const [item, setItem] = useState<MediaItem | null>(null);
  const [providers, setProviders] = useState<WatchProviderCountryData | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const primaryBtnRef = React.useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleQuickPeek = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: MediaItem }>;
      if (customEvent.detail?.item) {
        haptics.medium();
        setItem(customEvent.detail.item);
      }
    };
    window.addEventListener('mj:quick-peek', handleQuickPeek);
    return () => window.removeEventListener('mj:quick-peek', handleQuickPeek);
  }, []);

  useEffect(() => {
    if (!item) return;
    const t = window.setTimeout(() => primaryBtnRef.current?.focus(), 60);
    const onTvBack = (e: Event) => {
      e.preventDefault();
      setItem(null);
    };
    window.addEventListener('mj:tv-back', onTvBack);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mj:tv-back', onTvBack);
    };
  }, [item]);

  useEffect(() => {
    if (!item) {
      setProviders(null);
      return;
    }
    const resolvedType = resolveMediaType(item);
    if (resolvedType !== 'movie' && resolvedType !== 'tv') {
      setProviders(null);
      return;
    }

    let cancelled = false;
    setLoadingProviders(true);
    tmdb
      .getWatchProviders(item.id, resolvedType)
      .then((res) => {
        if (!cancelled) {
          setProviders(res);
        }
      })
      .catch(() => {
        if (!cancelled) setProviders(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item, tmdb]);

  if (!item) return null;

  const resolvedType = resolveMediaType(item);
  const mediaKind: 'movie' | 'tv' = resolvedType === 'tv' ? 'tv' : 'movie';
  const inWatchlist = isInWatchlist(item.id, mediaKind);
  const isWatched = watchedCompositeKeys.has(`${mediaKind}:${item.id}`);
  const title = item.title || item.name || 'Unbekannt';
  const year = (item.release_date || item.first_air_date || '').split('-')[0];
  const backdropUrl = item.backdrop_path
    ? tmdb.getImageUrl(item.backdrop_path, 'w780')
    : tmdb.getImageUrl(item.poster_path, 'w500');

  const flatrate = providers?.flatrate || [];
  const rentBuy = [...(providers?.rent || []), ...(providers?.buy || [])].filter(
    (p, idx, arr) => arr.findIndex((x) => x.provider_id === p.provider_id) === idx
  );

  const handleClose = () => {
    haptics.light();
    setItem(null);
  };

  const handleOpenDetails = (autoPlayTrailer = false) => {
    haptics.medium();
    const target = item;
    setItem(null);
    const targetView =
      target.media_type === 'person'
        ? AppView.PERSON
        : target.media_type === 'collection'
        ? AppView.COLLECTION
        : AppView.DETAILS;
    navigate(targetView, {
      id: target.id,
      type: resolveMediaType(target),
      seedItem: target,
      autoPlayTrailer,
    });
  };

  const handleShare = async () => {
    const result = await shareMediaItem(item);
    if (result) {
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2200);
    }
  };

  return (
    <div
      data-tv-scope="modal"
      className="fixed inset-0 z-[400] flex items-end justify-center bg-black/75 backdrop-blur-xl animate-fade-in"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg bg-[#101014]/95 border-t border-white/15 rounded-t-[2.25rem] overflow-hidden shadow-[0_-20px_70px_rgba(0,0,0,0.85)] pb-[calc(env(safe-area-inset-bottom,20px)+1rem)] animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-2 cursor-pointer" onClick={handleClose}>
          <div className="w-10 h-1.5 rounded-full bg-white/25" />
        </div>

        {/* Visual Header */}
        <div className="relative mx-4 rounded-2xl overflow-hidden aspect-[16/9] bg-zinc-900 border border-white/10 shadow-2xl">
          {backdropUrl ? (
            <img src={backdropUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-700">
              <Film size={40} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#101014] via-[#101014]/40 to-transparent" />

          <button
            onClick={handleClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-white/80 active:scale-90 transition-transform"
          >
            <X size={16} />
          </button>

          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-black uppercase tracking-widest text-amber-400">
            <Sparkles size={11} /> Quick Peek
          </div>

          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-zinc-300 mb-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/15 text-white text-[10px] font-black uppercase">
                  {mediaKind === 'tv' ? <Tv size={10} /> : <Film size={10} />}
                  {mediaKind === 'tv' ? 'Serie' : 'Film'}
                </span>
                {year && <span>{year}</span>}
                {Number(item.vote_average) > 0 ? (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-black">
                    <Star size={11} className="fill-amber-400" />
                    {Number(item.vote_average).toFixed(1)}
                  </span>
                ) : null}
              </div>
              <h3 className="text-xl font-black text-white leading-tight line-clamp-2">{title}</h3>
            </div>

            <button
              onClick={() => handleOpenDetails(true)}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0 shadow-lg active:scale-90 transition-transform"
              title="Trailer starten"
            >
              <Play size={16} className="fill-black ml-0.5" />
            </button>
          </div>
        </div>

        {/* Overview & Live Streaming Availability (Endpoint #7: /{type}/{id}/watch/providers) */}
        <div className="px-5 pt-4 space-y-4">
          {item.overview && (
            <p className="text-xs text-zinc-300/90 leading-relaxed line-clamp-3">{item.overview}</p>
          )}

          <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Sofort-Verfügbarkeit
              </span>
              {loadingProviders && (
                <span className="text-[10px] text-zinc-500 animate-pulse">Prüfe Anbieter…</span>
              )}
            </div>

            {!loadingProviders && flatrate.length > 0 ? (
              <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 rounded-lg shrink-0">
                  Flatrate Abo
                </span>
                {flatrate.slice(0, 6).map((p) => (
                  <div key={p.provider_id} className="flex items-center gap-1.5 shrink-0">
                    <img
                      src={tmdb.getImageUrl(p.logo_path, 'w200')}
                      alt={p.provider_name}
                      className="w-7 h-7 rounded-lg border border-white/15"
                    />
                    <span className="text-xs font-semibold text-white/90">{p.provider_name}</span>
                  </div>
                ))}
              </div>
            ) : !loadingProviders && rentBuy.length > 0 ? (
              <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-1 rounded-lg shrink-0">
                  Leihen / Kaufen
                </span>
                {rentBuy.slice(0, 6).map((p) => (
                  <img
                    key={p.provider_id}
                    src={tmdb.getImageUrl(p.logo_path, 'w200')}
                    alt={p.provider_name}
                    title={p.provider_name}
                    className="w-7 h-7 rounded-lg border border-white/15 shrink-0"
                  />
                ))}
              </div>
            ) : !loadingProviders ? (
              <p className="text-xs text-zinc-500">Derzeit kein direktes Streaming-Abo gelistet.</p>
            ) : null}
          </div>

          {/* 4 Tactile iOS Context Actions */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <button
              ref={primaryBtnRef}
              onClick={() => handleOpenDetails(false)}
              className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl bg-amber-500 text-black font-black text-[11px] active:scale-95 transition-transform shadow-lg shadow-amber-500/20"
            >
              <Info size={18} strokeWidth={2.5} />
              <span>Details</span>
            </button>

            <button
              onClick={() => {
                haptics.medium();
                onToggleWatchlist(item);
              }}
              className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border font-bold text-[11px] active:scale-95 transition-all ${
                inWatchlist
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-white/5 border-white/10 text-white'
              }`}
            >
              {inWatchlist ? <Check size={18} /> : <Plus size={18} />}
              <span>{inWatchlist ? 'Gemerkt' : 'Watchlist'}</span>
            </button>

            <button
              onClick={() => {
                haptics.medium();
                onToggleWatched(item);
              }}
              className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border font-bold text-[11px] active:scale-95 transition-all ${
                isWatched
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-white'
              }`}
            >
              <Eye size={18} />
              <span>{isWatched ? 'Gesehen' : 'Abhaken'}</span>
            </button>

            <button
              onClick={handleShare}
              className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-[11px] active:scale-95 transition-transform"
            >
              <Share2 size={18} />
              <span>{shareToast ? 'Kopiert!' : 'Teilen'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
