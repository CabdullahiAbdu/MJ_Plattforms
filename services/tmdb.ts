import {
  doc,
  getDoc,
} from 'firebase/firestore';
import {
  MediaItem,
  MediaType,
  MovieDetails,
  TvShowDetails,
  PersonDetails,
  TmdbResponse,
  CreditsResponse,
  Genre,
  WatchProvidersResponse,
  WatchProviderCountryData,
  Video,
  CombinedCredits,
  ExternalIds,
  Review,
  Collection,
  Company,
  Keyword,
  WatchProvider,
  AppView,
  AggregateDetailsResult,
  TmdbImage,
  resolveMediaType,
} from '../types';
import { globalOrchestrator, RequestPriority } from './requestOrchestrator';
import { db } from './firebase';
import firebaseConfig from '../firebase-applet-config.json';

const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const FIRESTORE_WEB_KEY = firebaseConfig.apiKey;
const CLOUD_RUN_SHARED_ORIGIN =
  'https://ais-pre-37sas3mekyso6nio5hh72d-849714710389.europe-west2.run.app';

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = 4500,
  parentSignal?: AbortSignal
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onParentAbort = () => ctrl.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol } = window.location;
  return (
    protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    protocol === 'file:' ||
    Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
    Boolean((window as any).Capacitor?.getPlatform?.() === 'ios')
  );
}

export function resolveApiBaseUrl(pathPrefix: string = '/api/tmdb'): string {
  const customBase = (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');

  const normalizedPrefix = pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`;
  if (customBase) {
    return `${customBase}${normalizedPrefix}`;
  }
  if (isNativePlatform()) {
    return `${CLOUD_RUN_SHARED_ORIGIN}${normalizedPrefix}`;
  }
  return normalizedPrefix;
}

/**
 * Canonicalizes query parameters on the client identically to server.ts so
 * 1,000 concurrent users searching "Dune", "dune ", or "DUNE" always hit the exact same L1/L2 cache key.
 */
export function normalizeClientQueryParamValue(key: string, value: any): string {
  const raw = String(value ?? '').trim();
  if (key === 'query') {
    return raw.toLowerCase().replace(/\s+/g, ' ');
  }
  if (key === 'with_genres' || key === 'with_watch_providers' || key === 'with_keywords') {
    if (raw.includes('|')) {
      return raw
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .join('|');
    }
    if (raw.includes(',')) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .join(',');
    }
  }
  return raw;
}

export function computeDeterministicCacheKey(
  region: string,
  language: string,
  endpoint: string,
  queryObj: Record<string, any>
): string {
  const cleanRegion = (region || 'DE').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'DE';
  const cleanLang = (language || 'de-DE').replace(/[^a-zA-Z\-]/g, '').slice(0, 10) || 'de-DE';
  const cleanEndpoint = endpoint.replace(/^\/+|\/+$/g, '');
  const sortedPairs = Object.keys(queryObj)
    .filter((k) => k !== 'api_key' && queryObj[k] !== undefined && queryObj[k] !== null)
    .sort()
    .map((k) => `${k}=${normalizeClientQueryParamValue(k, queryObj[k])}`)
    .join('&');

  const rawString = `${cleanRegion}|${cleanLang}|${cleanEndpoint}|${sortedPairs}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < rawString.length; i++) {
    const ch = rawString.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x5bd1e995);
  }
  const hex =
    (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  const safePrefix = `${cleanRegion}_${cleanLang}_${cleanEndpoint.replace(/[^a-zA-Z0-9]/g, '_')}`
    .replace(/_+/g, '_')
    .slice(0, 80);

  return `${safePrefix}_${hex}`;
}

function extractBestLogoPath(logos: TmdbImage[] = [], langIso: string): string | null {
  if (!logos || logos.length === 0) return null;
  const valid = logos.filter((l) => l.file_path && !l.file_path.endsWith('.svg'));
  const pool = valid.length > 0 ? valid : logos;

  const byLang = (iso: string | null) =>
    pool
      .filter((l) => l.iso_639_1 === iso)
      .sort(
        (a, b) =>
          (b.vote_average || 0) - (a.vote_average || 0) || (b.width || 0) - (a.width || 0)
      );

  const chosen = byLang(langIso)[0] || byLang('en')[0] || byLang(null)[0] || pool[0];
  return chosen?.file_path || null;
}

function formatRegionalCertification(cert: string, reg: string): string {
  const clean = (cert || '').trim();
  if (!clean) return '';
  if (reg === 'DE' && /^(0|6|12|16|18)$/.test(clean)) {
    return `FSK ${clean}`;
  }
  return clean;
}

function extractCertification(
  raw: any,
  mediaType: 'movie' | 'tv',
  region: string
): string | null {
  if (mediaType === 'movie') {
    const results: any[] = raw.release_dates?.results || [];
    const findForRegion = (reg: string): string | null => {
      const entry = results.find((r) => r.iso_3166_1 === reg);
      if (!entry?.release_dates) return null;
      const match = entry.release_dates.find(
        (d: any) => d.certification && d.certification.trim().length > 0
      );
      return match ? formatRegionalCertification(match.certification, reg) : null;
    };
    return findForRegion(region) || findForRegion('DE') || findForRegion('US') || null;
  } else {
    const results: any[] = raw.content_ratings?.results || [];
    const findForRegion = (reg: string): string | null => {
      const entry = results.find((r) => r.iso_3166_1 === reg);
      return entry?.rating ? formatRegionalCertification(entry.rating, reg) : null;
    };
    return findForRegion(region) || findForRegion('DE') || findForRegion('US') || null;
  }
}

