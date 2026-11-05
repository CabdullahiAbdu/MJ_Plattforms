import React, { createContext, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { MediaItem, MediaType, resolveMediaType, toMediaKey } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useConfig } from './ConfigContext';
import {
  saveWatchlistItemFirestore,
  deleteWatchlistItemFirestore,
  saveWatchProgressFirestore,
  mergeLocalLibraryIntoFirestore,
  subscribeToUserLibraryRealtime,
  syncFullLibrarySnapshotToCloud,
  toFirestoreMediaKey,
  resetWriteQuotaCooldown,
} from '../services/firebase';

const STORAGE_KEY_WATCHLIST = 'tmdb_watchlist_v1';
const STORAGE_KEY_WATCHED_EPISODES = 'tmdb_watched_episodes_v1';
const STORAGE_KEY_WATCHED_MOVIES = 'tmdb_watched_movies_v1';
const STORAGE_KEY_WATCHED_SHOWS_FULL = 'tmdb_watched_shows_full_v1';

export interface LibraryStateContextValue {
  watchlist: MediaItem[];
  watchedEpisodes: Record<number, number[]>;
  watchedMovies: number[];
  manuallyWatchedShows: number[];
  watchedCompositeKeys: Set<string>;
  isInWatchlist: (id: number, type?: MediaType | string) => boolean;
}

export interface LibraryActionsContextValue {
  toggleWatchlist: (
    item: MediaItem,
    onNotify?: (msg: string, type: 'success' | 'info') => void
  ) => void;
  toggleEpisodeWatched: (seriesId: number, episodeId: number) => void;
  toggleMovieWatched: (movieId: number) => void;
  toggleShowFullyWatched: (showId: number) => void;
  exportLibraryJson: () => string;
  importLibraryJson: (rawJson: string) => boolean;
  resetLibraryData: () => void;
}

export type LibraryContextValue = LibraryStateContextValue & LibraryActionsContextValue;

