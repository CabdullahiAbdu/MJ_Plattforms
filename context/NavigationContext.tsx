import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppView, MediaItem, Rect, resolveMediaType } from '../types';

export interface Route {
  view: AppView;
  params?: {
    id?: number;
    type?: string;
    name?: string;
    logo?: string;
    seedItem?: MediaItem;
    autoPlayTrailer?: boolean;
  };
}

export interface ExpandingState {
  item: MediaItem;
  rect: Rect;
  autoPlayTrailer?: boolean;
}

interface NotificationState {
  message: string;
  type: 'success' | 'info';
}

interface NavigationContextValue {
  activeTab: AppView;
  visitedTabs: Set<AppView>;
  overlayStack: Route[];
  activeOverlay: Route | null;
  expandingItem: ExpandingState | null;
  notification: NotificationState | null;
  switchTab: (view: AppView) => void;
  navigateToDetail: (view: AppView, params?: Route['params']) => void;
  handleExpand: (item: MediaItem, rect: Rect, options?: { autoPlayTrailer?: boolean }) => void;
  closeExpand: () => void;
  goBack: () => void;
  showNotification: (msg: string, type?: 'success' | 'info') => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

const VALID_TABS = new Set<AppView>([
  AppView.HOME,
  AppView.SEARCH,
  AppView.CALENDAR,
  AppView.WATCHLIST,
  AppView.SETTINGS,
]);

function parseHashRoute(): { tab: AppView; overlay: Route | null } {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const tabParam = (params.get('tab')?.toUpperCase() || 'HOME') as AppView;
    const tab = VALID_TABS.has(tabParam) ? tabParam : AppView.HOME;

    const detailParam = params.get('detail'); // e.g., "movie:550" or "person:287"
    if (detailParam) {
      const [rawType, rawId] = detailParam.split(':');
      const id = Number(rawId);
      if (!isNaN(id) && id > 0) {
        let view = AppView.DETAILS;
        if (rawType === 'person') view = AppView.PERSON;
        else if (rawType === 'collection') view = AppView.COLLECTION;
        else if (rawType === 'company') view = AppView.COMPANY;
        return { tab, overlay: { view, params: { id, type: rawType } } };
      }
    }
    return { tab, overlay: null };
  } catch {
    return { tab: AppView.HOME, overlay: null };
  }
}

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialRoute = parseHashRoute();
  const [activeTab, setActiveTab] = useState<AppView>(initialRoute.tab);
  const [visitedTabs, setVisitedTabs] = useState<Set<AppView>>(() => new Set([initialRoute.tab]));
  const [overlayStack, setOverlayStack] = useState<Route[]>(() =>
    initialRoute.overlay ? [initialRoute.overlay] : []
  );
  const [expandingItem, setExpandingItem] = useState<ExpandingState | null>(null);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPopStateRef = useRef(false);

  const showNotification = useCallback((message: string, type: 'success' | 'info' = 'success') => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification({ message, type });
    notifTimerRef.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  const switchTab = useCallback((view: AppView) => {
    setActiveTab(view);
    setVisitedTabs((prev) => {
      if (prev.has(view)) return prev;
      const next = new Set(prev);
      next.add(view);
      return next;
    });
    setExpandingItem(null);
    setOverlayStack([]);
  }, []);

  const navigateToDetail = useCallback((view: AppView, params?: Route['params']) => {
    setOverlayStack((prev) => [...prev, { view, params }]);
  }, []);

  const handleExpand = useCallback(
    (item: MediaItem, rect: Rect, options?: { autoPlayTrailer?: boolean }) => {
      const normalizedItem: MediaItem = {
        ...item,
        media_type: resolveMediaType(item),
      };
      setExpandingItem({
        item: normalizedItem,
        rect,
        autoPlayTrailer: options?.autoPlayTrailer,
      });
    },
    []
  );

  const closeExpand = useCallback(() => {
    setExpandingItem(null);
  }, []);

  const goBack = useCallback(() => {
    setOverlayStack((prev) => {
      if (prev.length > 0) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const hadDetailRef = useRef<boolean>(Boolean(initialRoute.overlay));

  // --- Sync State -> Browser URL Hash for Shareable Deep Links & Back Button ---
  useEffect(() => {
    if (isPopStateRef.current) {
      isPopStateRef.current = false;
      hadDetailRef.current = Boolean(expandingItem || overlayStack.length > 0);
      return;
    }

    const params = new URLSearchParams();
    params.set('tab', activeTab.toLowerCase());

    if (expandingItem) {
      const mType = resolveMediaType(expandingItem.item);
      params.set('detail', `${mType}:${expandingItem.item.id}`);
    } else if (overlayStack.length > 0) {
      const top = overlayStack[overlayStack.length - 1];
      if (top.params?.id) {
        const mType =
          top.view === AppView.PERSON
            ? 'person'
            : top.view === AppView.COLLECTION
            ? 'collection'
            : top.view === AppView.COMPANY
            ? 'company'
            : top.params.type || 'movie';
        params.set('detail', `${mType}:${top.params.id}`);
      }
    }

    const hasDetailNow = Boolean(expandingItem || overlayStack.length > 0);
    const shouldPushHistory = !hadDetailRef.current && hasDetailNow;
    hadDetailRef.current = hasDetailNow;

    const newHash = `#${params.toString()}`;
    try {
      if (typeof window !== 'undefined' && window.location.hash !== newHash) {
        const isVidaaTv =
          window.location.search.includes('vidaa=1') ||
          /VIDAA|Hisense/i.test(navigator.userAgent || '');
        if (
          !isVidaaTv &&
          shouldPushHistory &&
          window.history &&
          typeof window.history.pushState === 'function'
        ) {
          window.history.pushState(null, '', newHash);
        } else if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', newHash);
        }
      }
    } catch {
      // Ignore History API restrictions in Smart TV DevKit / embedded WebViews
    }
  }, [activeTab, overlayStack, expandingItem]);

  // --- Listen to Browser Back / Forward Buttons ---
  useEffect(() => {
    const handlePopState = () => {
      isPopStateRef.current = true;
      const parsed = parseHashRoute();
      setActiveTab(parsed.tab);
      setVisitedTabs((prev) => {
        if (prev.has(parsed.tab)) return prev;
        const next = new Set(prev);
        next.add(parsed.tab);
        return next;
      });
      if (!parsed.overlay) {
        setExpandingItem(null);
        setOverlayStack([]);
      } else {
        setExpandingItem(null);
        setOverlayStack([parsed.overlay]);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // --- TV Remote & Keyboard "Back" Handling (Safe when typing in inputs) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput && e.key === 'Backspace') return;

      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 10009 || e.keyCode === 461) {
        if (expandingItem && overlayStack.length > 0) {
          goBack();
        } else if (expandingItem) {
          closeExpand();
        } else if (overlayStack.length > 0) {
          goBack();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandingItem, overlayStack.length, closeExpand, goBack]);

  const activeOverlay = overlayStack.length > 0 ? overlayStack[overlayStack.length - 1] : null;

  return (
    <NavigationContext.Provider
      value={{
        activeTab,
        visitedTabs,
        overlayStack,
        activeOverlay,
        expandingItem,
        notification,
        switchTab,
        navigateToDetail,
        handleExpand,
        closeExpand,
        goBack,
        showNotification,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within a NavigationProvider');
  return ctx;
}
