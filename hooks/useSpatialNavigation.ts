import { useEffect, useRef } from 'react';
import { recordNavigationStart, recordNavigationComplete } from '../services/performanceMonitor';

export type TvDirection = 'up' | 'down' | 'left' | 'right';
export type TvColorKey = 'red' | 'green' | 'yellow' | 'blue';

interface SpatialNavigationOptions {
  enabled?: boolean;
  isTvMode?: boolean;
  onBackAction?: () => boolean;
  onColorKey?: (color: TvColorKey) => void;
  onToggleTvMenu?: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex="0"]',
  '[data-tv-focusable="true"]',
].join(', ');

// Remembers the last focused item inside each horizontal [data-tv-row="true"] rail
const rowMemoryMap = new WeakMap<HTMLElement, HTMLElement>();

// Phase 7: Spatial Geometry & Candidate Cache (eliminates full-DOM getBoundingClientRect reflows on every keystroke)
interface SpatialGeometryCache {
  scopeRoot: ParentNode | null;
  candidates: HTMLElement[];
  rows: HTMLElement[];
  rects: WeakMap<HTMLElement, DOMRect>;
  timestamp: number;
}

const spatialCache: SpatialGeometryCache = {
  scopeRoot: null,
  candidates: [],
  rows: [],
  rects: new WeakMap<HTMLElement, DOMRect>(),
  timestamp: 0,
};

export function invalidateSpatialNavigationCache(): void {
  spatialCache.scopeRoot = null;
  spatialCache.candidates = [];
  spatialCache.rows = [];
  spatialCache.rects = new WeakMap<HTMLElement, DOMRect>();
  spatialCache.timestamp = 0;
}

function getCachedRect(el: HTMLElement): DOMRect {
  const cached = spatialCache.rects.get(el);
  if (cached) return cached;
  const rect = el.getBoundingClientRect();
  spatialCache.rects.set(el, rect);
  return rect;
}

function safeClosest(el: Element | null | undefined, selector: string): HTMLElement | null {
  if (!el || typeof el.closest !== 'function') return null;
  try {
    return el.closest<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function safeFocus(el: HTMLElement | null | undefined): void {
  if (!el || typeof el.focus !== 'function') return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      // ignore
    }
  }
}

function safeScrollTo(
  el: HTMLElement | null | undefined,
  opts: { top?: number; left?: number; behavior?: ScrollBehavior }
): void {
  if (!el) return;
  try {
    if (typeof el.scrollTo === 'function') {
      el.scrollTo(opts);
      return;
    }
  } catch {
    // Fallback for legacy Smart TV WebViews that only accept (x, y) or scrollTop/scrollLeft
  }
  try {
    if (typeof opts.top === 'number') el.scrollTop = opts.top;
    if (typeof opts.left === 'number') el.scrollLeft = opts.left;
  } catch {
    // ignore
  }
}

function isElementIgnoredForTv(el: HTMLElement): boolean {
  if (!el || typeof el.getAttribute !== 'function') return true;
  if (el.getAttribute('data-tv-ignore') === 'true') return true;
  if (safeClosest(el, '[data-tv-ignore="true"]')) return true;
  if (el.tabIndex < 0 && el.getAttribute('data-tv-focusable') !== 'true') return true;
  return false;
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el || !el.isConnected) return false;
  if (isElementIgnoredForTv(el)) return false;
  try {
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') < 0.05 ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }
    const rect = getCachedRect(el);
    return rect.width > 4 && rect.height > 4;
  } catch {
    return false;
  }
}

function getActiveScopeRoot(): ParentNode {
  try {
    const modalScopes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-tv-scope="modal"], [data-scroll-container="overlay"]'
      )
    ).filter((el) => {
      if (!el.isConnected) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (modalScopes.length > 0) {
      return modalScopes[modalScopes.length - 1];
    }
  } catch {
    // ignore
  }
  return document;
}

function getFocusableCandidates(scopeRoot?: ParentNode): HTMLElement[] {
  try {
    const root = scopeRoot || getActiveScopeRoot();
    const now = performance.now();
    if (
      root === spatialCache.scopeRoot &&
      spatialCache.candidates.length > 0 &&
      now - spatialCache.timestamp < 320 &&
      spatialCache.candidates.every((el) => el.isConnected)
    ) {
      return spatialCache.candidates;
    }

    const raw = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const visible = raw.filter(isElementVisible);
    if (!scopeRoot || scopeRoot === spatialCache.scopeRoot || !spatialCache.scopeRoot) {
      spatialCache.scopeRoot = root;
      spatialCache.candidates = visible;
      spatialCache.timestamp = now;
    }
    return visible;
  } catch {
    return [];
  }
}

