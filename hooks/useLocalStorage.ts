import { useState, useCallback, useRef } from 'react';

function coerceToInitialShape<T>(parsed: unknown, initialValue: T): T {
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

/**
 * Stale-closure-safe, schema-validated useLocalStorage hook.
 * Guarantees that corrupted localStorage entries never return wrong types (e.g. null instead of Array)
 * and deduplicates identical JSON writes to prevent render loops from realtime listeners.
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
          const nextSerialized = JSON.stringify(valueToStore);
          const prevSerialized = JSON.stringify(prev);
          if (nextSerialized === prevSerialized) {
            return prev;
          }
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, nextSerialized);
          }
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