const LibraryStateContext = createContext<LibraryStateContextValue | null>(null);
const LibraryActionsContext = createContext<LibraryActionsContextValue | null>(null);

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useConfig();

  const [watchlist, setWatchlist] = useLocalStorage<MediaItem[]>(STORAGE_KEY_WATCHLIST, []);
  const [watchedEpisodes, setWatchedEpisodes] = useLocalStorage<Record<number, number[]>>(
    STORAGE_KEY_WATCHED_EPISODES,
    {}
  );
  const [watchedMovies, setWatchedMovies] = useLocalStorage<number[]>(
    STORAGE_KEY_WATCHED_MOVIES,
    []
  );
  const [manuallyWatchedShows, setManuallyWatchedShows] = useLocalStorage<number[]>(
    STORAGE_KEY_WATCHED_SHOWS_FULL,
    []
  );

  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;
  const watchedMoviesRef = useRef(watchedMovies);
  watchedMoviesRef.current = watchedMovies;
  const watchedEpisodesRef = useRef(watchedEpisodes);
  watchedEpisodesRef.current = watchedEpisodes;
  const manuallyWatchedShowsRef = useRef(manuallyWatchedShows);
  manuallyWatchedShowsRef.current = manuallyWatchedShows;

  // Tombstone maps so deletions propagate cleanly across devices via /userLibraryVault/{uid}
  const removedWatchlistKeysRef = useRef<Record<string, number>>({});
  const removedMoviesRef = useRef<Record<string, number>>({});
  const removedShowsRef = useRef<Record<string, number>>({});
  const removedEpisodesRef = useRef<Record<string, number>>({});
  const vaultSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAtomicVaultSync = useCallback(
    (
      uid: string,
      overrides?: {
        watchlist?: MediaItem[];
        watchedMovies?: number[];
        manuallyWatchedShows?: number[];
        watchedEpisodes?: Record<number, number[]>;
      }
    ) => {
      if (!uid) return;
      const nextSnapshot = {
        watchlist: overrides?.watchlist ?? watchlistRef.current,
        watchedMovies: overrides?.watchedMovies ?? watchedMoviesRef.current,
        manuallyWatchedShows: overrides?.manuallyWatchedShows ?? manuallyWatchedShowsRef.current,
        watchedEpisodes: overrides?.watchedEpisodes ?? watchedEpisodesRef.current,
        removedWatchlistKeys: { ...removedWatchlistKeysRef.current },
        removedMovies: { ...removedMoviesRef.current },
        removedShows: { ...removedShowsRef.current },
        removedEpisodes: { ...removedEpisodesRef.current },
      };

      if (vaultSyncTimerRef.current) {
        clearTimeout(vaultSyncTimerRef.current);
        vaultSyncTimerRef.current = null;
      }
      syncFullLibrarySnapshotToCloud(uid, nextSnapshot).catch((e) =>
        console.error('Atomic vault sync error:', e)
      );
    },
    []
  );

  // Production Real-Time Multi-Device Account Sync:
  // 1. On account login / boot, merges any local device items with the account's cloud state
  //    (/userLibraryVault/{uid} + Firestore Subcollections + Server Sync Vault).
  // 2. Subscribes in real time so changes on any device or URL (ais-dev, ais-pre, iPhone, Hisense TV)
  //    appear across all devices immediately.
  useEffect(() => {
    if (!currentUser?.uid) {
      return;
    }

    const uid = currentUser.uid;
    let cancelled = false;

    const performFullMerge = async () => {
      try {
        resetWriteQuotaCooldown();
        const merged = await mergeLocalLibraryIntoFirestore(
          uid,
          watchlistRef.current,
          watchedMoviesRef.current,
          watchedEpisodesRef.current,
          manuallyWatchedShowsRef.current
        );
        if (cancelled) return;
        watchlistRef.current = merged.watchlist;
        watchedMoviesRef.current = merged.watchedMovies;
        manuallyWatchedShowsRef.current = merged.manuallyWatchedShows;
        watchedEpisodesRef.current = merged.watchedEpisodes;
        setWatchlist(merged.watchlist);
        setWatchedMovies(merged.watchedMovies);
        setManuallyWatchedShows(merged.manuallyWatchedShows);
        setWatchedEpisodes(merged.watchedEpisodes);
      } catch (e) {
        console.error('Account library merge error:', e);
      }
    };

    performFullMerge();

    const unsubscribeRealtime = subscribeToUserLibraryRealtime(uid, (remoteSnap: any) => {
      if (cancelled) return;
      if (remoteSnap.removedWatchlistKeys) {
        removedWatchlistKeysRef.current = {
          ...removedWatchlistKeysRef.current,
          ...remoteSnap.removedWatchlistKeys,
        };
      }
      if (remoteSnap.removedMovies) {
        removedMoviesRef.current = {
          ...removedMoviesRef.current,
          ...remoteSnap.removedMovies,
        };
      }
      if (remoteSnap.removedShows) {
        removedShowsRef.current = {
          ...removedShowsRef.current,
          ...remoteSnap.removedShows,
        };
      }
      if (remoteSnap.removedEpisodes) {
        removedEpisodesRef.current = {
          ...removedEpisodesRef.current,
          ...remoteSnap.removedEpisodes,
        };
      }
      watchlistRef.current = remoteSnap.watchlist;
      watchedMoviesRef.current = remoteSnap.watchedMovies;
      manuallyWatchedShowsRef.current = remoteSnap.manuallyWatchedShows;
      watchedEpisodesRef.current = remoteSnap.watchedEpisodes;
      setWatchlist(remoteSnap.watchlist);
      setWatchedMovies(remoteSnap.watchedMovies);
      setManuallyWatchedShows(remoteSnap.manuallyWatchedShows);
      setWatchedEpisodes(remoteSnap.watchedEpisodes);
    });

    const onForceSync = () => {
      performFullMerge();
    };
    window.addEventListener('mj:force-library-sync', onForceSync);

    return () => {
      cancelled = true;
      if (vaultSyncTimerRef.current) {
        clearTimeout(vaultSyncTimerRef.current);
        vaultSyncTimerRef.current = null;
      }
      unsubscribeRealtime();
      window.removeEventListener('mj:force-library-sync', onForceSync);
    };
  }, [currentUser?.uid, setWatchlist, setWatchedMovies, setManuallyWatchedShows, setWatchedEpisodes]);

  // O(1) Watchlist Lookup Set for fast card rendering without O(N) array scans on every card
  const watchlistKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const w of watchlist) {
      if (w && w.id) {
        const itemType: MediaType = resolveMediaType(w) === 'tv' ? 'tv' : 'movie';
        set.add(toMediaKey(w.id, itemType));
      }
    }
    return set;
  }, [watchlist]);

  const isInWatchlist = useCallback(
    (id: number, type?: MediaType | string): boolean => {
      const targetType: MediaType = type === 'tv' ? 'tv' : 'movie';
      return watchlistKeySet.has(toMediaKey(id, targetType));
    },
    [watchlistKeySet]
  );

  const toggleWatchlist = useCallback(
    (item: MediaItem, onNotify?: (msg: string, type: 'success' | 'info') => void) => {
      const normalizedType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
      const nowMs = Date.now();
      const normalizedItem: MediaItem = {
        ...item,
        media_type: normalizedType,
        ...({ _addedAtMs: nowMs } as any),
      };
      const mediaKey = toFirestoreMediaKey(normalizedItem.id, normalizedType);

      const currentWl = watchlistRef.current;
      const exists = currentWl.some(
        (w) => w.id === normalizedItem.id && resolveMediaType(w) === normalizedType
      );

      if (exists) {
        onNotify?.('Aus Watchlist entfernt', 'info');
        removedWatchlistKeysRef.current[mediaKey] = nowMs;
        const nextWl = currentWl.filter(
          (w) => !(w.id === normalizedItem.id && resolveMediaType(w) === normalizedType)
        );
        watchlistRef.current = nextWl;
        setWatchlist(nextWl);
        if (currentUser?.uid) {
          scheduleAtomicVaultSync(currentUser.uid, { watchlist: nextWl });
          deleteWatchlistItemFirestore(currentUser.uid, normalizedItem.id, normalizedType).catch(
            (e) => console.error('Cloud watchlist delete failed:', e)
          );
        }
      } else {
        onNotify?.('Zur Watchlist hinzugefügt', 'success');
        delete removedWatchlistKeysRef.current[mediaKey];
        const nextWl = [normalizedItem, ...currentWl];
        watchlistRef.current = nextWl;
        setWatchlist(nextWl);
        if (currentUser?.uid) {
          scheduleAtomicVaultSync(currentUser.uid, { watchlist: nextWl });
          saveWatchlistItemFirestore(currentUser.uid, normalizedItem).catch((e) =>
            console.error('Cloud watchlist save failed:', e)
          );
        }
      }
    },
    [setWatchlist, currentUser?.uid, scheduleAtomicVaultSync]
  );

  const toggleEpisodeWatched = useCallback(
    (seriesId: number, episodeId: number) => {
      setWatchedEpisodes((prev) => {
        const currentList = prev[seriesId] || [];
        const exists = currentList.includes(episodeId);
        const epKey = `${seriesId}:${episodeId}`;
        if (exists) {
          removedEpisodesRef.current[epKey] = Date.now();
        } else {
          delete removedEpisodesRef.current[epKey];
        }
        const newList = exists
          ? currentList.filter((id) => id !== episodeId)
          : [...currentList, episodeId];
        const nextMap = { ...prev, [seriesId]: newList };
        watchedEpisodesRef.current = nextMap;

        if (currentUser?.uid) {
          const isFull = manuallyWatchedShowsRef.current.includes(seriesId);
          scheduleAtomicVaultSync(currentUser.uid, { watchedEpisodes: nextMap });
          saveWatchProgressFirestore(
            currentUser.uid,
            seriesId,
            'tv',
            isFull,
            newList
          ).catch((e) => console.error('Cloud episode progress save failed:', e));
        }

        return nextMap;
      });
    },
    [setWatchedEpisodes, currentUser?.uid, scheduleAtomicVaultSync]
  );

  const toggleMovieWatched = useCallback(
    (movieId: number) => {
      setWatchedMovies((prev) => {
        const exists = prev.includes(movieId);
        const nextCompleted = !exists;
        if (nextCompleted) {
          delete removedMoviesRef.current[String(movieId)];
        } else {
          removedMoviesRef.current[String(movieId)] = Date.now();
        }
        const nextList = exists ? prev.filter((id) => id !== movieId) : [...prev, movieId];
        watchedMoviesRef.current = nextList;

        if (currentUser?.uid) {
          scheduleAtomicVaultSync(currentUser.uid, { watchedMovies: nextList });
          saveWatchProgressFirestore(
            currentUser.uid,
            movieId,
            'movie',
            nextCompleted,
            []
          ).catch((e) => console.error('Cloud movie progress save failed:', e));
        }

        return nextList;
      });
    },
    [setWatchedMovies, currentUser?.uid, scheduleAtomicVaultSync]
  );

  const toggleShowFullyWatched = useCallback(
    (showId: number) => {
      setManuallyWatchedShows((prev) => {
        const exists = prev.includes(showId);
        const nextCompleted = !exists;
        if (nextCompleted) {
          delete removedShowsRef.current[String(showId)];
        } else {
          removedShowsRef.current[String(showId)] = Date.now();
        }
        const nextList = exists ? prev.filter((id) => id !== showId) : [...prev, showId];
        manuallyWatchedShowsRef.current = nextList;

        if (currentUser?.uid) {
          const eps = watchedEpisodesRef.current[showId] || [];
          scheduleAtomicVaultSync(currentUser.uid, { manuallyWatchedShows: nextList });
          saveWatchProgressFirestore(
            currentUser.uid,
            showId,
            'tv',
            nextCompleted,
            eps
          ).catch((e) => console.error('Cloud show progress save failed:', e));
        }

        return nextList;
      });
    },
    [setManuallyWatchedShows, currentUser?.uid, scheduleAtomicVaultSync]
  );

  const watchedCompositeKeys = useMemo(() => {
    const keys = new Set<string>();
    watchedMovies.forEach((id) => keys.add(toMediaKey(id, 'movie')));
    manuallyWatchedShows.forEach((id) => keys.add(toMediaKey(id, 'tv')));
    Object.keys(watchedEpisodes).forEach((id) => {
      if ((watchedEpisodes[Number(id)]?.length || 0) > 0) {
        keys.add(toMediaKey(Number(id), 'tv'));
      }
    });
    return keys;
  }, [watchedMovies, manuallyWatchedShows, watchedEpisodes]);

  const exportLibraryJson = useCallback((): string => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      watchlist: watchlistRef.current,
      watchedMovies: watchedMoviesRef.current,
      watchedEpisodes: watchedEpisodesRef.current,
      manuallyWatchedShows: manuallyWatchedShowsRef.current,
    };
    return JSON.stringify(payload, null, 2);
  }, []);

  const importLibraryJson = useCallback(
    (rawJson: string): boolean => {
      try {
        const parsed = JSON.parse(rawJson);
        if (!parsed || typeof parsed !== 'object') return false;
        const nextWatchlist = Array.isArray(parsed.watchlist)
          ? parsed.watchlist
          : watchlistRef.current;
        const nextMovies = Array.isArray(parsed.watchedMovies)
          ? parsed.watchedMovies
          : watchedMoviesRef.current;
        const nextEps =
          parsed.watchedEpisodes && typeof parsed.watchedEpisodes === 'object'
            ? parsed.watchedEpisodes
            : watchedEpisodesRef.current;
        const nextShows = Array.isArray(parsed.manuallyWatchedShows)
          ? parsed.manuallyWatchedShows
          : manuallyWatchedShowsRef.current;

        setWatchlist(nextWatchlist);
        setWatchedMovies(nextMovies);
        setWatchedEpisodes(nextEps);
        setManuallyWatchedShows(nextShows);

        if (currentUser?.uid) {
          mergeLocalLibraryIntoFirestore(
            currentUser.uid,
            nextWatchlist,
            nextMovies,
            nextEps,
            nextShows
          ).catch((e) => console.error('Cloud import sync failed:', e));
        }
        return true;
      } catch (e) {
        console.error('Failed to import library JSON:', e);
        return false;
      }
    },
    [setWatchlist, setWatchedMovies, setWatchedEpisodes, setManuallyWatchedShows, currentUser?.uid]
  );

  const resetLibraryData = useCallback(() => {
    const oldWatchlist = [...watchlistRef.current];
    const nowMs = Date.now();
    oldWatchlist.forEach((item) => {
      const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
      removedWatchlistKeysRef.current[toFirestoreMediaKey(item.id, mType)] = nowMs;
    });

    setWatchlist([]);
    setWatchedMovies([]);
    setWatchedEpisodes({});
    setManuallyWatchedShows([]);

    if (currentUser?.uid) {
      scheduleAtomicVaultSync(currentUser.uid, {
        watchlist: [],
        watchedMovies: [],
        manuallyWatchedShows: [],
        watchedEpisodes: {},
      });
      oldWatchlist.forEach((item) => {
        const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
        deleteWatchlistItemFirestore(currentUser.uid, item.id, mType).catch(() => {});
      });
    }
  }, [
    setWatchlist,
    setWatchedMovies,
    setWatchedEpisodes,
    setManuallyWatchedShows,
    currentUser?.uid,
    scheduleAtomicVaultSync,
  ]);

  const stateValue = useMemo<LibraryStateContextValue>(
    () => ({
      watchlist,
      watchedEpisodes,
      watchedMovies,
      manuallyWatchedShows,
      watchedCompositeKeys,
      isInWatchlist,
    }),
    [
      watchlist,
      watchedEpisodes,
      watchedMovies,
      manuallyWatchedShows,
      watchedCompositeKeys,
      isInWatchlist,
    ]
  );

  const actionsValue = useMemo<LibraryActionsContextValue>(
    () => ({
      toggleWatchlist,
      toggleEpisodeWatched,
      toggleMovieWatched,
      toggleShowFullyWatched,
      exportLibraryJson,
      importLibraryJson,
      resetLibraryData,
    }),
    [
      toggleWatchlist,
      toggleEpisodeWatched,
      toggleMovieWatched,
      toggleShowFullyWatched,
      exportLibraryJson,
      importLibraryJson,
      resetLibraryData,
    ]
  );

  return (
    <LibraryActionsContext.Provider value={actionsValue}>
      <LibraryStateContext.Provider value={stateValue}>{children}</LibraryStateContext.Provider>
    </LibraryActionsContext.Provider>
  );
};

export function useLibraryState(): LibraryStateContextValue {
  const ctx = useContext(LibraryStateContext);
  if (!ctx) throw new Error('useLibraryState must be used within a LibraryProvider');
  return ctx;
}

export function useLibraryActions(): LibraryActionsContextValue {
  const ctx = useContext(LibraryActionsContext);
  if (!ctx) throw new Error('useLibraryActions must be used within a LibraryProvider');
  return ctx;
}

export function useLibrary(): LibraryContextValue {
  const state = useLibraryState();
  const actions = useLibraryActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
