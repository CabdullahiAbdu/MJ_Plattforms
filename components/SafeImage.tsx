import React, { useState, useEffect, useRef } from 'react';
import { Film, Tv, User } from './Icons';
import { MediaType } from '../types';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string | null;
  fallbackTitle?: string;
  fallbackLabel?: string;
  mediaType?: MediaType | string;
  containerClassName?: string;
  fetchPriority?: 'high' | 'low' | 'auto';
}

/**
 * SafeImage (Phase 3: Strict Lazy Loading, Request Cancellation on Navigation & Zero-Broken-Image Policy)
 * ------------------------------------------------------------------------------------------------------
 * - Defaults to `loading="lazy"` unless `fetchPriority="high"` or `loading="eager"` is explicitly set.
 * - Cancels in-flight image downloads on component unmount / tab navigation so offscreen requests
 *   never compete with active view assets.
 * - Automatically retries once at `w300` resolution if a larger TMDB image fails to decode.
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
  fetchPriority,
  ...rest
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | null | undefined>(src);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const label = fallbackTitle || fallbackLabel || alt || '';

  useEffect(() => {
    setCurrentSrc(src);
    setRetried(false);
    setFailed(false);
  }, [src]);

  // Phase 3: Cancel pending image download if user navigates away before decode completes
  useEffect(() => {
    return () => {
      const el = imgRef.current;
      if (el && !el.complete) {
        try {
          el.src = '';
        } catch {
          // ignore
        }
      }
    };
  }, []);

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

  const effectiveLoading = loading || (fetchPriority === 'high' ? 'eager' : 'lazy');

  return (
    <img
      ref={imgRef}
      src={currentSrc}
      alt={label || 'Media artwork'}
      decoding="async"
      loading={effectiveLoading}
      {...(fetchPriority ? { fetchPriority } : {})}
      onError={handleError}
      className={`${className} bg-zinc-900`}
      {...rest}
    />
  );
};
