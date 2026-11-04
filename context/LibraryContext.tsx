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
  resetWriteQuotaCooldown,
} from '../services/firebase';

const STORAGE_KEY_WATCHLIST = 'tmdb_watchlist_v1';
const STORAGE_KEY_WATCHED_EPISODES = 'tmdb_watched_episodes_v1';
const STORAGE_KEY_WATCHED_MOVIES = 'tmdb_watched_movies_v1';
const STORAGE_KEY_WATCHED_SHOWS_FULL = 'tmdb_watched_shows_full_v1';

interface LibraryContextValue {
  watchlist: MediaItem[];
  watchedEpisodes: Record<number, number[]>;
  watchedMovies: number[];
  manuallyWatchedShows: number[];
  watchedCompositeKeys: Set<string>;
  isInWatchlist: (id: number, type?: MediaType | string) => boolean;
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

const LibraryContext = createContext<LibraryContextValue | null>(null);

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

  // Production Real-Time Multi-Device Account Sync:
  // 1. On account login / boot, merges any local device items with the account's cloud state (Firestore + Server Vault)
  //    so no device ever loses or hides items created on another device.
  // 2. Subscribes in real time (onSnapshot + Server Sync Vault) so changes on any device appear across all devices.
  useEffect(() => {
    if (!currentUser?.uid) {
      return;
    }

    const uid = currentUser.uid;
    let cancelled = false;
    let initialMergeDone = false;

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
        initialMergeDone = true;
        setWatchlist(merged.watchlist);
        setWatchedMovies(merged.watchedMovies);
        setManuallyWatchedShows(merged.manuallyWatchedShows);
        setWatchedEpisodes(merged.watchedEpisodes);
      } catch (e) {
        console.error('Account library merge error:', e);
        initialMergeDone = true;
      }
    };

    performFullMerge();