/**
 * Smoothly centers a focused card horizontally inside its rail AND centers the active row
 * vertically inside its scroll container (<main> or overlay), matching Netflix / Apple TV+.
 * Phase 7: Uses instant scroll ('auto') during rapid key-repeat to avoid competing smooth animations.
 */
function centerElementAndRowInViewport(
  target: HTMLElement,
  rowEl?: HTMLElement | null,
  rapidRepeat = false
) {
  try {
    const scrollBehavior: ScrollBehavior = rapidRepeat ? 'auto' : 'smooth';
    const activeRow = rowEl || safeClosest(target, '[data-tv-row="true"]');

    // 1. Center card horizontally inside its scrollable rail
    if (activeRow && activeRow.scrollWidth > activeRow.clientWidth + 8) {
      const rowRect = activeRow.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const currentScrollLeft = activeRow.scrollLeft;
      const targetCenterOffset =
        targetRect.left -
        rowRect.left +
        currentScrollLeft -
        rowRect.width / 2 +
        targetRect.width / 2;

      safeScrollTo(activeRow, {
        left: Math.max(0, targetCenterOffset),
        behavior: scrollBehavior,
      });
    }

    // 2. Center the row (or target) vertically inside the active vertical scroll container
    const scrollContainer =
      safeClosest(target, '[data-scroll-container="overlay"]') ||
      safeClosest(target, '[data-scroll-container="transitor"]') ||
      safeClosest(target, 'main');

    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + 8) {
      const anchorEl = activeRow || target;
      const containerRect = scrollContainer.getBoundingClientRect();
      const anchorRect = anchorEl.getBoundingClientRect();
      const currentScrollTop = scrollContainer.scrollTop;

      const desiredScrollTop =
        currentScrollTop +
        (anchorRect.top - containerRect.top) -
        containerRect.height / 2 +
        anchorRect.height / 2;

      safeScrollTo(scrollContainer, {
        top: Math.max(0, desiredScrollTop),
        behavior: scrollBehavior,
      });
    } else if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({
          behavior: scrollBehavior,
          block: 'center',
          inline: 'center',
        });
      } catch {
        target.scrollIntoView(false);
      }
    }
    // Invalidate geometry cache after scroll positions change
    spatialCache.rects = new WeakMap<HTMLElement, DOMRect>();
  } catch {
    // ignore scroll errors on legacy TV engines
  }
}

/**
 * Returns all visible [data-tv-row="true"] containers in the active scope, sorted top-to-bottom.
 */
