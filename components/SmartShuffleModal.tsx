import React, { useState, useEffect } from 'react';
import { MediaItem, WatchProviderCountryData, AppView, resolveMediaType } from '../types';
import { TmdbService } from '../services/tmdb';
import { haptics } from '../services/haptics';
import { Shuffle, Sparkles, Star, Play, Plus, Check, X, Tv, Film } from 'lucide-react';

interface SmartShuffleModalProps {
  isOpen: boolean;
  onClose: () => void;
  tmdb: TmdbService;
  candidates: MediaItem[];
  watchedCompositeKeys: Set<string>;
  watchlist: MediaItem[];
  onToggleWatchlist: (item: MediaItem) => void;
  navigate: (view: AppView, params?: any) => void;
}

export const SmartShuffleModal: React.FC<SmartShuffleModalProps> = ({
  isOpen,
  onClose,
  tmdb,
  candidates,
  watchedCompositeKeys,
  watchlist,
  onToggleWatchlist,
  navigate,
}) => {
  const [currentPick, setCurrentPick] = useState<MediaItem | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [providers, setProviders] = useState<WatchProviderCountryData | null>(null);

  const pickRandomUnseen = () => {
    haptics.medium();
    setIsSpinning(true);
    const unseen = candidates.filter((c) => {
      const kind = resolveMediaType(c) === 'tv' ? 'tv' : 'movie';
      return (
        !watchedCompositeKeys.has(`${kind}:${c.id}`) &&
        (c.backdrop_path || c.poster_path) &&
        (c.vote_average || 0) >= 6.4
      );
    });
    const pool = unseen.length > 0 ? unseen : candidates;
    if (pool.length === 0) {
      setIsSpinning(false);
      return;
    }

    setTimeout(() => {
      const next = pool[Math.floor(Math.random() * pool.length)];
      setCurrentPick(next);
      setIsSpinning(false);
      haptics.success();
    }, 280);
  };

  useEffect(() => {
    if (isOpen) {
      pickRandomUnseen();
    } else {
      setCurrentPick(null);
      setProviders(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!currentPick) return;
    let cancelled = false;
    const type = resolveMediaType(currentPick) === 'tv' ? 'tv' : 'movie';
    tmdb
      .getWatchProviders(currentPick.id, type)
      .then((res) => {
        if (!cancelled) {
          setProviders(res);
        }
      })
      .catch(() => {
        if (!cancelled) setProviders(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPick, tmdb]);

  if (!isOpen || !currentPick) return null;

  const title = currentPick.title || currentPick.name || 'Geheimtipp';
  const year = (currentPick.release_date || currentPick.first_air_date || '').split('-')[0];
  const isInWatchlist = watchlist.some((w) => w.id === currentPick.id);
  const mediaKind = resolveMediaType(currentPick) === 'tv' ? 'tv' : 'movie';
  const backdrop = currentPick.backdrop_path
    ? tmdb.getImageUrl(currentPick.backdrop_path, 'w1280')
    : tmdb.getImageUrl(currentPick.poster_path, 'w780');
  const flatrate = providers?.flatrate || [];

  return (
    <div
      className="fixed inset-0 z-[380] flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fade-in"
      onClick={() => {
        haptics.light();
        onClose();
      }}
    >
      <div
        className={`relative w-full max-w-md rounded-[2.25rem] bg-[#121218] border border-white/15 overflow-hidden shadow-[0_25px_90px_rgba(0,0,0,0.9)] transition-all duration-300 ${
          isSpinning ? 'scale-95 opacity-60 blur-[2px]' : 'scale-100 opacity-100 blur-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-[16/10] w-full bg-zinc-900">
          {backdrop && <img src={backdrop} alt={title} className="w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#121218] via-[#121218]/40 to-black/30" />

          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest shadow-lg">
            <Sparkles size={12} /> Überrasch mich
          </div>

          <button
            onClick={() => {
              haptics.light();
              onClose();
            }}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>

          <div className="absolute bottom-3 left-5 right-5">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-300 mb-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/15 text-white text-[10px] font-black uppercase">
                {mediaKind === 'tv' ? <Tv size={11} /> : <Film size={11} />}
                {mediaKind === 'tv' ? 'Serie' : 'Film'}
              </span>
              {year && <span>{year}</span>}
              {Number(currentPick.vote_average) > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-400 font-black">
                  <Star size={12} className="fill-amber-400" />
                  {Number(currentPick.vote_average).toFixed(1)}
                </span>
              ) : null}
            </div>
            <h2 className="text-2xl font-black text-white leading-tight">{title}</h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {currentPick.overview && (
            <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3">{currentPick.overview}</p>
          )}

          {flatrate.length > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.04] border border-white/10 overflow-x-auto no-scrollbar">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 shrink-0 px-1.5">
                Im Abo:
              </span>
              {flatrate.slice(0, 5).map((p) => (
                <div key={p.provider_id} className="flex items-center gap-1.5 shrink-0">
                  <img
                    src={tmdb.getImageUrl(p.logo_path, 'w200')}
                    alt={p.provider_name}
                    className="w-6 h-6 rounded-md border border-white/15"
                  />
                  <span className="text-[11px] font-semibold text-white/90">{p.provider_name}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2.5 pt-1">
            <button
              onClick={() => {
                haptics.medium();
                const target = currentPick;
                onClose();
                navigate(AppView.DETAILS, {
                  id: target.id,
                  type: mediaKind,
                  seedItem: target,
                });
              }}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white text-black font-black text-xs uppercase tracking-wider active:scale-95 transition-transform"
            >
              <Play size={16} className="fill-black" /> Jetzt ansehen
            </button>

            <button
              onClick={() => {
                haptics.medium();
                onToggleWatchlist(currentPick);
              }}
              className={`w-12 h-12 rounded-2xl border flex items-center justify-center active:scale-90 transition-all ${
                isInWatchlist
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-white/5 border-white/15 text-white'
              }`}
              title="Watchlist"
            >
              {isInWatchlist ? <Check size={18} /> : <Plus size={18} />}
            </button>

            <button
              onClick={pickRandomUnseen}
              className="flex items-center justify-center gap-1.5 px-4 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 font-black text-xs uppercase tracking-wider active:scale-90 transition-transform"
            >
              <Shuffle size={16} /> Neu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
