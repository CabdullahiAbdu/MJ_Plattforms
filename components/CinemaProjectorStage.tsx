import React, { useEffect, useState } from 'react';
import { TmdbService } from '../services/tmdb';
import { useActiveAmbientImage } from '../context/AmbientContext';

interface CinemaProjectorStageProps {
  tmdb?: TmdbService;
}

/**
 * Lightweight 60fps iOS GPU-Cached Ambient Backdrop Stage
 */
export const CinemaProjectorStage: React.FC<CinemaProjectorStageProps> = ({ tmdb }) => {
  const activeAmbientPath = useActiveAmbientImage();
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    if (activeAmbientPath && tmdb) {
      const url = tmdb.getImageUrl(activeAmbientPath, 'w300');
      if (url) {
        setBackdropUrl(url);
        return;
      }
    }

    if (!tmdb) return;

    tmdb
      .getTrending('movie', 'week')
      .then((res) => {
        if (!mounted || !res?.results?.length) return;
        const withBackdrop = res.results.find((m) => m.backdrop_path);
        if (withBackdrop?.backdrop_path) {
          setBackdropUrl(tmdb.getImageUrl(withBackdrop.backdrop_path, 'w300'));
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [tmdb, activeAmbientPath]);

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-zinc-950"
      style={{ transform: 'translate3d(0,0,0)' }}
    >
      {/* Lightweight Static Radial Ambient Base */}
      <div
        className="absolute inset-0 opacity-65"
        style={{
          background:
            'radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.24) 0%, transparent 55%), radial-gradient(circle at 75% 70%, rgba(56, 189, 248, 0.18) 0%, transparent 60%)',
        }}
      />

      {/* Static GPU-Cached Blurred Movie Backdrop */}
      {backdropUrl && (
        <img
          src={backdropUrl}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover animate-fade-in duration-700"
          style={{
            filter: 'blur(40px) saturate(150%) brightness(0.38)',
            transform: 'translate3d(0, 0, 0) scale(1.12)',
          }}
        />
      )}

      {/* Soft Page-Style Depth Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/55" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40" />
    </div>
  );
};
