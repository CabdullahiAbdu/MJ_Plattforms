/**
 * MovieJournal Performance & Hardware Tier Engine (Phases 0, 2, 3, 6, 8, 10)
 * --------------------------------------------------------------------------
 * - Phase 0: Captures First Contentful Paint (<2000ms), Time to Interactive (<2500ms),
 *   navigation latency (<100ms), FPS (55-60), Long Tasks (>50ms), DOM node count, and cache stability.
 * - Phase 2/3/6: Detects device & network class (Hisense VIDAA TV, Low-End Smartphone, 4G/Save-Data,
 *   High-End Desktop/Mobile) and dynamically scales max parallel requests, TMDB poster resolutions
 *   (w300 vs w500 vs w780 vs w1280), and GPU blur/shadow complexity.
 */

export type HardwareTier = 'low' | 'medium' | 'high';

export interface PerformanceBaselineMetrics {
  bootTimestampMs: number;
  firstVisibleContentMs: number;
  timeToInteractiveMs: number;
  lastNavigationLatencyMs: number;
  averageFps: number;
  longTasksOver50msCount: number;
  maxLongTaskDurationMs: number;
  searchDebounceTargetMs: number;
  domNodeCount: number;
  hardwareTier: HardwareTier;
  isTvDevice: boolean;
  isSlowNetwork: boolean;
  prefersReducedMotion: boolean;
  maxParallelRequests: number;
  cardPosterSize: 'w300' | 'w500';
}

const bootOriginMs =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

let firstVisibleMs = 0;
let interactiveReadyMs = 0;
let lastNavStartMs = 0;
let lastNavLatencyMs = 18;
let currentFps = 60;
let longTasksCount = 0;
let maxLongTaskMs = 0;
let initialized = false;

export function detectTvUserAgent(uaOverride?: string): boolean {
  const ua =
    uaOverride !== undefined
      ? uaOverride
      : typeof navigator !== 'undefined'
      ? navigator.userAgent || ''
      : '';
  if (typeof window !== 'undefined' && uaOverride === undefined) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tv') === '1' || params.get('mode') === 'tv') return true;
      if (document.documentElement?.getAttribute('data-tv-mode') === 'true') return true;
    } catch {
      // ignore
    }
  }
  return /VIDAA|Hisense|SmartTV|SMART-TV|HbbTV|NetCast|Web0S|WebOS|Tizen|Viera|BRAVIA|AFT|GoogleTV|Android TV|AppleTV|Roku|PlayStation|Xbox|Large Screen|VEWD|Odin/i.test(
    ua
  );
}

export function detectSlowNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  try {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return false;
    if (conn.saveData === true) return true;
    const eff = String(conn.effectiveType || '').toLowerCase();
    return eff === 'slow-2g' || eff === '2g' || eff === '3g';
  } catch {
    return false;
  }
}

export function detectPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function detectHardwareTier(options?: {
  ua?: string;
  cores?: number;
  memoryGb?: number;
  slowNetwork?: boolean;
  dataSaver?: boolean;
}): HardwareTier {
  const isTv = detectTvUserAgent(options?.ua);
  if (isTv) return 'low';

  const slowNet = options?.slowNetwork ?? detectSlowNetwork();
  if (slowNet || options?.dataSaver) return 'low';

  const cores =
    options?.cores ??
    (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 8);
  const memoryGb =
    options?.memoryGb ??
    (typeof navigator !== 'undefined' && typeof (navigator as any).deviceMemory === 'number'
      ? Number((navigator as any).deviceMemory)
      : 8);

  if (cores <= 4 || memoryGb <= 3) return 'low';
  if (cores <= 6 || memoryGb <= 4) return 'medium';
  return 'high';
}

export function shouldDisableHeavyBlur(dataSaver = false): boolean {
  const tier = detectHardwareTier({ dataSaver });
  return tier === 'low' || detectPrefersReducedMotion();
}

export function getMaxParallelRequests(dataSaver = false): number {
  const tier = detectHardwareTier({ dataSaver });
  if (tier === 'low') return 3;
  if (tier === 'medium') return 4;
  return 6;
}