export class TmdbService {
  private apiKey: string;
  private language: string = 'de-DE';
  private region: string = 'DE';
  private includeAdult: boolean = false;
  private dataSaver: boolean = false;

  constructor(
    apiKey: string = 'SERVER_PROXY',
    language: string = 'de-DE',
    region: string = 'DE',
    includeAdult: boolean = false,
    dataSaver: boolean = false
  ) {
    this.apiKey = apiKey || 'SERVER_PROXY';
    this.language = language;
    this.region = region;
    this.includeAdult = includeAdult;
    this.dataSaver = dataSaver;
  }

  public setLanguage(language: string): void {
    this.language = language;
  }

  public getLanguage(): string {
    return this.language;
  }

  public setRegion(region: string): void {
    this.region = region;
  }

  public getRegion(): string {
    return this.region;
  }

  public setIncludeAdult(include: boolean): void {
    this.includeAdult = include;
  }

  public setDataSaver(dataSaver: boolean): void {
    this.dataSaver = dataSaver;
  }

  public getDataSaver(): boolean {
    return this.dataSaver;
  }

  public cancelScope(scope: string): void {
    globalOrchestrator.cancelScope(scope);
  }

  public clearCache(): void {
    globalOrchestrator.clearCache();
  }

  public peekAggregateDetails(
    id: number,
    type: MediaType | string,
    view: AppView = AppView.DETAILS
  ): AggregateDetailsResult | undefined {
    const cacheKey = this.getAggregateCacheKey(id, type, view);
    return globalOrchestrator.peekCache<AggregateDetailsResult>(cacheKey);
  }

  private getAggregateCacheKey(id: number, type: MediaType | string, view: AppView): string {
    return `agg:${this.language}:${this.region}:${view}:${type}:${id}`;
  }

  // --- CORE ORCHESTRATED ZERO-CREDENTIAL PROXY FETCH (HTTP + DIRECT FIRESTORE REST L2 BRIDGE) ---

