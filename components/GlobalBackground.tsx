import React, { useEffect, useState } from 'react';
import { TmdbService } from '../services/tmdb';
import { useActiveAmbientImage } from '../context/AmbientContext';
import { useConfig } from '../context/ConfigContext';

interface GlobalBackgroundProps {
  imagePath?: string | null;
  tmdb: TmdbService | null;
}

/**
 * GlobalBackground (60fps GPU-Composited Ambient Layer)
 * -----------------------------------------------------
 * On Smart TVs (isTvMode), skips full-screen 40px Gaussian blur filters to preserve
 * 60fps D-Pad scroll performance on embedded TV GPUs (e.g. Hisense VIDAA 55U6KQ).
 */
export const GlobalBackground: React.FC<GlobalBackgroundProps> = ({ imagePath, tmdb }) => {
  const ambientPath = useActiveAmbientImage();
  const { isTvMode, dataSaver } = useConfig();
  const effectivePath = imagePath !== undefined ? imagePath : ambientPath;

  const [currentImage, setCurrentImage] = useState<string | null>(null);

  useEffect(() => {
    if (isTvMode || dataSaver) return;
    if (effectivePath && tmdb) {
      const url = tmdb.getImageUrl(effectivePath, 'w300');
      if (url && url !== currentImage) {
        setCurrentImage(url);
      }
    }
  }, [effectivePath, tmdb, currentImage, isTvMode, dataSaver]);

  if (!tmdb) return null;

  if (isTvMode || dataSaver) {
    return (
      <div
        className="fixed inset-0 z-0 pointer-events-none bg-black"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(28, 28, 32, 0.55) 0%, rgba(0, 0, 0, 1) 75%)',
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black"
      style={{ transform: 'translate3d(0,0,0)' }}
    >
      {currentImage && (
        <img
          src={currentImage}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out opacity-80"
          style={{
            filter: 'blur(36px) saturate(135%) brightness(0.34)',
            transform: 'translate3d(0, 0, 0) scale(1.1)',
          }}
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/70" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40" />
    </div>
  );
};