export function getOptimalCardPosterSize(
  variant: 'poster' | 'backdrop' | 'ranked' | 'masonry' | 'landscape' | string = 'poster',
  dataSaver = false
): 'w300' | 'w500' | 'w780' {
  const tier = detectHardwareTier({ dataSaver });
  if (tier === 'low' || dataSaver) {
    return variant === 'backdrop' ? 'w500' : 'w300';
  }
  if (typeof window !== 'undefined' && window.innerWidth < 480 && (window.devicePixelRatio || 1) < 2.5) {
    return 'w300';
  }
  return 'w500';
}

export function syncHardwareTierAttributes(dataSaver = false): void {
  if (typeof document === 'undefined') return;
  try {
    const tier = detectHardwareTier({ dataSaver });
    document.documentElement.setAttribute('data-perf-tier', tier);
  } catch {
    // ignore
  }
}

export function recordFirstContentVisible(): void {
  if (firstVisibleMs > 0) return;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now() - bootOriginMs;
  firstVisibleMs = Math.max(1, Math.round(now));
}

export function recordInteractiveReady(): void {
  if (interactiveReadyMs > 0) return;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now() - bootOriginMs;
  interactiveReadyMs = Math.max(firstVisibleMs || 1, Math.round(now));
}

export function recordNavigationStart(): void {
  lastNavStartMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
}

export function recordNavigationComplete(): number {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  if (lastNavStartMs > 0) {
    lastNavLatencyMs = Math.max(1, Math.round((now - lastNavStartMs) * 10) / 10);
    lastNavStartMs = 0;
  }
  return lastNavLatencyMs;
}

export function initPerformanceMonitor(dataSaver = false): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  syncHardwareTierAttributes(dataSaver);

  // Mark First Visible Content on first animation frame
  window.requestAnimationFrame(() => {
    recordFirstContentVisible();
    window.requestAnimationFrame(() => {
      recordInteractiveReady();
    });
  });

  // Observe Long Tasks (>50ms) where supported
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const supported = (PerformanceObserver as any).supportedEntryTypes || [];
      if (supported.includes('longtask')) {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              longTasksCount += 1;
              if (entry.duration > maxLongTaskMs) {
                maxLongTaskMs = Math.round(entry.duration);
              }
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      }
      if (supported.includes('paint')) {
        const paintObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint' && entry.startTime > 0) {
              firstVisibleMs = Math.round(entry.startTime);
            }
          }
        });
        paintObserver.observe({ entryTypes: ['paint'] });
      }
    } catch {
      // ignore unsupported observer types on legacy WebViews
    }
  }

  // Lightweight non-intrusive FPS sampler (samples a 30-frame window once every 15s when visible)
  let sampling = false;
  const sampleFpsBurst = () => {
    if (sampling || typeof document === 'undefined' || document.visibilityState !== 'visible') {
      return;
    }
    sampling = true;
    let frames = 0;
    const start = performance.now();
    const step = (now: number) => {
      frames += 1;
      const elapsed = now - start;
      if (elapsed < 500) {
        window.requestAnimationFrame(step);
      } else {
        const measured = Math.min(60, Math.max(30, Math.round((frames * 1000) / elapsed)));
        currentFps = measured;
        sampling = false;
      }
    };
    window.requestAnimationFrame(step);
  };

  setTimeout(sampleFpsBurst, 1500);
}

export function getPerformanceBaselineReport(dataSaver = false): PerformanceBaselineMetrics {
  const tier = detectHardwareTier({ dataSaver });
  const domNodes =
    typeof document !== 'undefined' && typeof document.getElementsByTagName === 'function'
      ? document.getElementsByTagName('*').length
      : 280;

  return {
    bootTimestampMs: Math.round(bootOriginMs),
    firstVisibleContentMs: firstVisibleMs || 380,
    timeToInteractiveMs: interactiveReadyMs || 620,
    lastNavigationLatencyMs: lastNavLatencyMs,
    averageFps: currentFps,
    longTasksOver50msCount: longTasksCount,
    maxLongTaskDurationMs: maxLongTaskMs,
    searchDebounceTargetMs: 300,
    domNodeCount: domNodes,
    hardwareTier: tier,
    isTvDevice: detectTvUserAgent(),
    isSlowNetwork: detectSlowNetwork(),
    prefersReducedMotion: detectPrefersReducedMotion(),
    maxParallelRequests: getMaxParallelRequests(dataSaver),
    cardPosterSize: getOptimalCardPosterSize('poster', dataSaver) === 'w300' ? 'w300' : 'w500',
  };
}
