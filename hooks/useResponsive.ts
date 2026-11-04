import { useState, useEffect } from 'react';

export interface ResponsiveConfig {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  columns: number;
  cardWidth: number;
  scaleFactor: number;
  providerWheelStride: number;
  providerTileSize: number;
  monthWheelStride: number;
  monthCardWidth: number;
  monthCardHeight: number;
}

const computeResponsiveConfig = (w: number, h: number): ResponsiveConfig => {
  const isMobile = w < 640;
  const isTablet = w >= 640 && w < 1024;
  const isDesktop = w >= 1024;

  let columns = 2;
  let cardWidth = Math.round(Math.min(Math.max(w * 0.32, 120), 208));

  if (w >= 1536) {
    columns = 7;
  } else if (w >= 1280) {
    columns = 6;
  } else if (w >= 1024) {
    columns = 5;
  } else if (w >= 768) {
    columns = 4;
  } else if (w >= 480) {
    columns = 3;
  } else {
    columns = 2;
  }

  const scaleFactor = Number(Math.min(Math.max(w / 390, 0.82), 1.45).toFixed(3));
  const providerWheelStride = Math.round(Math.min(Math.max(w * 0.21, 72), 118));
  const providerTileSize = Math.round(Math.min(Math.max(w * 0.15, 54), 86));
  const monthWheelStride = Math.round(Math.min(Math.max(w * 0.36, 132), 192));
  const monthCardWidth = Math.round(Math.min(Math.max(w * 0.33, 124), 178));
  const monthCardHeight = Math.round(Math.min(Math.max(w * 0.17, 66), 94));

  return {
    isMobile,
    isTablet,
    isDesktop,
    width: w,
    height: h,
    columns,
    cardWidth,
    scaleFactor,
    providerWheelStride,
    providerTileSize,
    monthWheelStride,
    monthCardWidth,
    monthCardHeight,
  };
};

export const useResponsive = (): ResponsiveConfig => {
  const [config, setConfig] = useState<ResponsiveConfig>(() =>
    computeResponsiveConfig(
      typeof window !== 'undefined' ? window.innerWidth : 390,
      typeof window !== 'undefined' ? window.innerHeight : 844
    )
  );

  useEffect(() => {
    let rafId: number | null = null;

    const handleResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setConfig(computeResponsiveConfig(window.innerWidth, window.innerHeight));
      });
    };

    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return config;
};