  private enqueueBackgroundRefreshRest(
    cacheKey: string,
    cleanEndpoint: string,
    queryObj: Record<string, string>,
    safeRegion: string,
    safeLanguage: string
  ): void {
    const now = Date.now();
    const queueUrl = `${FIRESTORE_REST_BASE}/tmdbProxyQueue/${encodeURIComponent(cacheKey)}?key=${encodeURIComponent(FIRESTORE_WEB_KEY)}`;
    fetch(queueUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          requestId: { stringValue: cacheKey },
          cacheKey: { stringValue: cacheKey },
          endpoint: { stringValue: cleanEndpoint.slice(0, 200) },
          queryJson: { stringValue: JSON.stringify(queryObj).slice(0, 1000) },
          region: { stringValue: safeRegion },
          language: { stringValue: safeLanguage },
          status: { stringValue: 'pending' },
          statusCode: { integerValue: '0' },
          responseJson: { stringValue: '' },
          createdAt: { integerValue: String(now) },
          updatedAt: { integerValue: String(now) },
        },
      }),
    }).catch(() => {});
  }

  private async fetchViaFirestoreProxyBridge<T>(
    cleanEndpoint: string,
    queryObj: Record<string, string>,
    signal?: AbortSignal
  ): Promise<T> {
    const safeRegion =
      (this.region || 'DE').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'DE';
    const safeLanguage =
      (this.language || 'de-DE').replace(/[^a-zA-Z\-]/g, '').slice(0, 10) || 'de-DE';
    const cacheKey = computeDeterministicCacheKey(
      safeRegion,
      safeLanguage,
      cleanEndpoint,
      queryObj
    );

    const cacheRestUrl = `${FIRESTORE_REST_BASE}/regionalCache/${encodeURIComponent(cacheKey)}?key=${encodeURIComponent(FIRESTORE_WEB_KEY)}`;
    const queueRestUrl = `${FIRESTORE_REST_BASE}/tmdbProxyQueue/${encodeURIComponent(cacheKey)}?key=${encodeURIComponent(FIRESTORE_WEB_KEY)}`;

    // 1. Ultra-Fast Direct REST Read from Shared L2 Regional Cache (/regionalCache/{cacheKey})
    try {
      const restRes = await fetchWithTimeout(cacheRestUrl, { method: 'GET' }, 4000, signal);
      if (restRes.ok) {
        const docJson = await restRes.json();
        const payloadJson = docJson?.fields?.payloadJson?.stringValue;
        const expiresAt = Number(
          docJson?.fields?.expiresAt?.integerValue ||
            docJson?.fields?.expiresAt?.doubleValue ||
            0
        );
        if (typeof payloadJson === 'string' && payloadJson.length >= 2) {
          const parsed = JSON.parse(payloadJson) as T;
          if (expiresAt <= Date.now()) {
            this.enqueueBackgroundRefreshRest(
              cacheKey,
              cleanEndpoint,
              queryObj,
              safeRegion,
              safeLanguage
            );
          }
          return parsed;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' && signal?.aborted) {
        throw err;
      }
      try {
        const snap = await Promise.race([
          getDoc(doc(db, 'regionalCache', cacheKey)),
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ]);
        if (snap && snap.exists()) {
          const d = snap.data();
          if (typeof d?.payloadJson === 'string' && d.payloadJson.length >= 2) {
            return JSON.parse(d.payloadJson) as T;
          }
        }
      } catch {
        // continue to queue
      }
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // 2. Cache Miss: Enqueue request in /tmdbProxyQueue/{cacheKey} via Direct REST PATCH
    const now = Date.now();
    await fetchWithTimeout(
      queueRestUrl,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            requestId: { stringValue: cacheKey },
            cacheKey: { stringValue: cacheKey },
            endpoint: { stringValue: cleanEndpoint.slice(0, 200) },
            queryJson: { stringValue: JSON.stringify(queryObj).slice(0, 1000) },
            region: { stringValue: safeRegion },
            language: { stringValue: safeLanguage },
            status: { stringValue: 'pending' },
            statusCode: { integerValue: '0' },
            responseJson: { stringValue: '' },
            createdAt: { integerValue: String(now) },
            updatedAt: { integerValue: String(now) },
          },
        }),
      },
      4500,
      signal
    );

    // 3. Poll /tmdbProxyQueue/{cacheKey} (and /regionalCache/{cacheKey}) via Direct REST GET
    const maxAttempts = 28;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      await new Promise((r) => setTimeout(r, attempt < 4 ? 220 : 350));
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      try {
        const pollRes = await fetchWithTimeout(queueRestUrl, { method: 'GET' }, 3000, signal);
        if (pollRes.ok) {
          const qDoc = await pollRes.json();
          const status = qDoc?.fields?.status?.stringValue;
          const responseJson = qDoc?.fields?.responseJson?.stringValue;
          const statusCode = Number(qDoc?.fields?.statusCode?.integerValue || 500);

          if (status === 'completed' && typeof responseJson === 'string' && responseJson.length >= 2) {
            fetch(queueRestUrl, { method: 'DELETE' }).catch(() => {});
            return JSON.parse(responseJson) as T;
          }
          if (status === 'error') {
            fetch(queueRestUrl, { method: 'DELETE' }).catch(() => {});
            throw new Error(`Server Proxy Error (${statusCode})`);
          }
        } else if (pollRes.status === 404 && attempt >= 1) {
          const cRes = await fetchWithTimeout(cacheRestUrl, { method: 'GET' }, 3000, signal);
          if (cRes.ok) {
            const cDoc = await cRes.json();
            const payloadJson = cDoc?.fields?.payloadJson?.stringValue;
            if (typeof payloadJson === 'string' && payloadJson.length >= 2) {
              return JSON.parse(payloadJson) as T;
            }
          }
        }
      } catch (pollErr: any) {
        if (pollErr?.name === 'AbortError' && signal?.aborted) {
          throw pollErr;
        }
        if (String(pollErr?.message || '').startsWith('Server Proxy Error')) {
          throw pollErr;
        }
      }
    }

    throw new Error('TMDB Server Proxy timeout.');
  }

  private async fetch<T>(
    endpoint: string,
    params: Record<string, string> = {},
    options?: {
      method?: 'GET' | 'POST';
      body?: any;
      priority?: RequestPriority;
      scope?: string;
      signal?: AbortSignal;
      ttlMs?: number;
      skipCache?: boolean;
    }
  ): Promise<T> {
    const method = options?.method ?? 'GET';
    const priority = options?.priority ?? RequestPriority.HIGH;

    const queryObj: Record<string, string> = {
      language: this.language,
      include_adult: this.includeAdult.toString(),
      ...params,
    };

    const sortedParamStr = Object.keys(queryObj)
      .sort()
      .map((k) => `${k}=${normalizeClientQueryParamValue(k, queryObj[k])}`)
      .join('&');

    const cacheKey =
      method === 'GET' && !options?.skipCache
        ? `tmdb:${this.region}:${this.language}:${endpoint}?${sortedParamStr}`
        : undefined;

    return globalOrchestrator.request<T>({
      cacheKey,
      ttlMs: options?.ttlMs,
      priority,
      scope: options?.scope,
      signal: options?.signal,
      execute: async (signal: AbortSignal) => {
        const cleanEndpoint = endpoint.replace(/^\/+/, '');
        const isNative = isNativePlatform();
        const customApiBase = (
          (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
          ''
        ).trim();

        if (isNative && !customApiBase && method === 'GET') {
          return await this.fetchViaFirestoreProxyBridge<T>(cleanEndpoint, queryObj, signal);
        }

        const queryParams = new URLSearchParams(queryObj);
        const proxyBase = resolveApiBaseUrl('/api/tmdb');
        const url = `${proxyBase}/${cleanEndpoint}?${queryParams.toString()}`;

        const reqInit: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-app-region': this.region,
          },
          signal,
        };

        if (options?.body) {
          reqInit.body = JSON.stringify(options.body);
        }

        try {
          const response = await fetch(url, reqInit);
          const contentType = response.headers.get('content-type') || '';

          if (
            method === 'GET' &&
            (response.redirected || !contentType.includes('application/json'))
          ) {
            return await this.fetchViaFirestoreProxyBridge<T>(cleanEndpoint, queryObj, signal);
          }

          if (!response.ok) {
            let message = response.statusText || 'Unknown Error';
            try {
              const errorData = await response.json();
              if (errorData && errorData.status_message) {
                message = errorData.status_message;
              }
            } catch {
              // ignore JSON parse failure
            }
            throw new Error(`TMDB Error (${response.status}): ${message}`);
          }

          return await response.json();
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          if (method === 'GET') {
            return await this.fetchViaFirestoreProxyBridge<T>(cleanEndpoint, queryObj, signal);
          }
          throw err;
        }
      },
    });
  }

  // --- GUEST SESSION & RATINGS ---

  private async getGuestSession(): Promise<string> {
    const KEY = 'tmdb_guest_session_v1';
    let sessionId = localStorage.getItem(KEY);

    if (!sessionId) {
      const data = await this.fetch<{ guest_session_id: string; success: boolean }>(
        '/authentication/guest_session/new',
        {},
        { priority: RequestPriority.CRITICAL, skipCache: true }
      );
      if (data.success) {
        sessionId = data.guest_session_id;
        localStorage.setItem(KEY, sessionId);
      }
    }
    return sessionId!;
  }

  async rateMedia(id: number, type: 'movie' | 'tv', value: number): Promise<boolean> {
    try {
      const sessionId = await this.getGuestSession();
      await this.fetch<{ status_code: number; status_message: string }>(
        `/${type}/${id}/rating`,
        { guest_session_id: sessionId },
        {
          method: 'POST',
          body: { value },
          priority: RequestPriority.CRITICAL,
          skipCache: true,
        }
      );
      return true;
    } catch (e) {
      console.error('Failed to rate media', e);
      return false;
    }
  }

  async getAccountStates(
    id: number,
    type: 'movie' | 'tv'
  ): Promise<{ rated: { value: number } | boolean }> {
    try {
      const sessionId = localStorage.getItem('tmdb_guest_session_v1');
      if (!sessionId) return { rated: false };
      return await this.fetch(
        `/${type}/${id}/account_states`,
        { guest_session_id: sessionId },
        { priority: RequestPriority.NORMAL, skipCache: true }
      );
    } catch {
      return { rated: false };
    }
  }

  // --- SINGLE-CALL AGGREGATE DETAILS (append_to_response) ---

  preloadDetails(id: number, type: MediaType | string, view: AppView = AppView.DETAILS): void {
    this.getAggregateDetails(id, type, view, RequestPriority.LOW).catch(() => {});
  }

  async enrichHeroItems(items: MediaItem[]): Promise<MediaItem[]> {
    const langIso = (this.language || 'de-DE').split('-')[0].toLowerCase();
    const enriched = await Promise.all(
      items.map(async (item) => {
        if (item.logo_path !== undefined && item.certification !== undefined) {
          return item;
        }
        const mediaType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
        const cachedAgg = this.peekAggregateDetails(item.id, mediaType, AppView.DETAILS);
        if (cachedAgg) {
          return {
            ...item,
            logo_path: cachedAgg.logoPath ?? null,
            certification: cachedAgg.certification ?? null,
          };
        }
        try {
          const append =
            mediaType === 'tv' ? 'images,content_ratings' : 'images,release_dates';
          const raw = await this.fetch<any>(
            `/${mediaType}/${item.id}`,
            {
              append_to_response: append,
              include_image_language: `${langIso},en,null`,
            },
            { priority: RequestPriority.LOW, ttlMs: 15 * 60 * 1000 }
          );
          const logo_path = extractBestLogoPath(raw.images?.logos || [], langIso);
          const certification = extractCertification(raw, mediaType, this.region);
          return {
            ...item,
            logo_path,
            certification,
          };
        } catch {
          return item;
        }
      })
    );
    return enriched;
  }

  async getAggregateDetails(
    id: number,
    type: MediaType | string,
    view: AppView = AppView.DETAILS,
    priority: RequestPriority = RequestPriority.CRITICAL
  ): Promise<AggregateDetailsResult> {
    const cacheKey = this.getAggregateCacheKey(id, type, view);
    const cached = globalOrchestrator.peekCache<AggregateDetailsResult>(cacheKey);
    if (cached) return cached;

    if (view === AppView.PERSON || type === 'person') {
      const raw = await this.fetch<
        PersonDetails & {
          combined_credits?: CombinedCredits;
          external_ids?: ExternalIds;
          images?: { profiles?: TmdbImage[] };
        }
      >(
        `/person/${id}`,
        { append_to_response: 'combined_credits,external_ids,images' },
        { priority, ttlMs: 10 * 60 * 1000 }
      );

      raw.media_type = 'person';
      const credits = raw.combined_credits || { cast: [], crew: [] };

      const seen = new Map<number, any>();
      [...(credits.cast || []), ...(credits.crew || [])].forEach((c) => {
        if (!seen.has(c.id)) {
          seen.set(c.id, { ...c, roles: new Set<string>() });
        }
        const entry = seen.get(c.id);
        if (c.character) entry.roles.add('Acted');
        if (c.job) entry.roles.add(c.job);
      });

      const sortedCredits = Array.from(seen.values())
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .map((item) => {
          item.display_role = Array.from(item.roles).slice(0, 2).join(' • ');
          return item as MediaItem;
        });

      const personProfiles = (raw.images?.profiles || []).slice(0, 16);

      const result: AggregateDetailsResult = {
        item: raw,
        combinedCredits: sortedCredits,
        externalIds: raw.external_ids || {},
        personProfiles,
        backdrops: personProfiles,
        loading: false,
      };
      globalOrchestrator.setCache(cacheKey, result, 10 * 60 * 1000);
      return result;
    }

    if (view === AppView.COLLECTION || type === 'collection') {
      const [details, collectionImgs] = await Promise.all([
        this.getCollectionDetails(id, priority),
        this.getCollectionImages(id, priority).catch(() => ({ backdrops: [], posters: [] })),
      ]);
      if (details.parts) {
        details.parts = details.parts
          .map((p) => ({ ...p, media_type: 'movie' as MediaType }))
          .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));
      }
      const result: AggregateDetailsResult = {
        item: details,
        collectionParts: details.parts,
        backdrops: (collectionImgs.backdrops || []).slice(0, 16),
        loading: false,
      };
      globalOrchestrator.setCache(cacheKey, result, 10 * 60 * 1000);
      return result;
    }

    if (view === AppView.COMPANY || type === 'company') {
      const [details, movies] = await Promise.all([
        this.getCompanyDetails(id, priority),
        this.getMoviesByCompany(id, 1, priority),
      ]);
      const result: AggregateDetailsResult = {
        item: details,
        companyMovies: movies.results,
        loading: false,
      };
      globalOrchestrator.setCache(cacheKey, result, 10 * 60 * 1000);
      return result;
    }

    const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
    const langIso = (this.language || 'de-DE').split('-')[0].toLowerCase();
    const appendFields =
      mediaType === 'tv'
        ? 'credits,aggregate_credits,videos,watch/providers,recommendations,similar,reviews,keywords,external_ids,images,content_ratings,season/1'
        : 'credits,videos,watch/providers,recommendations,similar,reviews,keywords,external_ids,images,release_dates';

    const raw = await this.fetch<any>(
      `/${mediaType}/${id}`,
      {
        append_to_response: appendFields,
        include_image_language: `${langIso},en,null`,
      },
      { priority, ttlMs: 10 * 60 * 1000 }
    );

    raw.media_type = mediaType;

    const logoPath = extractBestLogoPath(raw.images?.logos || [], langIso);
    const certification = extractCertification(raw, mediaType, this.region);
    raw.logo_path = logoPath;
    raw.certification = certification;

    const rawBackdrops: TmdbImage[] = raw.images?.backdrops || [];
    const backdrops: TmdbImage[] = rawBackdrops
      .filter((b) => b.file_path && (b.aspect_ratio || 1.77) >= 1.5)
      .sort((a, b) => {
        const aNull = a.iso_639_1 === null ? 1 : 0;
        const bNull = b.iso_639_1 === null ? 1 : 0;
        if (aNull !== bNull) return bNull - aNull;
        return (b.vote_average || 0) - (a.vote_average || 0);
      })
      .slice(0, 16);

    let credits: CreditsResponse | null = raw.credits || null;
    if (mediaType === 'tv' && raw.aggregate_credits?.cast?.length) {
      credits = {
        id: raw.id,
        cast: raw.aggregate_credits.cast.slice(0, 40).map((c: any) => ({
          id: c.id,
          name: c.name,
          character: c.roles?.[0]?.character || c.character || '',
          profile_path: c.profile_path || null,
          order: c.order ?? 999,
          total_episode_count: c.total_episode_count,
        })),
        crew: (raw.aggregate_credits.crew || raw.credits?.crew || []).slice(0, 35).map((c: any) => ({
          id: c.id,
          name: c.name,
          job: c.jobs?.[0]?.job || c.job || c.department || '',
          department: c.department || '',
          profile_path: c.profile_path || null,
        })),
      };
    }

    const videos: Video[] = (raw.videos?.results || []).filter((v: Video) => v.site === 'YouTube');
    const providersAll: WatchProvidersResponse | undefined = raw['watch/providers'];

    const providers: WatchProviderCountryData | null =
      providersAll?.results?.[this.region] || null;

    const recommendations: MediaItem[] = (raw.recommendations?.results || []).map(
      (i: MediaItem) => ({
        ...i,
        media_type: i.media_type || mediaType,
      })
    );

    const similar: MediaItem[] = (raw.similar?.results || []).map((i: MediaItem) => ({
      ...i,
      media_type: i.media_type || mediaType,
    }));

    const reviews: Review[] = raw.reviews?.results || [];
    const keywords: Keyword[] = raw.keywords?.keywords || raw.keywords?.results || [];
    const externalIds: ExternalIds = raw.external_ids || {};

    let firstSeasonData = raw['season/1'] || null;
    if (mediaType === 'tv' && !firstSeasonData && raw.seasons?.length > 0) {
      const fallbackSeason =
        raw.seasons.find((s: any) => s.season_number === 1) || raw.seasons[0];
      if (fallbackSeason) {
        firstSeasonData = await this.getSeasonDetails(
          id,
          fallbackSeason.season_number,
          priority
        ).catch(() => null);
      }
    }

    const initialSeasonNum = firstSeasonData?.season_number ?? 1;
    let seasonProviders: WatchProviderCountryData | null = null;
    if (mediaType === 'tv') {
      seasonProviders = await this.getSeasonWatchProviders(id, initialSeasonNum, RequestPriority.LOW).catch(
        () => null
      );
    }

    const result: AggregateDetailsResult = {
      item: raw as MovieDetails | TvShowDetails,
      credits,
      videos,
      providers,
      recommendations,
      similar,
      reviews,
      keywords,
      externalIds,
      logoPath,
      backdrops,
      certification,
      loading: false,
      seasonDetails: firstSeasonData,
      selectedSeasonNumber: initialSeasonNum,
      seasonProviders,
    };

    globalOrchestrator.setCache(cacheKey, result, 10 * 60 * 1000);
    return result;
  }

  // --- DISCOVERY & REGIONAL FEEDS ---

  async discoverRegional(
    mediaType: 'movie' | 'tv',
    params: Record<string, string> = {},
    page: number = 1,
    options?: {
      providerIds?: number[];
      scope?: string;
      signal?: AbortSignal;
      priority?: RequestPriority;
    }
  ): Promise<TmdbResponse<MediaItem>> {
    const regionalParams: Record<string, string> = {
      watch_region: this.region,
      ...params,
    };

    if (options?.providerIds && options.providerIds.length > 0) {
      regionalParams.with_watch_providers = options.providerIds.join('|');
      regionalParams.with_watch_monetization_types = 'flatrate';
    } else if (
      !regionalParams.with_watch_providers &&
      !regionalParams.with_watch_monetization_types
    ) {
      regionalParams.with_watch_monetization_types = 'flatrate|free|ads|rent|buy';
    }

    return this.discover(mediaType, regionalParams, page, {
      scope: options?.scope,
      signal: options?.signal,
      priority: options?.priority,
    });
  }

  async getTrending(
    mediaType: string = 'all',
    timeWindow: string = 'day',
    page: number = 1,
    options?: { scope?: string; signal?: AbortSignal; priority?: RequestPriority }
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/trending/${mediaType}/${timeWindow}`,
      { page: page.toString() },
      {
        priority: options?.priority ?? RequestPriority.HIGH,
        scope: options?.scope,
        signal: options?.signal,
      }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({
        ...item,
        media_type: (item.media_type ||
          (mediaType === 'all' ? undefined : mediaType)) as MediaType | undefined,
      })),
    };
  }

  async getTrendingPeople(
    timeWindow: 'day' | 'week' = 'week',
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/trending/person/${timeWindow}`,
      { page: page.toString() },
      { priority }
    );
    return {
      ...data,
      results: (data.results || [])
        .filter((person) => Boolean(person.profile_path))
        .map((person) => ({
          ...person,
          media_type: 'person' as MediaType,
        })),
    };
  }

  async getAiringTodayTv(
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      '/tv/airing_today',
      { page: page.toString() },
      { priority }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({ ...item, media_type: 'tv' as MediaType })),
    };
  }

  async getOfficialTopRated(
    mediaType: 'movie' | 'tv',
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/${mediaType}/top_rated`,
      { region: this.region, page: page.toString() },
      { priority }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({
        ...item,
        media_type: mediaType as MediaType,
      })),
    };
  }

  async discoverByKeyword(
    keywordId: number,
    mediaType: 'movie' | 'tv' = 'movie',
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/discover/${mediaType}`,
      {
        with_keywords: keywordId.toString(),
        watch_region: this.region,
        sort_by: 'popularity.desc',
        page: page.toString(),
      },
      { priority }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({
        ...item,
        media_type: mediaType as MediaType,
      })),
    };
  }

  async searchKeywords(
    query: string,
    page: number = 1,
    options?: { scope?: string; signal?: AbortSignal }
  ): Promise<TmdbResponse<Keyword>> {
    const clean = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clean) return { page: 1, results: [], total_pages: 0, total_results: 0 };
    return this.fetch<TmdbResponse<Keyword>>(
      '/search/keyword',
      { query: clean, page: page.toString() },
      { priority: RequestPriority.HIGH, scope: options?.scope, signal: options?.signal }
    );
  }

  async getNowPlayingMovies(
    page: number = 1,
    providerIds?: number[]
  ): Promise<TmdbResponse<MediaItem>> {
    if (providerIds && providerIds.length > 0) {
      return this.discoverRegional(
        'movie',
        { sort_by: 'popularity.desc' },
        page,
        { providerIds, priority: RequestPriority.CRITICAL }
      );
    }

    const data = await this.fetch<TmdbResponse<MediaItem>>(
      '/movie/now_playing',
      { region: this.region, page: page.toString() },
      { priority: RequestPriority.CRITICAL }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({ ...item, media_type: 'movie' })),
    };
  }

  async getUpcomingMovies(page: number = 1): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      '/movie/upcoming',
      { region: this.region, page: page.toString() },
      { priority: RequestPriority.HIGH }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({ ...item, media_type: 'movie' })),
    };
  }

  async getTopRated(
    mediaType: 'movie' | 'tv',
    page: number = 1,
    providerIds?: number[]
  ): Promise<TmdbResponse<MediaItem>> {
    return this.discoverRegional(
      mediaType,
      {
        sort_by: 'vote_average.desc',
        'vote_count.gte': '350',
      },
      page,
      { providerIds, priority: RequestPriority.HIGH }
    );
  }

  async getOnTheAirTv(
    page: number = 1,
    providerIds?: number[]
  ): Promise<TmdbResponse<MediaItem>> {
    return this.discoverRegional(
      'tv',
      {
        sort_by: 'popularity.desc',
      },
      page,
      { providerIds, priority: RequestPriority.HIGH }
    );
  }

  async multiSearch(
    query: string,
    page: number = 1,
    options?: { scope?: string; signal?: AbortSignal }
  ): Promise<TmdbResponse<MediaItem>> {
    const canonicalQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!canonicalQuery) return { page: 1, results: [], total_pages: 0, total_results: 0 };
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      '/search/multi',
      { query: canonicalQuery, page: page.toString(), region: this.region },
      { priority: RequestPriority.CRITICAL, scope: options?.scope, signal: options?.signal }
    );
    return {
      ...data,
      results: (data.results || []).filter(
        (item) => item.media_type !== 'person' || item.profile_path
      ),
    };
  }

  async discover(
    mediaType: 'movie' | 'tv',
    params: Record<string, string>,
    page: number = 1,
    options?: { scope?: string; signal?: AbortSignal; priority?: RequestPriority }
  ): Promise<TmdbResponse<MediaItem>> {
    const finalParams: Record<string, string> = {
      watch_region: this.region,
      ...params,
      page: page.toString(),
      sort_by: params.sort_by || 'popularity.desc',
    };

    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/discover/${mediaType}`,
      finalParams,
      {
        priority: options?.priority ?? RequestPriority.HIGH,
        scope: options?.scope,
        signal: options?.signal,
      }
    );
    return {
      ...data,
      results: (data.results || []).map((item) => ({ ...item, media_type: mediaType })),
    };
  }

  async getGenres(type: 'movie' | 'tv'): Promise<Genre[]> {
    const data = await this.fetch<{ genres: Genre[] }>(
      `/genre/${type}/list`,
      {},
      { priority: RequestPriority.HIGH, ttlMs: 30 * 60 * 1000 }
    );
    return data.genres || [];
  }

  async getWatchProviderList(type: 'movie' | 'tv'): Promise<WatchProvider[]> {
    const data = await this.fetch<{ results: any[] }>(
      `/watch/providers/${type}`,
      { watch_region: this.region },
      { priority: RequestPriority.HIGH, ttlMs: 30 * 60 * 1000 }
    );
    const list = (data.results || []).map((p) => ({
      ...p,
      display_priority:
        p.display_priorities?.[this.region] ?? p.display_priority ?? 999,
    }));
    return list.sort((a, b) => a.display_priority - b.display_priority);
  }

  // --- INDIVIDUAL ENDPOINT HELPERS ---

  async getMovieDetails(id: number, priority = RequestPriority.HIGH): Promise<MovieDetails> {
    return this.fetch<MovieDetails>(`/movie/${id}`, {}, { priority });
  }

  async getTvDetails(id: number, priority = RequestPriority.HIGH): Promise<TvShowDetails> {
    return this.fetch<TvShowDetails>(`/tv/${id}`, {}, { priority });
  }

  async getSeasonDetails(
    tvId: number,
    seasonNumber: number,
    priority = RequestPriority.HIGH
  ): Promise<any> {
    return this.fetch<any>(`/tv/${tvId}/season/${seasonNumber}`, {}, { priority });
  }

  async getSeasonWatchProviders(
    tvId: number,
    seasonNumber: number,
    priority = RequestPriority.HIGH
  ): Promise<WatchProviderCountryData | null> {
    const data = await this.fetch<WatchProvidersResponse>(
      `/tv/${tvId}/season/${seasonNumber}/watch/providers`,
      {},
      { priority }
    );
    return data?.results?.[this.region] || null;
  }

  async getTvAggregateCredits(
    tvId: number,
    priority = RequestPriority.HIGH
  ): Promise<CreditsResponse> {
    const raw = await this.fetch<any>(`/tv/${tvId}/aggregate_credits`, {}, { priority });
    return {
      id: tvId,
      cast: (raw.cast || []).slice(0, 40).map((c: any) => ({
        id: c.id,
        name: c.name,
        character: c.roles?.[0]?.character || c.character || '',
        profile_path: c.profile_path || null,
        order: c.order ?? 999,
        total_episode_count: c.total_episode_count,
      })),
      crew: (raw.crew || []).slice(0, 35).map((c: any) => ({
        id: c.id,
        name: c.name,
        job: c.jobs?.[0]?.job || c.job || c.department || '',
        department: c.department || '',
        profile_path: c.profile_path || null,
      })),
    };
  }

  async getPersonDetails(id: number, priority = RequestPriority.HIGH): Promise<PersonDetails> {
    return this.fetch<PersonDetails>(`/person/${id}`, {}, { priority });
  }

  async getPersonImages(
    personId: number,
    priority = RequestPriority.HIGH
  ): Promise<{ profiles: TmdbImage[] }> {
    return this.fetch<{ profiles: TmdbImage[] }>(`/person/${personId}/images`, {}, { priority });
  }

  async getCollectionDetails(id: number, priority = RequestPriority.HIGH): Promise<Collection> {
    return this.fetch<Collection>(`/collection/${id}`, {}, { priority });
  }

  async getCollectionImages(
    collectionId: number,
    priority = RequestPriority.HIGH
  ): Promise<{ backdrops: TmdbImage[]; posters: TmdbImage[] }> {
    const langIso = (this.language || 'de-DE').split('-')[0].toLowerCase();
    return this.fetch<{ backdrops: TmdbImage[]; posters: TmdbImage[] }>(
      `/collection/${collectionId}/images`,
      { include_image_language: `${langIso},en,null` },
      { priority }
    );
  }

  async getCompanyDetails(id: number, priority = RequestPriority.HIGH): Promise<Company> {
    return this.fetch<Company>(`/company/${id}`, {}, { priority });
  }

  async getMoviesByCompany(
    companyId: number,
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      '/discover/movie',
      {
        with_companies: companyId.toString(),
        watch_region: this.region,
        sort_by: 'popularity.desc',
        page: page.toString(),
      },
      { priority }
    );
    return { ...data, results: (data.results || []).map((i) => ({ ...i, media_type: 'movie' })) };
  }

  async getRecommendations(
    id: number,
    type: 'movie' | 'tv',
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/${type}/${id}/recommendations`,
      { page: page.toString() },
      { priority }
    );
    return { ...data, results: (data.results || []).map((i) => ({ ...i, media_type: type })) };
  }

  async getSimilarMedia(
    id: number,
    type: 'movie' | 'tv',
    page: number = 1,
    priority = RequestPriority.HIGH
  ): Promise<TmdbResponse<MediaItem>> {
    const data = await this.fetch<TmdbResponse<MediaItem>>(
      `/${type}/${id}/similar`,
      { page: page.toString() },
      { priority }
    );
    return { ...data, results: (data.results || []).map((i) => ({ ...i, media_type: type })) };
  }

  async getCredits(
    id: number,
    type: 'movie' | 'tv',
    priority = RequestPriority.HIGH
  ): Promise<CreditsResponse> {
    return this.fetch<CreditsResponse>(`/${type}/${id}/credits`, {}, { priority });
  }

  async getPersonCombinedCredits(
    id: number,
    priority = RequestPriority.HIGH
  ): Promise<CombinedCredits> {
    return this.fetch<CombinedCredits>(`/person/${id}/combined_credits`, {}, { priority });
  }

  async getVideos(
    id: number,
    type: 'movie' | 'tv',
    priority = RequestPriority.HIGH
  ): Promise<Video[]> {
    const data = await this.fetch<{ id: number; results: Video[] }>(
      `/${type}/${id}/videos`,
      {},
      { priority }
    );
    return (data.results || []).filter((v) => v.site === 'YouTube');
  }

  async getWatchProviders(
    id: number,
    type: 'movie' | 'tv',
    priority = RequestPriority.HIGH
  ): Promise<WatchProviderCountryData | null> {
    const data = await this.fetch<WatchProvidersResponse>(
      `/${type}/${id}/watch/providers`,
      {},
      { priority }
    );
    return data.results?.[this.region] || null;
  }

  async getExternalIds(
    id: number,
    type: 'movie' | 'tv' | 'person',
    priority = RequestPriority.HIGH
  ): Promise<ExternalIds> {
    return this.fetch<ExternalIds>(`/${type}/${id}/external_ids`, {}, { priority });
  }

  async getReviews(
    id: number,
    type: 'movie' | 'tv',
    priority = RequestPriority.HIGH
  ): Promise<Review[]> {
    const data = await this.fetch<{ id: number; results: Review[] }>(
      `/${type}/${id}/reviews`,
      {},
      { priority }
    );
    return data.results || [];
  }

  async getKeywords(
    id: number,
    type: 'movie' | 'tv',
    priority = RequestPriority.HIGH
  ): Promise<Keyword[]> {
    const data = await this.fetch<{ id: number; keywords?: Keyword[]; results?: Keyword[] }>(
      `/${type}/${id}/keywords`,
      {},
      { priority }
    );
    return data.keywords || data.results || [];
  }

  getImageUrl(
    path: string | undefined | null,
    size: 'w200' | 'w300' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500'
  ): string {
    if (!path) return '';

    let effectiveSize = size;
    if (this.dataSaver) {
      if (size === 'original' || size === 'w1280') effectiveSize = 'w780';
      else if (size === 'w780') effectiveSize = 'w500';
      else if (size === 'w500') effectiveSize = 'w300';
    }

    return `https://image.tmdb.org/t/p/${effectiveSize}${path}`;
  }
}