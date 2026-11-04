import React, { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * AmbientStore (Observer Pattern)
 * -------------------------------
 * Completely isolates high-frequency visual backdrop changes (e.g., HeroItem sliding every 8s,
 * Calendar scroll-spy, Search carousel swipe) from the main React component tree.
 * Only `GlobalBackground` subscribes to the values, while views only call the stable setters.
 * Result: 0 re-renders in App, HomeView, SearchView, or CinematicRow when the background changes!
 */

interface AmbientState {
  heroBackground: string | null;
  contextualBackground: string | null;
}

class AmbientStore {
  private state: AmbientState = {
    heroBackground: null,
    contextualBackground: null,
  };
  private listeners = new Set<() => void>();

  public getState = (): AmbientState => this.state;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public setHeroBackground = (path: string | null): void => {
    if (this.state.heroBackground === path) return;
    this.state = { ...this.state, heroBackground: path };
    this.emit();
  };

  public setContextualBackground = (path: string | null): void => {
    if (this.state.contextualBackground === path) return;
    this.state = { ...this.state, contextualBackground: path };
    this.emit();
  };

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

const defaultAmbientStore = new AmbientStore();

const AmbientContext = createContext<AmbientStore>(defaultAmbientStore);

export const AmbientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AmbientContext.Provider value={defaultAmbientStore}>
      {children}
    </AmbientContext.Provider>
  );
};

/**
 * Used by views (HomeView, SearchView, CalendarView) to update background WITHOUT subscribing to re-renders.
 */
export function useAmbientActions() {
  const store = useContext(AmbientContext);
  return {
    setHeroBackground: store.setHeroBackground,
    setContextualBackground: store.setContextualBackground,
  };
}

/**
 * Used ONLY by GlobalBackground to subscribe to active image path updates.
 */
export function useActiveAmbientImage(): string | null {
  const store = useContext(AmbientContext);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return state.contextualBackground || state.heroBackground;
}