function getVisibleTvRows(scopeRoot: ParentNode): HTMLElement[] {
  try {
    if (
      scopeRoot === spatialCache.scopeRoot &&
      spatialCache.rows.length > 0 &&
      spatialCache.rows.every((r) => r.isConnected)
    ) {
      return spatialCache.rows;
    }

    const rows = Array.from(scopeRoot.querySelectorAll<HTMLElement>('[data-tv-row="true"]')).filter(
      (row) => {
        if (!row.isConnected) return false;
        const style = window.getComputedStyle(row);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = getCachedRect(row);
        if (rect.width <= 4 || rect.height <= 4) return false;
        const items = getFocusableCandidates(row);
        return items.length > 0;
      }
    );

    rows.sort((a, b) => getCachedRect(a).top - getCachedRect(b).top);
    if (scopeRoot === spatialCache.scopeRoot) {
      spatialCache.rows = rows;
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Picks the best target inside a target [data-tv-row="true"] when moving Up or Down:
 * 1. Restores the remembered item in that row if still visible & valid.
 * 2. Otherwise chooses the first item (or horizontally closest item).
 */
function pickTargetInRow(row: HTMLElement, referenceX: number): HTMLElement | null {
  const items = getFocusableCandidates(row);
  if (items.length === 0) return null;

  const remembered = rowMemoryMap.get(row);
  if (remembered && items.includes(remembered)) {
    return remembered;
  }

  items.sort((a, b) => getCachedRect(a).left - getCachedRect(b).left);

  let best = items[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const r = getCachedRect(item);
    const cx = r.left + r.width / 2;
    const dist = Math.abs(cx - referenceX);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }
  return best;
}

function findNextSpatialTarget(
  current: HTMLElement,
  direction: TvDirection,
  candidates: HTMLElement[],
  scopeRoot: ParentNode
): HTMLElement | null {
  const currRect = getCachedRect(current);
  const currCenterX = currRect.left + currRect.width / 2;
  const currCenterY = currRect.top + currRect.height / 2;
  const isHorizontal = direction === 'left' || direction === 'right';

  const currentRow = safeClosest(current, '[data-tv-row="true"]');
  const isMultiRowGrid = currentRow?.classList?.contains('fluid-poster-grid') ?? false;

  // 1. STRICT HORIZONTAL ROW NAVIGATION (Left / Right inside a [data-tv-row="true"] rail)
  if (isHorizontal && currentRow && !isMultiRowGrid) {
    const rowItems = getFocusableCandidates(currentRow);
    rowItems.sort((a, b) => getCachedRect(a).left - getCachedRect(b).left);
    const idx = rowItems.indexOf(current);
    if (idx !== -1) {
      const nextIdx = direction === 'right' ? idx + 1 : idx - 1;
      if (nextIdx >= 0 && nextIdx < rowItems.length) {
        return rowItems[nextIdx];
      }
      return null;
    }
  }

  // 2. STRICT ROW-BY-ROW VERTICAL NAVIGATION (Up / Down between [data-tv-row="true"] rails)
  if (!isHorizontal && currentRow && !isMultiRowGrid) {
    const allRows = getVisibleTvRows(scopeRoot);
    const rowIdx = allRows.indexOf(currentRow);
    if (rowIdx !== -1) {
      const nextRowIdx = direction === 'down' ? rowIdx + 1 : rowIdx - 1;
      if (nextRowIdx >= 0 && nextRowIdx < allRows.length) {
        const targetRow = allRows[nextRowIdx];
        const targetItem = pickTargetInRow(targetRow, currCenterX);
        if (targetItem) {
          return targetItem;
        }
      } else if (direction === 'up' && rowIdx === 0) {
        return null;
      }
    }
  }

  // 3. GENERAL SPATIAL NAVIGATION (for 2D grids like Search/Watchlist, Modals, and Settings lists)
  let bestCandidate: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cand of candidates) {
    if (cand === current) continue;
    if (
      direction !== 'up' &&
      cand.getAttribute?.('data-tv-burger-trigger') === 'true'
    ) {
      continue;
    }

    const rect = getCachedRect(cand);
    const candCenterX = rect.left + rect.width / 2;
    const candCenterY = rect.top + rect.height / 2;

    const dx = candCenterX - currCenterX;
    const dy = candCenterY - currCenterY;

    if (direction === 'right' && dx <= 4) continue;
    if (direction === 'left' && dx >= -4) continue;
    if (direction === 'down' && dy <= 4) continue;
    if (direction === 'up' && dy >= -4) continue;

    const primaryDist = isHorizontal ? Math.abs(dx) : Math.abs(dy);
    const crossDist = isHorizontal ? Math.abs(dy) : Math.abs(dx);

    if (isHorizontal && crossDist > Math.max(currRect.height * 0.95, 90)) {
      continue;
    }

    const overlapY =
      Math.min(currRect.bottom, rect.bottom) - Math.max(currRect.top, rect.top);
    const overlapX =
      Math.min(currRect.right, rect.right) - Math.max(currRect.left, rect.left);

    let crossWeight = isHorizontal ? 3.5 : 2.0;
    if (isHorizontal && overlapY > 6) {
      crossWeight = 0.5;
    } else if (!isHorizontal && overlapX > 6) {
      crossWeight = 0.65;
    }

    const score = primaryDist + crossDist * crossWeight;
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  return bestCandidate;
}

/**
 * Spatial 4-Way D-Pad & Hisense VIDAA Remote Navigation Engine (Phase 7 Optimized)
 * - Caches focusable elements & DOMRects per layout state (invalidated on DOM mutation, scroll, resize, hashchange).
 * - Throttles rapid key-repeat (85ms) and switches to instant scroll during rapid D-Pad hold.
 */
export function useSpatialNavigation({
  enabled = true,
  isTvMode = false,
  onBackAction,
  onColorKey,
  onToggleTvMenu,
}: SpatialNavigationOptions) {
  const onBackRef = useRef(onBackAction);
  onBackRef.current = onBackAction;

  const onColorKeyRef = useRef(onColorKey);
  onColorKeyRef.current = onColorKey;

  const onToggleTvMenuRef = useRef(onToggleTvMenu);
  onToggleTvMenuRef.current = onToggleTvMenu;

  const isTvModeRef = useRef(isTvMode);
  isTvModeRef.current = isTvMode;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let lastDirectionMoveAt = 0;

    // Invalidate spatial cache when DOM changes, route changes, or viewport resizes
    const onInvalidate = () => invalidateSpatialNavigationCache();
    window.addEventListener('resize', onInvalidate, { passive: true });
    window.addEventListener('hashchange', onInvalidate, { passive: true });
    window.addEventListener('popstate', onInvalidate, { passive: true });

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined' && document.body) {
      observer = new MutationObserver(() => {
        invalidateSpatialNavigationCache();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      try {
        const key = e.key || '';
        const keyCode = e.keyCode || e.which || 0;
        const activeEl = document.activeElement as HTMLElement | null;
        const isTextInput = Boolean(
          activeEl &&
            (activeEl.tagName === 'INPUT' ||
              activeEl.tagName === 'TEXTAREA' ||
              activeEl.isContentEditable)
        );

        // 1. Handle VIDAA / Smart TV Color Buttons (Red: 403, Green: 404, Yellow: 405, Blue: 406)
        if (keyCode === 403 || key === 'ColorF0Red' || (!isTextInput && key === 'F1')) {
          e.preventDefault();
          onColorKeyRef.current?.('red');
          return;
        }
        if (keyCode === 404 || key === 'ColorF1Green' || (!isTextInput && key === 'F2')) {
          e.preventDefault();
          onColorKeyRef.current?.('green');
          return;
        }
        if (keyCode === 405 || key === 'ColorF2Yellow' || (!isTextInput && key === 'F3')) {
          e.preventDefault();
          onColorKeyRef.current?.('yellow');
          return;
        }
        if (keyCode === 406 || key === 'ColorF3Blue' || (!isTextInput && key === 'F4')) {
          e.preventDefault();
          onColorKeyRef.current?.('blue');
          return;
        }

        // 1B. Handle Dedicated TV Menu / Guide / ContextMenu Button -> Toggle TV Burger Menu
        const isTvMenuKey =
          key === 'ContextMenu' ||
          key === 'Menu' ||
          key === 'Guide' ||
          key === 'Info' ||
          keyCode === 457 ||
          keyCode === 462 ||
          (!isTextInput && (key === 'm' || key === 'M'));

        if (isTvMenuKey && isTvModeRef.current) {
          e.preventDefault();
          if (onToggleTvMenuRef.current) {
            onToggleTvMenuRef.current();
          } else {
            window.dispatchEvent(new CustomEvent('mj:toggle-tv-menu'));
          }
          return;
        }

        // 2. Handle VIDAA Back (461), Tizen Return (10009), Escape, or Backspace (outside text inputs)
        const isTvBackKey =
          key === 'Escape' ||
          key === 'GoBack' ||
          key === 'BrowserBack' ||
          key === 'XF86Back' ||
          keyCode === 461 ||
          keyCode === 10009 ||
          (key === 'Backspace' && !isTextInput);

        if (isTvBackKey) {
          if (isTextInput && key !== 'Backspace') {
            activeEl?.blur?.();
            e.preventDefault();
            return;
          }

          const backEvent = new CustomEvent('mj:tv-back', { cancelable: true });
          const notCancelled = window.dispatchEvent(backEvent);
          if (!notCancelled) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          if (onBackRef.current) {
            const handled = onBackRef.current();
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
            }
          }
          return;
        }

        // 3. Map Arrow keys / legacy TV D-Pad keyCodes to direction
        let direction: TvDirection | null = null;
        if (key === 'ArrowUp' || keyCode === 38) direction = 'up';
        else if (key === 'ArrowDown' || keyCode === 40) direction = 'down';
        else if (key === 'ArrowLeft' || keyCode === 37) direction = 'left';
        else if (key === 'ArrowRight' || keyCode === 39) direction = 'right';

        if (!direction) {
          return;
        }

        // Allow left/right cursor movement inside a non-empty text input unless at boundary
        if (isTextInput && (direction === 'left' || direction === 'right')) {
          const inputEl = activeEl as HTMLInputElement;
          const valLen = (inputEl.value || '').length;
          const selStart = inputEl.selectionStart ?? 0;
          if (direction === 'left' && selStart > 0) return;
          if (direction === 'right' && selStart < valLen) return;
        }

        e.preventDefault();

        // Phase 7: Throttle rapid key-repeat (85ms) so holding D-Pad doesn't double-fire or freeze WebViews
        const now = performance.now();
        const elapsedSinceLastMove = now - lastDirectionMoveAt;
        if (elapsedSinceLastMove < 85) {
          return;
        }
        const isRapidRepeat = elapsedSinceLastMove < 200 || e.repeat;
        lastDirectionMoveAt = now;

        recordNavigationStart();

        const scopeRoot = getActiveScopeRoot();
        const candidates = getFocusableCandidates(scopeRoot);
        if (candidates.length === 0) {
          recordNavigationComplete();
          return;
        }

        document.documentElement.setAttribute('data-tv-nav-active', 'true');

        const burgerBtn = document.querySelector<HTMLElement>(
          '[data-tv-burger-trigger="true"]'
        );

        // If user is focused on the top-left TV Burger button:
        if (burgerBtn && activeEl === burgerBtn && isTvModeRef.current) {
          if (direction === 'up') {
            window.dispatchEvent(new CustomEvent('mj:open-tv-menu'));
            recordNavigationComplete();
            return;
          }
          if (direction === 'down') {
            const rows = getVisibleTvRows(scopeRoot);
            if (rows.length > 0) {
              const firstRowTarget = pickTargetInRow(rows[0], 200);
              if (firstRowTarget) {
                rowMemoryMap.set(rows[0], firstRowTarget);
                safeFocus(firstRowTarget);
                centerElementAndRowInViewport(firstRowTarget, rows[0], isRapidRepeat);
                recordNavigationComplete();
                return;
              }
            }
          }
        }

        // Initial focus if nothing is focused yet
        if (!activeEl || activeEl === document.body || !candidates.includes(activeEl)) {
          const rows = getVisibleTvRows(scopeRoot);
          if (rows.length > 0) {
            const initial = pickTargetInRow(rows[0], 200) || candidates[0];
            rowMemoryMap.set(rows[0], initial);
            safeFocus(initial);
            centerElementAndRowInViewport(initial, rows[0], isRapidRepeat);
            recordNavigationComplete();
            return;
          }
          const first =
            candidates.find((c) => c.getAttribute?.('data-tv-burger-trigger') !== 'true') ||
            candidates[0];
          safeFocus(first);
          centerElementAndRowInViewport(first, null, isRapidRepeat);
          recordNavigationComplete();
          return;
        }

        const nextTarget = findNextSpatialTarget(activeEl, direction, candidates, scopeRoot);
        if (nextTarget) {
          const targetRow = safeClosest(nextTarget, '[data-tv-row="true"]');
          if (targetRow) {
            rowMemoryMap.set(targetRow, nextTarget);
          }

          safeFocus(nextTarget);
          centerElementAndRowInViewport(nextTarget, targetRow, isRapidRepeat);

          if (direction === 'up' && targetRow) {
            const allRows = getVisibleTvRows(scopeRoot);
            if (allRows.length > 0 && allRows[0] === targetRow) {
              const mainEl = document.querySelector<HTMLElement>('main');
              safeScrollTo(mainEl, { top: 0, behavior: isRapidRepeat ? 'auto' : 'smooth' });
            }
          }
          recordNavigationComplete();
          return;
        }

        // 4. If pressing ArrowUp at the topmost row -> Scroll to top and focus/open the Top-Left Burger Menu
        if (
          direction === 'up' &&
          isTvModeRef.current &&
          burgerBtn &&
          scopeRoot === document
        ) {
          const mainEl = document.querySelector<HTMLElement>('main');
          safeScrollTo(mainEl, { top: 0, behavior: isRapidRepeat ? 'auto' : 'smooth' });
          if (activeEl !== burgerBtn) {
            safeFocus(burgerBtn);
          } else {
            window.dispatchEvent(new CustomEvent('mj:open-tv-menu'));
          }
        }
        recordNavigationComplete();
      } catch (err) {
        console.warn('Spatial navigation error:', err);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: false });
      window.removeEventListener('resize', onInvalidate);
      window.removeEventListener('hashchange', onInvalidate);
      window.removeEventListener('popstate', onInvalidate);
      observer?.disconnect();
    };
  }, [enabled]);
}
