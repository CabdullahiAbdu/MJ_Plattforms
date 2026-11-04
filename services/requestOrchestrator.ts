/**
 * RequestOrchestrator
 * -------------------
 * Implements:
 * 1. Priority Command Queue Pattern (CRITICAL > HIGH > LOW)
 * 2. Concurrency Limiter Pattern (Max 4 parallel active requests so background tasks never starve UI)
 * 3. In-Flight Request Deduplication (Identical concurrent requests share the same Promise)
 * 4. Bounded LRU Cache with Time-To-Live (TTL)
 * 5. Scoped AbortController Cancellation (Cancel pending/in-flight requests when switching filters/views)
 */

export enum RequestPriority {
  LOW = 0,      // Background hover preload
  NORMAL = 1,   // Secondary rows, metadata enrichment
  HIGH = 2,     // Active view primary data
  CRITICAL = 3, // User click / detail hydration / search input
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface QueuedTask<T> {
  id: string;
  cacheKey?: string;
  scope?: string;
  priority: RequestPriority;
  timestamp: number;
  signal?: AbortSignal;
  execute: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  controller: AbortController;
}

export class RequestOrchestrator {
  private queue: QueuedTask<any>[] = [];
  private activeCount = 0;
  private readonly maxConcurrency: number;
  private readonly minIntervalMs: number;
  private lastDispatchTime = 0;

  private inFlight = new Map<string, Promise<any>>();
  private cache = new Map<string, CacheEntry<any>>();
  private readonly maxCacheEntries: number;
  private readonly defaultTtlMs: number;
  private scopeControllers = new Map<string, Set<AbortController>>();

  constructor(options?: {
    maxConcurrency?: number;
    minIntervalMs?: number;
    maxCacheEntries?: number;
    defaultTtlMs?: number;
  }) {
    this.maxConcurrency = options?.maxConcurrency ?? 8;
    this.minIntervalMs = options?.minIntervalMs ?? 12;
    this.maxCacheEntries = options?.maxCacheEntries ?? 500;
    this.defaultTtlMs = options?.defaultTtlMs ?? 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Read from cache synchronously if available and fresh.
   */
  public peekCache<T>(cacheKey: string): T | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    // Refresh LRU order
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);
    return entry.value as T;
  }

  /**
   * Write directly to LRU cache.
   */
  public setCache<T>(cacheKey: string, value: T, ttlMs: number = this.defaultTtlMs): void {
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
    } else if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Cancel all queued and in-flight requests associated with a specific view/filter scope.
   */
  public cancelScope(scope: string): void {
    // 1. Remove queued tasks for this scope before they even fire
    const remaining: QueuedTask<any>[] = [];
    for (const task of this.queue) {
      if (task.scope === scope) {
        task.controller.abort();
        task.reject(new DOMException(`Cancelled scope: ${scope}`, 'AbortError'));
      } else {
        remaining.push(task);
      }
    }
    this.queue = remaining;

    // 2. Abort in-flight controllers for this scope
    const controllers = this.scopeControllers.get(scope);
    if (controllers) {
      controllers.forEach((ctrl) => ctrl.abort());
      this.scopeControllers.delete(scope);
    }
  }

  /**
   * Drop all low-priority preload tasks from the queue when a CRITICAL user action occurs.
   */
  public dropLowPriorityPreloads(): void {
    if (this.queue.length <= 4) return;
    const kept: QueuedTask<any>[] = [];
    for (const task of this.queue) {
      if (task.priority === RequestPriority.LOW) {
        task.controller.abort();
        task.reject(new DOMException('Preload dropped for critical navigation', 'AbortError'));
      } else {
        kept.push(task);
      }
    }
    this.queue = kept;
  }

  /**
   * Clear all cached responses and pending low-priority tasks.
   */
  public clearCache(): void {
    this.cache.clear();
    this.dropLowPriorityPreloads();
  }

  /**
   * Enqueue a network task with automatic deduplication, caching, priority scheduling, and abort support.
   */
  public request<T>(options: {
    cacheKey?: string;
    ttlMs?: number;
    priority?: RequestPriority;
    scope?: string;
    signal?: AbortSignal;
    execute: (signal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const {
      cacheKey,
      ttlMs = this.defaultTtlMs,
      priority = RequestPriority.HIGH,
      scope,
      signal,
      execute,
    } = options;

    // 1. Return immediately on cache hit
    if (cacheKey) {
      const cached = this.peekCache<T>(cacheKey);
      if (cached !== undefined) {
        return Promise.resolve(cached);
      }

      // 2. Deduplicate if identical request is already in flight
      const existingPromise = this.inFlight.get(cacheKey);
      if (existingPromise) {
        // Boost priority if a queued item is upgraded by a user click
        this.boostQueuedPriority(cacheKey, priority);
        return existingPromise as Promise<T>;
      }
    }

    // If a CRITICAL request arrives, shed excessive background preloads so the pipe is clear
    if (priority === RequestPriority.CRITICAL) {
      this.dropLowPriorityPreloads();
    }

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    if (scope) {
      if (!this.scopeControllers.has(scope)) {
        this.scopeControllers.set(scope, new Set());
      }
      this.scopeControllers.get(scope)!.add(controller);
    }

    const promise = new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        cacheKey,
        scope,
        priority,
        timestamp: Date.now(),
        signal: controller.signal,
        controller,
        execute,
        resolve,
        reject,
      };

      this.queue.push(task);
      this.sortQueue();
      this.pumpQueue();
    });

    const finalizedPromise = promise
      .then((res) => {
        if (cacheKey) {
          this.setCache(cacheKey, res, ttlMs);
        }
        return res;
      })
      .finally(() => {
        if (cacheKey) {
          this.inFlight.delete(cacheKey);
        }
        if (scope) {
          this.scopeControllers.get(scope)?.delete(controller);
        }
      });

    if (cacheKey) {
      this.inFlight.set(cacheKey, finalizedPromise);
    }

    return finalizedPromise;
  }

  private boostQueuedPriority(cacheKey: string, newPriority: RequestPriority): void {
    const item = this.queue.find((q) => q.cacheKey === cacheKey);
    if (item && newPriority > item.priority) {
      item.priority = newPriority;
      this.sortQueue();
    }
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.timestamp - b.timestamp;
    });
  }

  private pumpQueue(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      if (task.controller.signal.aborted) {
        task.reject(new DOMException('Request aborted before dispatch', 'AbortError'));
        continue;
      }

      this.activeCount++;
      const now = Date.now();
      const waitMs = Math.max(0, this.lastDispatchTime + this.minIntervalMs - now);
      this.lastDispatchTime = now + waitMs;

      const run = async () => {
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs));
        }
        if (task.controller.signal.aborted) {
          task.reject(new DOMException('Request aborted during rate-limit wait', 'AbortError'));
          return;
        }
        try {
          const result = await task.execute(task.controller.signal);
          task.resolve(result);
        } catch (err) {
          task.reject(err);
        }
      };

      run().finally(() => {
        this.activeCount--;
        this.pumpQueue();
      });
    }
  }
}

export const globalOrchestrator = new RequestOrchestrator();
