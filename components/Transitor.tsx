import React, { useState, useEffect, useLayoutEffect } from 'react';
import { MediaItem, Rect } from '../types';
import { TmdbService } from '../services/tmdb';

interface TransitorProps {
  item: MediaItem;
  initialRect: Rect;
  tmdb: TmdbService;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Transitor
 * ---------
 * GPU-accelerated shared-element card expansion.
 * Immediately positions the container at the tapped poster card's exact bounding rect (`initialRect`)
 * and smoothly expands it into fullscreen (`cubic-bezier(0.22, 1, 0.36, 1)`) on the very next frame,
 * shrinking back into the poster card on close.
 */
export const Transitor: React.FC<TransitorProps> = ({
  item,
  initialRect,
  tmdb,
  onClose,
  children,
}) => {
  const [phase, setPhase] = useState<'initial' | 'expanding' | 'open' | 'closing'>('initial');
  const [targetRect, setTargetRect] = useState<Rect | null>(null);

  const posterPath = item.poster_path || item.profile_path || item.backdrop_path;
  const imageUrl = tmdb.getImageUrl(posterPath, 'w780');

  useLayoutEffect(() => {
    const targetEl = document.getElementById('detail-poster');
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    }

    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      // Check once more on frame 1 in case DetailView just mounted its poster
      const el = document.getElementById('detail-poster');
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setTargetRect({
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          });
        }
      }
      raf2 = requestAnimationFrame(() => {
        setPhase('expanding');
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  useEffect(() => {
    if (phase === 'expanding') {
      const timer = setTimeout(() => {
        setPhase('open');
      }, 460);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const handleClose = () => {
    if (phase === 'closing') return;
    setPhase('closing');
    setTimeout(onClose, 380);
  };

  const content = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<any>, {
        onBack: handleClose,
      });
    }
    return child;
  });

  const isInitial = phase === 'initial';
  const isExpanding = phase === 'expanding';
  const isOpen = phase === 'open';
  const isClosing = phase === 'closing';
  const showFull = isExpanding || isOpen;

  const SPRING_CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const duration = isClosing ? '0.38s' : '0.46s';

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: showFull ? 0 : initialRect.top,
    left: showFull ? 0 : initialRect.left,
    width: showFull ? '100vw' : initialRect.width,
    height: showFull ? '100dvh' : initialRect.height,
    zIndex: 100,
    overflowY: isOpen ? 'auto' : 'hidden',
    overflowX: 'hidden',
    borderRadius: showFull ? '0px' : '16px',
    backgroundColor: '#09090b',
    boxShadow: showFull
      ? '0 0 0 rgba(0,0,0,0)'
      : '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
    transition: isInitial
      ? 'none'
      : `top ${duration} ${SPRING_CURVE}, left ${duration} ${SPRING_CURVE}, width ${duration} ${SPRING_CURVE}, height ${duration} ${SPRING_CURVE}, border-radius ${duration} ${SPRING_CURVE}`,
    willChange: 'top, left, width, height, border-radius',
  };

  const offsetTop = showFull ? 0 : initialRect.top;
  const offsetLeft = showFull ? 0 : initialRect.left;

  const innerStyle: React.CSSProperties = {
    width: '100vw',
    minHeight: '100dvh',
    height: isOpen ? 'auto' : '100dvh',
    opacity: showFull ? 1 : 0,
    transform: `translate3d(${-offsetLeft}px, ${-offsetTop}px, 0)`,
    transition: isInitial
      ? 'none'
      : `transform ${duration} ${SPRING_CURVE}, opacity ${isClosing ? '0.24s' : '0.34s'} ease-out`,
    willChange: 'transform, opacity',
  };

  // Floating poster overlay that morphs seamlessly from the tapped card
  const activePosterRect =
    showFull && targetRect
      ? targetRect
      : showFull && !targetRect
      ? {
          top: Math.max(24, window.innerHeight * 0.08),
          left: Math.max(16, window.innerWidth * 0.06),
          width: initialRect.width * 1.15,
          height: initialRect.height * 1.15,
        }
      : initialRect;

  const posterOpacity = isOpen ? 0 : showFull && !targetRect ? 0 : 1;

  const floatingPosterStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 110,
    pointerEvents: 'none',
    objectFit: 'cover',
    top: activePosterRect.top,
    left: activePosterRect.left,
    width: activePosterRect.width,
    height: activePosterRect.height,
    opacity: posterOpacity,
    borderRadius: '16px',
    boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.75)',
    transition: isInitial
      ? 'none'
      : `top ${duration} ${SPRING_CURVE}, left ${duration} ${SPRING_CURVE}, width ${duration} ${SPRING_CURVE}, height ${duration} ${SPRING_CURVE}, opacity ${
          isClosing ? '0.25s' : '0.36s'
        } ease-out`,
    willChange: 'top, left, width, height, opacity',
  };

  const scrimOpacity = showFull ? 1 : 0;

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-md transition-opacity duration-300 ease-out"
        style={{ opacity: scrimOpacity, pointerEvents: isOpen ? 'auto' : 'none' }}
        onClick={handleClose}
      />

      <div
        data-scroll-container="transitor"
        style={containerStyle}
        className="no-scrollbar ios-touch-rail"
      >
        <div style={innerStyle}>{content}</div>
      </div>

      {imageUrl && (
        <img
          src={imageUrl}
          style={floatingPosterStyle}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}

      <style>{`
        #detail-poster {
          opacity: ${isOpen || !targetRect ? '1' : '0'} !important;
          transition: opacity 0.2s ease-out;
        }
        body { overflow: hidden; }
      `}</style>
    </div>
  );
};