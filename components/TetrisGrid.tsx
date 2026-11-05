import React from 'react';
import { MediaItem, Rect } from '../types';
import { TmdbService } from '../services/tmdb';
import { MediaCard } from './MovieCard';
import { getOptimalCardPosterSize } from '../services/performanceMonitor';

interface TetrisGridProps {
  items: MediaItem[];
  tmdb: TmdbService | null;
  onClick: (item: MediaItem, rect?: Rect) => void;
  loading?: boolean;
}

/**
 * TetrisGrid
 * ----------
 * Uses the CSS `.fluid-poster-grid` (`repeat(auto-fill, minmax(var(--fluid-grid-min), 1fr))`)
 * so poster cards scale continuously across every screen width with zero JS column re-bucketing.
 */
export const TetrisGrid: React.FC<TetrisGridProps> = ({
  items,
  tmdb,
  onClick,
  loading = false,
}) => {
  if (loading && items.length === 0) {
    return (
      <div className="fluid-poster-grid w-full max-w-[2400px] mx-auto">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="w-full aspect-[2/3] bg-zinc-900/60 rounded-2xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!tmdb || !items) return null;

  const posterSize = getOptimalCardPosterSize('masonry');

  return (
    <div className="fluid-poster-grid w-full max-w-[2400px] mx-auto items-start">
      {items.map((item, idx) => {
        if (!item) return null;
        const imgPath = item.poster_path || item.profile_path || item.backdrop_path;
        return (
          <div
            key={`${item.id}-${idx}`}
            className="w-full backface-hidden transform-gpu"
          >
            <MediaCard
              item={item}
              onClick={onClick}
              imageUrl={tmdb.getImageUrl(imgPath, posterSize)}
              variant="masonry"
              tmdb={tmdb}
              bottomInfo={item.display_role}
            />
          </div>
        );
      })}
    </div>
  );
};