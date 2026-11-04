import React, { useState, useEffect } from 'react';
import { Film, Tv, User } from './Icons';
import { MediaType } from '../types';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string | null;
  fallbackTitle?: string;
  fallbackLabel?: string;
  mediaType?: MediaType | string;
  containerClassName?: string;
}

/**
  * SafeImage (Zero-Broken-Image Policy + iOS WKWebView WebP Resilience)
  * --------------------------------------------------------------------
  * Renders high-resolution TMDB photography without blocking visibility on `onLoad`
  * (preventing iOS WKWebView ImageIO WebP warnings from leaving cards at opacity-0),
  * automatically retries once at `w300` resolution if a large image fails to decode,
  * and displays a clean editorial fallback surface if an image path is missing.
  */
export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt = '',
  fallbackTitle,
  fallbackLabel,
  mediaType = 'movie',
  className = '',
  containerClassName = '',
  loading,
  ...rest
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | null | undefined>(src);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);

  const label = fallbackTitle || fallbackLabel || alt || '';

  useEffect(() => {
    setCurrentSrc(src);
    setRetried(false);
    setFailed(false);
  }, [src]);

  const handleError = () => {
    if (!retried && currentSrc && currentSrc.includes('image.tmdb.org/t/p/')) {
      const fallbackUrl = currentSrc.replace(/\/t\/p\/(original|w1280|w780|w500)\//, '/t/p/w300/');
      if (fallbackUrl !== currentSrc) {
        setRetried(true);
        setCurrentSrc(fallbackUrl);
        return;
      }
    }
    setFailed(true);
  };

  if (!currentSrc || failed) {
    const Icon = mediaType === 'tv' ? Tv : mediaType === 'person' ? User : Film;
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-zinc-500 p-4 text-center select-none ${containerClassName || className}`}
      >
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-2 text-zinc-400">
          <Icon size={20} />
        </div>
        {label && (
          <span className="text-xs font-semibold text-zinc-300 line-clamp-2 max-w-[16ch] leading-snug">
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={label || 'Media artwork'}
      decoding="async"
      loading={loading || 'eager'}
      onError={handleError}
      className={`${className} bg-zinc-900`}
      {...rest}
    />
  );
};
