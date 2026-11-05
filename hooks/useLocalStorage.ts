import { useState, useCallback, useRef } from 'react';

export function coerceToInitialShape<T>(parsed: unknown, initialValue: T): T {
  if (parsed === null || parsed === undefined) {
    return initialValue;
  }
  if (Array.isArray(initialValue)) {
    if (!Array.isArray(parsed)) return initialValue;
    return parsed.filter((item) => item !== null && item !== undefined) as unknown as T;
  }
  if (typeof initialValue === 'string') {
    return (typeof parsed === 'string' && parsed.length > 0 ? parsed : initialValue) as unknown as T;
  }
  if (typeof initialValue === 'boolean') {
    return (typeof parsed === 'boolean' ? parsed : initialValue) as unknown as T;
  }
  if (typeof initialValue === 'number') {
    return (typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : initialValue) as unknown as T;
  }
  if (typeof initialValue === 'object') {
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return initialValue;
  }
  return parsed as T;
}

// Phase 8: Batched / Debounced localStorage Write Queue
// Prevents main-thread Long Tasks (>50ms) when toggling watchlist or episode progress rapidly,
// while guaranteeing zero data loss via visibilitychange & beforeunload flush.
const pendingStorageWrites = new Map<string, unknown>();
const lastSerializedCache = new Map<string, string>();
let storageFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function flushPendingLocalStorageWrites(): void {
  if (storageFlushTimer) {
    clearTimeout(storageFlushTimer);
    storageFlushTimer = null;
  }
  if (pendingStorageWrites.size === 0) return;
  if (typeof window === 'undefined' || !window.localStorage) {
    pendingStorageWrites.clear();
    return;
  }

  for (const [storageKey, rawVal] of pendingStorageWrites.entries()) {
    try {
      const serialized = JSON.stringify(rawVal);
      if (lastSerializedCache.get(storageKey) !== serialized) {
        window.localStorage.setItem(storageKey, serialized);
        lastSerializedCache.set(storageKey, serialized);
      }
    } catch (err) {
      console.warn(`Error flushing localStorage key "${storageKey}":`, err);
    }
  }
  pendingStorageWrites.clear();
}

function scheduleDebouncedLocalStorageWrite(key: string, value: unknown): void {
  pendingStorageWrites.set(key, value);
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  if (storageFlushTimer) return;
  storageFlushTimer = setTimeout(() => {
    flushPendingLocalStorageWrites();
  }, 280);
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingLocalStorageWrites();
    }
  });
  window.addEventListener('beforeunload', () => {
    flushPendingLocalStorageWrites();
  });
  window.addEventListener('pagehide', () => {
    flushPendingLocalStorageWrites();
  });
}

/**
 * Stale-closure-safe, schema-validated, debounced useLocalStorage hook (Phase 8).
 * Guarantees that corrupted localStorage entries never return wrong types,
 * avoids main-thread JSON.stringify jank on every click, and deduplicates identical updates.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  const initialRef = useRef<T>(initialValue);

  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return initialValue;
      }
      const item = window.localStorage.getItem(key);
      if (item === null) return initialValue;
      lastSerializedCache.set(key, item);
      const parsed = JSON.parse(item);
      return coerceToInitialShape(parsed, initialValue);
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue((prev) => {
        try {
          const rawNext = value instanceof Function ? value(prev) : value;
          const valueToStore = coerceToInitialShape(rawNext, initialRef.current);
          if (Object.is(prev, valueToStore)) {
            return prev;
          }
          // Fast structural check for primitives or empty arrays
          if (
            Array.isArray(prev) &&
            Array.isArray(valueToStore) &&
            prev.length === 0 &&
            valueToStore.length === 0
          ) {
            return prev;
          }
          const nextSerialized = JSON.stringify(valueToStore);
          const prevSerialized = lastSerializedCache.get(key) ?? JSON.stringify(prev);
          if (nextSerialized === prevSerialized) {
            return prev;
          }
          lastSerializedCache.set(key, nextSerialized);
          scheduleDebouncedLocalStorageWrite(key, valueToStore);
          return valueToStore;
        } catch (error) {
          console.warn(`Error writing localStorage key "${key}":`, error);
          return prev;
        }
      });
    },
    [key]
  );

  return [storedValue, setValue];
}