    const unsubscribeRealtime = subscribeToUserLibraryRealtime(uid, (remoteSnap) => {
      if (cancelled || !initialMergeDone) return;
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
      unsubscribeRealtime();
      window.removeEventListener('mj:force-library-sync', onForceSync);
    };
  }, [currentUser?.uid, setWatchlist, setWatchedMovies, setManuallyWatchedShows, setWatchedEpisodes]);

  const isInWatchlist = useCallback(
    (id: number, type?: MediaType | string): boolean => {
      const targetType: MediaType = type === 'tv' ? 'tv' : 'movie';
      return watchlist.some((w) => {
        if (w.id !== id) return false;
        const itemType = resolveMediaType(w);
        return itemType === targetType;
      });
    },
    [watchlist]
  );

  const toggleWatchlist = useCallback(
    (item: MediaItem, onNotify?: (msg: string, type: 'success' | 'info') => void) => {
      const normalizedType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
      const normalizedItem: MediaItem = { ...item, media_type: normalizedType };

      const exists = watchlist.some(
        (w) => w.id === normalizedItem.id && resolveMediaType(w) === normalizedType
      );

      if (exists) {
        onNotify?.('Aus Watchlist entfernt', 'info');
        setWatchlist((prev) =>
          prev.filter(
            (w) => !(w.id === normalizedItem.id && resolveMediaType(w) === normalizedType)
          )
        );
        if (currentUser?.uid) {
          deleteWatchlistItemFirestore(currentUser.uid, normalizedItem.id, normalizedType).catch(
            (e) => console.error('Cloud watchlist delete failed:', e)
          );
        }
      } else {
        onNotify?.('Zur Watchlist hinzugefügt', 'success');
        setWatchlist((prev) => [normalizedItem, ...prev]);
        if (currentUser?.uid) {
          saveWatchlistItemFirestore(currentUser.uid, normalizedItem).catch((e) =>
            console.error('Cloud watchlist save failed:', e)
          );
        }
      }
    },
    [watchlist, setWatchlist, currentUser]
  );

  const toggleEpisodeWatched = useCallback(
    (seriesId: number, episodeId: number) => {
      setWatchedEpisodes((prev) => {
        const currentList = prev[seriesId] || [];
        const exists = currentList.includes(episodeId);
        const newList = exists
          ? currentList.filter((id) => id !== episodeId)
          : [...currentList, episodeId];

        if (currentUser?.uid) {
          const isFull = manuallyWatchedShows.includes(seriesId);
          saveWatchProgressFirestore(
            currentUser.uid,
            seriesId,
            'tv',
            isFull,
            newList
          ).catch((e) => console.error('Cloud episode progress save failed:', e));
        }

        return { ...prev, [seriesId]: newList };
      });
    },
    [setWatchedEpisodes, currentUser, manuallyWatchedShows]
  );

  const toggleMovieWatched = useCallback(
    (movieId: number) => {
      setWatchedMovies((prev) => {
        const exists = prev.includes(movieId);
        const nextCompleted = !exists;

        if (currentUser?.uid) {
          saveWatchProgressFirestore(
            currentUser.uid,
            movieId,
            'movie',
            nextCompleted,
            []
          ).catch((e) => console.error('Cloud movie progress save failed:', e));
        }

        return exists ? prev.filter((id) => id !== movieId) : [...prev, movieId];
      });
    },
    [setWatchedMovies, currentUser]
  );

  const toggleShowFullyWatched = useCallback(
    (showId: number) => {
      setManuallyWatchedShows((prev) => {
        const exists = prev.includes(showId);
        const nextCompleted = !exists;

        if (currentUser?.uid) {
          const eps = watchedEpisodes[showId] || [];
          saveWatchProgressFirestore(
            currentUser.uid,
            showId,
            'tv',
            nextCompleted,
            eps
          ).catch((e) => console.error('Cloud show progress save failed:', e));
        }

        return exists ? prev.filter((id) => id !== showId) : [...prev, showId];
      });
    },
    [setManuallyWatchedShows, currentUser, watchedEpisodes]
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
      watchlist,
      watchedMovies,
      watchedEpisodes,
      manuallyWatchedShows,
    };
    return JSON.stringify(payload, null, 2);
  }, [watchlist, watchedMovies, watchedEpisodes, manuallyWatchedShows]);

  const importLibraryJson = useCallback(
    (rawJson: string): boolean => {
      try {
        const parsed = JSON.parse(rawJson);
        if (!parsed || typeof parsed !== 'object') return false;
        const nextWatchlist = Array.isArray(parsed.watchlist) ? parsed.watchlist : watchlist;
        const nextMovies = Array.isArray(parsed.watchedMovies)
          ? parsed.watchedMovies
          : watchedMovies;
        const nextEps =
          parsed.watchedEpisodes && typeof parsed.watchedEpisodes === 'object'
            ? parsed.watchedEpisodes
            : watchedEpisodes;
        const nextShows = Array.isArray(parsed.manuallyWatchedShows)
          ? parsed.manuallyWatchedShows
          : manuallyWatchedShows;

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
    [
      watchlist,
      watchedMovies,
      watchedEpisodes,
      manuallyWatchedShows,
      setWatchlist,
      setWatchedMovies,
      setWatchedEpisodes,
      setManuallyWatchedShows,
      currentUser,
    ]
  );

  const resetLibraryData = useCallback(() => {
    const oldWatchlist = [...watchlist];
    setWatchlist([]);
    setWatchedMovies([]);
    setWatchedEpisodes({});
    setManuallyWatchedShows([]);

    if (currentUser?.uid) {
      oldWatchlist.forEach((item) => {
        const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
        deleteWatchlistItemFirestore(currentUser.uid, item.id, mType).catch(() => {});
      });
    }
  }, [
    watchlist,
    setWatchlist,
    setWatchedMovies,
    setWatchedEpisodes,
    setManuallyWatchedShows,
    currentUser,
  ]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      watchlist,
      watchedEpisodes,
      watchedMovies,
      manuallyWatchedShows,
      watchedCompositeKeys,
      isInWatchlist,
      toggleWatchlist,
      toggleEpisodeWatched,
      toggleMovieWatched,
      toggleShowFullyWatched,
      exportLibraryJson,
      importLibraryJson,
      resetLibraryData,
    }),
    [
      watchlist,
      watchedEpisodes,
      watchedMovies,
      manuallyWatchedShows,
      watchedCompositeKeys,
      isInWatchlist,
      toggleWatchlist,
      toggleEpisodeWatched,
      toggleMovieWatched,
      toggleShowFullyWatched,
      exportLibraryJson,
      importLibraryJson,
      resetLibraryData,
    ]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
};

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}
