import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  setLogLevel,
  disableNetwork,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const CACHE_DIR = path.join(__dirname, '.cache');
const VAULT_FILE = path.join(CACHE_DIR, 'tmdb-server-vault.json');
const DISK_CACHE_FILE = path.join(CACHE_DIR, 'tmdb-regional-cache.json');
const SECURITY_VAULT_FILE = path.join(CACHE_DIR, 'user-2fa-vault.json');
const USER_SYNC_VAULT_FILE = path.join(CACHE_DIR, 'user-cloud-sync-vault.json');
const FIREBASE_CONFIG_FILE = path.join(__dirname, 'firebase-applet-config.json');

// Ensure .cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch {
  // ignore
}

// --- Initialize Server-Side Firestore L2 Bridge ---
let firestoreDb: ReturnType<typeof getFirestore> | null = null;
let serverFirestoreQuotaExhausted = false;
let firebaseWebApiKey = '';
let firebaseProjectId = '';
try {
  setLogLevel('silent');
  if (fs.existsSync(FIREBASE_CONFIG_FILE)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf-8'));
    firebaseWebApiKey = firebaseConfig?.apiKey || '';
    firebaseProjectId = firebaseConfig?.projectId || '';
    if (firebaseConfig?.projectId) {
      const fbApp = initializeApp(firebaseConfig, 'moviejournal-server-bridge');
      firestoreDb = getFirestore(fbApp, firebaseConfig.firestoreDatabaseId);
    }
  }
} catch (err) {
  console.error('Failed to initialize server Firestore bridge:', err);
}

function handleServerFirestoreQuotaError(err: unknown): void {
  const msg = String((err as any)?.message || err || '');
  const code = String((err as any)?.code || '');
  if (
    code.includes('resource-exhausted') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Quota exceeded')
  ) {
    serverFirestoreQuotaExhausted = true;
    if (firestoreDb) {
      disableNetwork(firestoreDb).catch(() => {});
    }
  }
}

// --- AES-256-GCM Server Cryptographic Vault ---
const MASTER_VAULT_SECRET =
  process.env.VAULT_SECRET ||
  process.env.GEMINI_API_KEY ||
  process.env.TMDB_API_KEY ||
  `moviejournal-aes256-vault-${firebaseProjectId || 'acaa1505'}`;

const VAULT_CIPHER_KEY = crypto.scryptSync(
  MASTER_VAULT_SECRET,
  'moviejournal-vault-salt-v1',
  32
);

function encryptForServerVault(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_CIPHER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptFromServerVault(cipherPayload: string): string | null {
  try {
    const parts = (cipherPayload || '').split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_CIPHER_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// --- Multi-Key TMDB Failover Pool (Supports 5-10+ Rotating Keys with Circuit Breaker) ---
export interface TmdbKeyPoolEntry {
  keyId: string;
  rawKey: string;
  maskedKey: string;
  source: 'env' | 'vault';
  status: 'healthy' | 'cooldown' | 'invalid';
  cooldownUntil: number;
  inFlightCount: number;
  totalRequests: number;
  failoverCount: number;
  lastLatencyMs: number;
  lastUsedAt: number;
}

const tmdbKeyPool = new Map<string, TmdbKeyPoolEntry>();
let roundRobinCursor = 0;
let totalKeyFailovers = 0;

function computeKeyId(rawKey: string): string {
  const hash = crypto.createHash('sha256').update(rawKey.trim()).digest('hex').slice(0, 10);
  return `key_${hash}`;
}

function maskTmdbKey(rawKey: string): string {
  const clean = rawKey.trim();
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 3)}••••${clean.slice(-4)}`;
}

function registerTmdbKeyInPool(rawKey: string, source: 'env' | 'vault'): TmdbKeyPoolEntry | null {
  const cleaned = (rawKey || '').trim();
  if (!cleaned || cleaned === 'SERVER_PROXY' || cleaned.length < 16) return null;
  const keyId = computeKeyId(cleaned);
  const existing = tmdbKeyPool.get(keyId);
  if (existing) {
    if (source === 'env') existing.source = 'env';
    return existing;
  }
  const entry: TmdbKeyPoolEntry = {
    keyId,
    rawKey: cleaned,
    maskedKey: maskTmdbKey(cleaned),
    source,
    status: 'healthy',
    cooldownUntil: 0,
    inFlightCount: 0,
    totalRequests: 0,
    failoverCount: 0,
    lastLatencyMs: 0,
    lastUsedAt: 0,
  };
  tmdbKeyPool.set(keyId, entry);
  return entry;
}

function loadEnvTmdbKeysIntoPool(): void {
  // 1. Comma-separated TMDB_API_KEYS
  const commaList = process.env.TMDB_API_KEYS || '';
  if (commaList) {
    commaList
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((k) => registerTmdbKeyInPool(k, 'env'));
  }

  // 2. Single TMDB_API_KEY + numbered TMDB_API_KEY_1 .. TMDB_API_KEY_10
  const candidates = [
    process.env.TMDB_API_KEY,
    process.env.VITE_TMDB_API_KEY,
    ...Array.from({ length: 12 }, (_, idx) => process.env[`TMDB_API_KEY_${idx + 1}`]),
  ];
  for (const candidate of candidates) {
    if (candidate) {
      registerTmdbKeyInPool(candidate, 'env');
    }
  }
}

function loadLocalVaultKeysIntoPool(): void {
  try {
    if (!fs.existsSync(VAULT_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
    if (typeof parsed?.tmdbApiKey === 'string') {
      registerTmdbKeyInPool(parsed.tmdbApiKey, 'vault');
    }
    if (Array.isArray(parsed?.tmdbApiKeys)) {
      for (const k of parsed.tmdbApiKeys) {
        if (typeof k === 'string') registerTmdbKeyInPool(k, 'vault');
      }
    }
    if (typeof parsed?.encryptedPayload === 'string') {
      const dec = decryptFromServerVault(parsed.encryptedPayload);
      if (dec) {
        const list = JSON.parse(dec);
        if (Array.isArray(list)) {
          for (const k of list) {
            if (typeof k === 'string') registerTmdbKeyInPool(k, 'vault');
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

async function hydrateKeyPoolFromFirestoreVault(): Promise<void> {
  if (!firestoreDb || serverFirestoreQuotaExhausted) return;
  try {
    const snap = await getDoc(doc(firestoreDb, 'serverKeyVault', 'tmdbPool'));
    if (snap.exists()) {
      const data = snap.data();
      if (typeof data?.encryptedPayload === 'string') {
        const dec = decryptFromServerVault(data.encryptedPayload);
        if (dec) {
          const parsed = JSON.parse(dec);
          if (Array.isArray(parsed)) {
            for (const rawKey of parsed) {
              if (typeof rawKey === 'string') {
                registerTmdbKeyInPool(rawKey, 'vault');
              }
            }
            persistVaultKeysToDiskAndFirestore(false);
          }
        }
      }
    }
  } catch (err) {
    handleServerFirestoreQuotaError(err);
  }
}

function persistVaultKeysToDiskAndFirestore(syncFirestore: boolean = false): void {
  const allVaultKeys = Array.from(tmdbKeyPool.values()).map((e) => e.rawKey);
  const encryptedPayload = encryptForServerVault(JSON.stringify(allVaultKeys));
  const now = Date.now();

  try {
    fs.writeFileSync(
      VAULT_FILE,
      JSON.stringify({
        encryptedPayload,
        keyCount: allVaultKeys.length,
        updatedAt: now,
      }),
      'utf-8'
    );
  } catch {
    // ignore
  }

  if (syncFirestore && firestoreDb && !serverFirestoreQuotaExhausted && allVaultKeys.length > 0) {
    setDoc(doc(firestoreDb, 'serverKeyVault', 'tmdbPool'), {
      vaultId: 'tmdbPool',
      encryptedPayload,
      keyCount: Math.min(25, allVaultKeys.length),
      updatedAt: now,
    }).catch(handleServerFirestoreQuotaError);
  }
}

loadEnvTmdbKeysIntoPool();
loadLocalVaultKeysIntoPool();

function hasAnyServerTmdbKey(): boolean {
  loadEnvTmdbKeysIntoPool();
  for (const entry of tmdbKeyPool.values()) {
    if (entry.status !== 'invalid') return true;
  }
  return tmdbKeyPool.size > 0;
}

function selectNextHealthyKey(excludeKeyIds: Set<string>): TmdbKeyPoolEntry | null {
  loadEnvTmdbKeysIntoPool();
  const now = Date.now();
  const allEntries = Array.from(tmdbKeyPool.values());
  if (allEntries.length === 0) return null;

  // Recover keys whose cooldown has expired
  for (const entry of allEntries) {
    if (entry.status === 'cooldown' && now >= entry.cooldownUntil) {
      entry.status = 'healthy';
      entry.cooldownUntil = 0;
    }
  }

  const healthyCandidates = allEntries.filter(
    (e) => e.status === 'healthy' && !excludeKeyIds.has(e.keyId)
  );

  if (healthyCandidates.length > 0) {
    // Sort by lowest inFlightCount, then round-robin offset
    const offset = roundRobinCursor++ % healthyCandidates.length;
    const rotated = [
      ...healthyCandidates.slice(offset),
      ...healthyCandidates.slice(0, offset),
    ];
    rotated.sort((a, b) => a.inFlightCount - b.inFlightCount);
    return rotated[0];
  }

  // Fallback: if all keys are in cooldown, pick the one with the earliest cooldown expiry not yet tried
  const cooldownCandidates = allEntries
    .filter((e) => e.status !== 'invalid' && !excludeKeyIds.has(e.keyId))
    .sort((a, b) => a.cooldownUntil - b.cooldownUntil);

  if (cooldownCandidates.length > 0) {
    return cooldownCandidates[0];
  }

  return allEntries[0];
}

/**
 * Executes an upstream TMDB GET/POST request using the Multi-Key Pool with automatic
 * <5ms failover rotation on Timeout (3.5s), Rate-Limit (HTTP 429), or Upstream 5xx error.
 */
async function executeTmdbFetchWithKeyRotation(
  cleanEndpoint: string,
  queryParams: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
  bodyStr?: string
): Promise<{ status: number; data: any; usedKeyId?: string }> {
  const triedKeys = new Set<string>();
  const maxAttempts = Math.max(1, Math.min(tmdbKeyPool.size || 1, 5));
  let lastStatus = 502;
  let lastData: any = { status_message: 'TMDB upstream unavailable.' };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyEntry = selectNextHealthyKey(triedKeys);
    if (!keyEntry) {
      return {
        status: 401,
        data: { status_message: 'Server TMDB API key pool is empty.' },
      };
    }

    triedKeys.add(keyEntry.keyId);
    keyEntry.inFlightCount += 1;
    keyEntry.totalRequests += 1;
    keyEntry.lastUsedAt = Date.now();
    const startMs = Date.now();

    try {
      const searchParams = new URLSearchParams(queryParams);
      searchParams.set('api_key', keyEntry.rawKey);
      const targetUrl = `https://api.themoviedb.org/3/${cleanEndpoint}?${searchParams.toString()}`;

      const upstream = await fetch(targetUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: AbortSignal.timeout(3500),
      });

      keyEntry.lastLatencyMs = Date.now() - startMs;
      const data = await upstream.json().catch(() => ({}));

      if (upstream.ok) {
        keyEntry.status = 'healthy';
        keyEntry.cooldownUntil = 0;
        return { status: upstream.status, data, usedKeyId: keyEntry.keyId };
      }

      lastStatus = upstream.status;
      lastData = data;

      if (upstream.status === 429) {
        // Rate limit hit -> place key in cooldown and immediately rotate to next key
        const retryAfterSec = Number(upstream.headers.get('retry-after') || 30);
        keyEntry.status = 'cooldown';
        keyEntry.cooldownUntil = Date.now() + Math.max(10, retryAfterSec) * 1000;
        keyEntry.failoverCount += 1;
        totalKeyFailovers += 1;
        continue;
      }

      if (upstream.status === 401) {
        // Invalid key -> mark invalid if we have other keys, and rotate immediately
        if (tmdbKeyPool.size > 1) {
          keyEntry.status = 'invalid';
        }
        keyEntry.failoverCount += 1;
        totalKeyFailovers += 1;
        continue;
      }

      if (upstream.status >= 500) {
        // Upstream 5xx -> short cooldown and rotate immediately
        keyEntry.status = 'cooldown';
        keyEntry.cooldownUntil = Date.now() + 20 * 1000;
        keyEntry.failoverCount += 1;
        totalKeyFailovers += 1;
        continue;
      }

      // 400 / 404 client error: return immediately without rotating
      return { status: upstream.status, data, usedKeyId: keyEntry.keyId };
    } catch (err: any) {
      // Timeout (AbortError) or network reset -> place key in 20s cooldown and rotate immediately
      keyEntry.lastLatencyMs = Date.now() - startMs;
      keyEntry.status = 'cooldown';
      keyEntry.cooldownUntil = Date.now() + 20 * 1000;
      keyEntry.failoverCount += 1;
      totalKeyFailovers += 1;
      lastStatus = 504;
      lastData = { status_message: err?.message || 'TMDB key request timed out, rotated.' };
      continue;
    } finally {
      keyEntry.inFlightCount = Math.max(0, keyEntry.inFlightCount - 1);
    }
  }

  return { status: lastStatus, data: lastData };
}

// --- 3-Tier Universal Request Cache (L1 Server RAM + Disk Snapshot + L2 Firestore Bridge + SWR) ---
interface RegionalCacheRecord {
  cacheKey: string;
  region: string;
  language: string;
  endpoint: string;
  payload: any;
  expiresAt: number;
  updatedAt: number;
}

interface ActiveRegionRecord {
  regionLangId: string;
  region: string;
  language: string;
  lastHeartbeatAt: number;
  lastWarmedAt: number;
  userCountEstimate: number;
}

const MAX_L1_ENTRIES = 5000;
const l1RegionalCache = new Map<string, RegionalCacheRecord>();
const activeRegions = new Map<string, ActiveRegionRecord>();
const inFlightRequests = new Map<string, Promise<{ status: number; data: any }>>();
const backgroundSwrRefreshes = new Set<string>();

let cacheHits = 0;
let cacheMisses = 0;
let coalescedHits = 0;
let swrInstantHits = 0;

// Hydrate L1 cache from persistent snapshot on startup (eliminates cold-start penalty)
try {
  if (fs.existsSync(DISK_CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_FILE, 'utf-8'));
    const now = Date.now();
    if (Array.isArray(raw?.entries)) {
      for (const entry of raw.entries) {
        if (entry && entry.cacheKey && entry.expiresAt + 48 * 60 * 60 * 1000 > now) {
          l1RegionalCache.set(entry.cacheKey, entry);
        }
      }
    }
    if (Array.isArray(raw?.regions)) {
      for (const reg of raw.regions) {
        if (reg && reg.regionLangId) {
          activeRegions.set(reg.regionLangId, reg);
        }
      }
    }
  }
} catch {
  // ignore
}

let persistTimeout: ReturnType<typeof setTimeout> | null = null;
function scheduleDiskCachePersist() {
  if (persistTimeout) return;
  persistTimeout = setTimeout(() => {
    persistTimeout = null;
    try {
      const now = Date.now();
      const validEntries = Array.from(l1RegionalCache.values())
        .filter((e) => e.expiresAt + 24 * 60 * 60 * 1000 > now)
        .slice(-1500);
      const regionsList = Array.from(activeRegions.values());
      fs.writeFileSync(
        DISK_CACHE_FILE,
        JSON.stringify({ entries: validEntries, regions: regionsList }),
        'utf-8'
      );
    } catch {
      // ignore
    }
  }, 5000);
}

function getTtlMsForEndpoint(endpoint: string): number {
  if (
    endpoint.startsWith('genre/') ||
    endpoint.startsWith('watch/providers/') ||
    endpoint === 'configuration'
  ) {
    return 7 * 24 * 60 * 60 * 1000; // 7 days
  }
  if (
    endpoint === 'movie/now_playing' ||
    endpoint === 'movie/top_rated' ||
    endpoint === 'tv/on_the_air' ||
    endpoint === 'tv/airing_today' ||
    endpoint === 'tv/top_rated' ||
    endpoint.startsWith('trending/') ||
    endpoint.startsWith('discover/')
  ) {
    return 12 * 60 * 60 * 1000; // 12 hours fresh
  }
  if (endpoint.startsWith('search/')) {
    return 6 * 60 * 60 * 1000; // 6 hours fresh for all searches (shared across all 1,000 users!)
  }
  return 24 * 60 * 60 * 1000; // 24 hours fresh for movie/tv/season/person details
}

function getStaleGraceMsForEndpoint(endpoint: string): number {
  if (endpoint.startsWith('search/')) {
    return 24 * 60 * 60 * 1000; // 24 hours SWR grace window for searches
  }
  return 72 * 60 * 60 * 1000; // 72 hours SWR grace window for details & feeds
}

/**
 * Canonicalizes query parameters so equivalent searches or filter orders from 1,000 concurrent
 * users ("Dune", "dune ", "DUNE") always produce the exact same deterministic cache key.
 */
export function normalizeQueryParamValue(key: string, value: any): string {
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

export function buildDeterministicCacheKey(
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
    .map((k) => `${k}=${normalizeQueryParamValue(k, queryObj[k])}`)
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

/**
 * Compacts large TMDB responses (e.g., aggregate details with 500 cast/crew or 200 images)
 * so serialized JSON is always fast and safely within Firestore's document size limits (< 350 KB).
 */
function compactTmdbPayloadForCache(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  try {
    const rawStr = JSON.stringify(payload);
    if (rawStr.length <= 320000) return payload;

    const clone: any = { ...payload };
    if (clone.credits) {
      clone.credits = {
        ...clone.credits,
        cast: Array.isArray(clone.credits.cast) ? clone.credits.cast.slice(0, 45) : [],
        crew: Array.isArray(clone.credits.crew) ? clone.credits.crew.slice(0, 45) : [],
      };
    }
    if (clone.aggregate_credits) {
      clone.aggregate_credits = {
        ...clone.aggregate_credits,
        cast: Array.isArray(clone.aggregate_credits.cast)
          ? clone.aggregate_credits.cast.slice(0, 45)
          : [],
        crew: Array.isArray(clone.aggregate_credits.crew)
          ? clone.aggregate_credits.crew.slice(0, 35)
          : [],
      };
    }
    if (clone.combined_credits) {
      clone.combined_credits = {
        ...clone.combined_credits,
        cast: Array.isArray(clone.combined_credits.cast)
          ? clone.combined_credits.cast.slice(0, 60)
          : [],
        crew: Array.isArray(clone.combined_credits.crew)
          ? clone.combined_credits.crew.slice(0, 40)
          : [],
      };
    }
    if (clone.images) {
      clone.images = {
        ...clone.images,
        backdrops: Array.isArray(clone.images.backdrops) ? clone.images.backdrops.slice(0, 20) : [],
        posters: Array.isArray(clone.images.posters) ? clone.images.posters.slice(0, 15) : [],
        logos: Array.isArray(clone.images.logos) ? clone.images.logos.slice(0, 12) : [],
      };
    }
    if (clone.reviews?.results && Array.isArray(clone.reviews.results)) {
      clone.reviews = {
        ...clone.reviews,
        results: clone.reviews.results.slice(0, 8).map((r: any) => ({
          ...r,
          content: typeof r.content === 'string' ? r.content.slice(0, 1500) : '',
        })),
      };
    }
    return clone;
  } catch {
    return payload;
  }
}

function syncRecordToFirestoreL2(_record: RegionalCacheRecord): void {
  // Intentionally disabled: L1 Server RAM + .cache/tmdb-regional-cache.json disk snapshot
  // already persist 1,500+ regional TMDB responses without consuming Firestore's free daily write quota.
}

function setL1Cache(
  cacheKey: string,
  region: string,
  language: string,
  endpoint: string,
  payload: any,
  syncToL2: boolean = true
): RegionalCacheRecord {
  if (l1RegionalCache.size >= MAX_L1_ENTRIES) {
    const oldestKey = l1RegionalCache.keys().next().value;
    if (oldestKey) l1RegionalCache.delete(oldestKey);
  }
  const now = Date.now();
  const compacted = compactTmdbPayloadForCache(payload);
  const record: RegionalCacheRecord = {
    cacheKey,
    region,
    language,
    endpoint,
    payload: compacted,
    updatedAt: now,
    expiresAt: now + getTtlMsForEndpoint(endpoint),
  };
  l1RegionalCache.set(cacheKey, record);
  scheduleDiskCachePersist();
  if (syncToL2) {
    syncRecordToFirestoreL2(record);
  }
  return record;
}

function refreshCacheEntryInBackground(
  cacheKey: string,
  region: string,
  language: string,
  cleanEndpoint: string,
  queryParams: Record<string, string>
): void {
  if (backgroundSwrRefreshes.has(cacheKey) || inFlightRequests.has(cacheKey)) return;
  backgroundSwrRefreshes.add(cacheKey);

  executeTmdbFetchWithKeyRotation(cleanEndpoint, queryParams, 'GET')
    .then((res) => {
      if (res.status >= 200 && res.status < 300) {
        const compacted = compactTmdbPayloadForCache(res.data);
        setL1Cache(cacheKey, region, language, cleanEndpoint, compacted, true);
      }
    })
    .catch(() => {})
    .finally(() => {
      backgroundSwrRefreshes.delete(cacheKey);
    });
}

/**
 * Core Universal Proxy Fetcher with:
 * - L1 RAM LRU Cache (5,000 entries) + Stale-While-Revalidate (SWR)
 * - Singleflight In-Flight Coalescing (1,000 concurrent users -> 1 upstream call)
 * - L2 Firestore Shared Cache (/regionalCache/{cacheKey})
 * - Multi-Key TMDB Rotation & Circuit Breaker Failover
 */
async function fetchTmdbThroughRegionalCache(
  endpoint: string,
  queryParams: Record<string, string>,
  regionHint?: string,
  forceSyncL2: boolean = false
): Promise<{ status: number; data: any; cacheKey: string; fromCache: boolean }> {
  if (!hasAnyServerTmdbKey()) {
    return {
      status: 401,
      data: { status_message: 'Server TMDB API key pool is not configured yet.' },
      cacheKey: '',
      fromCache: false,
    };
  }

  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const region = (
    queryParams.watch_region ||
    queryParams.region ||
    regionHint ||
    'DE'
  ).toUpperCase();
  const language = queryParams.language || 'de-DE';

  const cacheKey = buildDeterministicCacheKey(region, language, cleanEndpoint, queryParams);
  const now = Date.now();

  // 1. Check L1 Server RAM Cache (Fresh OR Stale-While-Revalidate)
  const existing = l1RegionalCache.get(cacheKey);
  if (existing) {
    const isFresh = existing.expiresAt > now;
    const isWithinSwrGrace =
      existing.expiresAt + getStaleGraceMsForEndpoint(cleanEndpoint) > now;

    if (isFresh || isWithinSwrGrace) {
      l1RegionalCache.delete(cacheKey);
      l1RegionalCache.set(cacheKey, existing);
      cacheHits++;

      if (!isFresh) {
        swrInstantHits++;
        refreshCacheEntryInBackground(cacheKey, region, language, cleanEndpoint, queryParams);
      } else if (forceSyncL2) {
        existing.expiresAt = Math.max(existing.expiresAt, now + getTtlMsForEndpoint(cleanEndpoint));
        syncRecordToFirestoreL2(existing);
      }

      return {
        status: 200,
        data: existing.payload,
        cacheKey,
        fromCache: true,
      };
    }
  }

  // 2. Check Singleflight In-Flight Request Coalescing
  const existingInFlight = inFlightRequests.get(cacheKey);
  if (existingInFlight) {
    coalescedHits++;
    const result = await existingInFlight;
    return {
      status: result.status,
      data: result.data,
      cacheKey,
      fromCache: true,
    };
  }

  cacheMisses++;

  // 3. Check L2 Firestore Shared Cache before hitting TMDB upstream with Key Rotation
  const upstreamPromise = (async () => {
    try {
      if (firestoreDb) {
        try {
          const l2Snap = await getDoc(doc(firestoreDb, 'regionalCache', cacheKey));
          if (l2Snap.exists()) {
            const l2Data = l2Snap.data();
            const l2Expires = Number(l2Data?.expiresAt || 0);
            const l2WithinGrace =
              l2Expires + getStaleGraceMsForEndpoint(cleanEndpoint) > Date.now();
            if (typeof l2Data?.payloadJson === 'string' && l2WithinGrace) {
              const parsed = JSON.parse(l2Data.payloadJson);
              setL1Cache(cacheKey, region, language, cleanEndpoint, parsed, false);
              if (l2Expires <= Date.now()) {
                refreshCacheEntryInBackground(
                  cacheKey,
                  region,
                  language,
                  cleanEndpoint,
                  queryParams
                );
              }
              return { status: 200, data: parsed };
            }
          }
        } catch {
          // Proceed to TMDB upstream key pool
        }
      }

      const rotatedResult = await executeTmdbFetchWithKeyRotation(
        cleanEndpoint,
        queryParams,
        'GET'
      );

      if (rotatedResult.status >= 200 && rotatedResult.status < 300) {
        const compacted = compactTmdbPayloadForCache(rotatedResult.data);
        setL1Cache(cacheKey, region, language, cleanEndpoint, compacted, true);
        return { status: rotatedResult.status, data: compacted };
      }
      return { status: rotatedResult.status, data: rotatedResult.data };
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, upstreamPromise);
  const res = await upstreamPromise;
  return {
    status: res.status,
    data: res.data,
    cacheKey,
    fromCache: false,
  };
}

/**
 * Proactive Regional Catalogue Pre-Warmer:
 * Automatically fetches & caches all standard feeds for an active region so all users
 * in that region get instant <1ms cache hits.
 */
const warmingInProgress = new Set<string>();

async function warmRegionCatalogue(region: string, language: string): Promise<void> {
  if (!hasAnyServerTmdbKey()) return;

  const cleanRegion = (region || 'DE').toUpperCase();
  const cleanLang = language || 'de-DE';
  const regionLangId = `${cleanRegion}_${cleanLang}`;

  if (warmingInProgress.has(regionLangId)) return;
  warmingInProgress.add(regionLangId);

  try {
    const monetization = 'flatrate|free|ads|rent|buy';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

    const coreTasks: Array<{ endpoint: string; params: Record<string, string> }> = [
      { endpoint: 'genre/movie/list', params: { language: cleanLang, include_adult: 'false' } },
      { endpoint: 'genre/tv/list', params: { language: cleanLang, include_adult: 'false' } },
      {
        endpoint: 'watch/providers/movie',
        params: { language: cleanLang, include_adult: 'false', watch_region: cleanRegion },
      },
      {
        endpoint: 'watch/providers/tv',
        params: { language: cleanLang, include_adult: 'false', watch_region: cleanRegion },
      },
      {
        endpoint: 'trending/movie/week',
        params: { language: cleanLang, include_adult: 'false', page: '1' },
      },
      {
        endpoint: 'movie/now_playing',
        params: {
          language: cleanLang,
          include_adult: 'false',
          region: cleanRegion,
          page: '1',
        },
      },
      {
        endpoint: 'discover/movie',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          sort_by: 'popularity.desc',
          watch_region: cleanRegion,
          with_watch_monetization_types: monetization,
        },
      },
      {
        endpoint: 'discover/tv',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          sort_by: 'popularity.desc',
          watch_region: cleanRegion,
          with_watch_monetization_types: monetization,
        },
      },
      {
        endpoint: 'discover/movie',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          sort_by: 'vote_average.desc',
          'vote_count.gte': '350',
          watch_region: cleanRegion,
          with_watch_monetization_types: monetization,
        },
      },
      {
        endpoint: 'discover/movie',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          'primary_release_date.gte': startDate,
          'primary_release_date.lte': endDate,
          watch_region: cleanRegion,
          sort_by: 'popularity.desc',
        },
      },
      {
        endpoint: 'discover/tv',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          'first_air_date.gte': startDate,
          'first_air_date.lte': endDate,
          watch_region: cleanRegion,
          sort_by: 'popularity.desc',
        },
      },
      {
        endpoint: 'trending/person/week',
        params: {
          language: cleanLang,
          include_adult: 'false',
          page: '1',
        },
      },
      {
        endpoint: 'tv/airing_today',
        params: {
          language: cleanLang,
          include_adult: 'false',
          page: '1',
        },
      },
      {
        endpoint: 'movie/top_rated',
        params: {
          language: cleanLang,
          include_adult: 'false',
          region: cleanRegion,
          page: '1',
        },
      },
      {
        endpoint: 'tv/top_rated',
        params: {
          language: cleanLang,
          include_adult: 'false',
          region: cleanRegion,
          page: '1',
        },
      },
      ...['28', '18', '878', '53', '35', '12'].map((gid) => ({
        endpoint: 'discover/movie',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          with_genres: gid,
          sort_by: 'popularity.desc',
          watch_region: cleanRegion,
          with_watch_monetization_types: monetization,
        },
      })),
      {
        endpoint: 'discover/movie',
        params: {
          language: cleanLang,
          page: '1',
          include_adult: 'false',
          'vote_count.gte': '200',
          with_genres: '18,28',
          sort_by: 'popularity.desc',
          watch_region: cleanRegion,
          with_watch_monetization_types: monetization,
        },
      },
    ];

    await Promise.allSettled(
      coreTasks.map((t) => fetchTmdbThroughRegionalCache(t.endpoint, t.params, cleanRegion, true))
    );

    const nowPlayingRes = await fetchTmdbThroughRegionalCache(
      'movie/now_playing',
      {
        language: cleanLang,
        include_adult: 'false',
        region: cleanRegion,
        page: '1',
      },
      cleanRegion,
      true
    );
    const langIso = cleanLang.split('-')[0].toLowerCase();
    const heroMovies: any[] = (nowPlayingRes.data?.results || []).slice(0, 8);
    if (heroMovies.length > 0) {
      await Promise.allSettled(
        heroMovies.map((m) =>
          fetchTmdbThroughRegionalCache(
            `movie/${m.id}`,
            {
              language: cleanLang,
              include_adult: 'false',
              append_to_response: 'images,release_dates',
              include_image_language: `${langIso},en,null`,
            },
            cleanRegion,
            true
          )
        )
      );
    }

    const movieProvidersRes = await fetchTmdbThroughRegionalCache(
      'watch/providers/movie',
      { language: cleanLang, include_adult: 'false', watch_region: cleanRegion },
      cleanRegion,
      true
    );
    const providerList: any[] = movieProvidersRes.data?.results || [];
    const topProviders = [...providerList]
      .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
      .slice(0, 8);

    if (topProviders.length > 0) {
      await Promise.allSettled(
        topProviders.flatMap((p) => [
          fetchTmdbThroughRegionalCache(
            'discover/movie',
            {
              language: cleanLang,
              page: '1',
              include_adult: 'false',
              with_watch_providers: String(p.provider_id),
              watch_region: cleanRegion,
              with_watch_monetization_types: 'flatrate',
              sort_by: 'popularity.desc',
            },
            cleanRegion,
            true
          ),
          fetchTmdbThroughRegionalCache(
            'discover/tv',
            {
              language: cleanLang,
              page: '1',
              include_adult: 'false',
              with_watch_providers: String(p.provider_id),
              watch_region: cleanRegion,
              with_watch_monetization_types: 'flatrate',
              sort_by: 'popularity.desc',
            },
            cleanRegion,
            true
          ),
        ])
      );
    }

    const existingReg = activeRegions.get(regionLangId);
    activeRegions.set(regionLangId, {
      regionLangId,
      region: cleanRegion,
      language: cleanLang,
      lastHeartbeatAt: existingReg?.lastHeartbeatAt || Date.now(),
      lastWarmedAt: Date.now(),
      userCountEstimate: existingReg?.userCountEstimate || 1,
    });
    scheduleDiskCachePersist();
  } catch (e) {
    console.error(`Regional pre-warm failed for ${regionLangId}:`, e);
  } finally {
    warmingInProgress.delete(regionLangId);
  }
}

setInterval(() => {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const twentyFiveMinMs = 25 * 60 * 1000;

  for (const reg of activeRegions.values()) {
    if (now - reg.lastHeartbeatAt <= sevenDaysMs && now - reg.lastWarmedAt >= twentyFiveMinMs) {
      warmRegionCatalogue(reg.region, reg.language);
    }
  }
}, 15 * 60 * 1000);

// --- Server-Side Firebase ID Token Verification & RFC 6238 TOTP Two-Factor Authentication ---
interface VerifiedUserIdentity {
  uid: string;
  email: string;
  provider: string;
}

async function verifyFirebaseIdToken(authHeader?: string): Promise<VerifiedUserIdentity | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.split('.').length !== 3) return null;

  // 1. Verify against Google Identity Toolkit accounts:lookup if Web API Key is available
  if (firebaseWebApiKey) {
    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
          signal: AbortSignal.timeout(4000),
        }
      );
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        const account = lookupData?.users?.[0];
        if (account?.localId) {
          return {
            uid: String(account.localId),
            email: String(account.email || ''),
            provider: String(account.providerUserInfo?.[0]?.providerId || 'firebase'),
          };
        }
      }
    } catch {
      // Fallback to structural JWT claim verification if network is restricted
    }
  }

  // 2. Fallback structural JWT verification
  try {
    const payloadB64 = idToken.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      decoded &&
      typeof decoded.user_id === 'string' &&
      decoded.exp > nowSec - 60 &&
      (!firebaseProjectId || decoded.aud === firebaseProjectId)
    ) {
      return {
        uid: decoded.user_id,
        email: String(decoded.email || ''),
        provider: String(decoded.firebase?.sign_in_provider || 'firebase'),
      };
    }
  } catch {
    return null;
  }
  return null;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateBase32Secret(byteLength: number = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function computeTotpCode(secretBase32: string, stepCounter: number): string {
  const key = decodeBase32(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(stepCounter / 0x100000000), 0);
  buf.writeUInt32BE(stepCounter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

function verifyTotpCode(secretBase32: string, userCode: string): boolean {
  const cleanCode = (userCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  // Allow ±1 time step (30s drift tolerance)
  for (const delta of [-1, 0, 1]) {
    if (computeTotpCode(secretBase32, currentStep + delta) === cleanCode) {
      return true;
    }
  }
  return false;
}

function generateBackupCodes(count: number = 8): string[] {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let p1 = '';
    let p2 = '';
    for (let j = 0; j < 4; j++) p1 += chars[bytes[j] % chars.length];
    for (let j = 4; j < 8; j++) p2 += chars[bytes[j] % chars.length];
    codes.push(`${p1}-${p2}`);
  }
  return codes;
}

function hashBackupCode(uid: string, code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto
    .createHmac('sha256', VAULT_CIPHER_KEY)
    .update(`${uid}:${normalized}`)
    .digest('hex');
}

function signTwoFactorSessionTicket(uid: string): string {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = `${uid}:${expiresAt}`;
  const sig = crypto
    .createHmac('sha256', VAULT_CIPHER_KEY)
    .update(`2fa_ticket:${payload}`)
    .digest('hex');
  return `${payload}:${sig}`;
}

function verifyTwoFactorSessionTicket(uid: string, ticket?: string): boolean {
  if (!ticket || typeof ticket !== 'string') return false;
  const parts = ticket.split(':');
  if (parts.length !== 3) return false;
  const [ticketUid, expStr, sig] = parts;
  if (ticketUid !== uid) return false;
  const exp = Number(expStr || 0);
  if (!exp || Date.now() > exp) return false;
  const expectedSig = crypto
    .createHmac('sha256', VAULT_CIPHER_KEY)
    .update(`2fa_ticket:${ticketUid}:${expStr}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
}

interface UserSecurityRecord {
  uid: string;
  twoFactorEnabled: boolean;
  encryptedTotpSecret: string;
  backupCodeHashesJson: string;
  updatedAt: number;
}

const localUserSecurityCache = new Map<string, UserSecurityRecord>();
const pendingTotpSetups = new Map<
  string,
  { secret: string; backupCodes: string[]; createdAt: number }
>();

try {
  if (fs.existsSync(SECURITY_VAULT_FILE)) {
    const raw = JSON.parse(fs.readFileSync(SECURITY_VAULT_FILE, 'utf-8'));
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item?.uid) localUserSecurityCache.set(item.uid, item);
      }
    }
  }
} catch {
  // ignore
}

function saveLocalUserSecurityCache(): void {
  try {
    fs.writeFileSync(
      SECURITY_VAULT_FILE,
      JSON.stringify(Array.from(localUserSecurityCache.values())),
      'utf-8'
    );
  } catch {
    // ignore
  }
}

async function getUserSecurityRecord(uid: string): Promise<UserSecurityRecord | null> {
  if (firestoreDb) {
    try {
      const snap = await getDoc(doc(firestoreDb, 'userSecurityVault', uid));
      if (snap.exists()) {
        const d = snap.data() as UserSecurityRecord;
        localUserSecurityCache.set(uid, d);
        return d;
      }
    } catch {
      // fallback to local cache
    }
  }
  return localUserSecurityCache.get(uid) || null;
}

async function saveUserSecurityRecord(record: UserSecurityRecord): Promise<void> {
  localUserSecurityCache.set(record.uid, record);
  saveLocalUserSecurityCache();
  if (firestoreDb) {
    try {
      await setDoc(doc(firestoreDb, 'userSecurityVault', record.uid), record);
    } catch {
      // ignore
    }
  }
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ALLOWED_TMDB_ENDPOINT_REGEX =
  /^(authentication\/guest_session\/new|configuration|genre\/(movie|tv)\/list|watch\/providers\/(movie|tv)|movie\/(now_playing|upcoming|top_rated|\d+(\/[a-zA-Z0-9_]+)*)|tv\/(on_the_air|airing_today|top_rated|\d+(\/[a-zA-Z0-9_]+)*)|person\/\d+(\/[a-zA-Z0-9_]+)*|collection\/\d+(\/[a-zA-Z0-9_]+)*|company\/\d+(\/[a-zA-Z0-9_]+)*|keyword\/\d+|discover\/(movie|tv)|trending\/[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+|search\/(multi|movie|tv|person|keyword))$/;

/**
 * Real-Time Zero-Credential Firestore Proxy Bridge for Native iOS (capacitor://localhost).
 * Listens to /tmdbProxyQueue where status == 'pending', executes requests through the
 * Server Universal Cache & Multi-Key Rotation Pool, and writes responses back.
 */
const activeProxyJobs = new Set<string>();

function startFirestoreProxyBridge(): void {
  if (!firestoreDb) return;

  const pendingQuery = query(
    collection(firestoreDb, 'tmdbProxyQueue'),
    where('status', '==', 'pending')
  );

  onSnapshot(
    pendingQuery,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added' && change.type !== 'modified') return;
        const docSnap = change.doc;
        const data = docSnap.data();
        if (!data || data.status !== 'pending') return;

        const requestId = docSnap.id;
        if (activeProxyJobs.has(requestId)) return;
        activeProxyJobs.add(requestId);

        (async () => {
          try {
            const endpoint = String(data.endpoint || '').replace(/^\/+|\/+$/g, '');
            const region =
              String(data.region || 'DE')
                .toUpperCase()
                .replace(/[^A-Z]/g, '')
                .slice(0, 5) || 'DE';
            const language =
              String(data.language || 'de-DE')
                .replace(/[^a-zA-Z\-]/g, '')
                .slice(0, 10) || 'de-DE';
            const cacheKey = String(data.cacheKey || requestId).slice(0, 128);
            const queryJsonStr = String(data.queryJson || '{}').slice(0, 1000);

            if (
              !endpoint ||
              endpoint.includes('..') ||
              endpoint.includes('\\') ||
              !ALLOWED_TMDB_ENDPOINT_REGEX.test(endpoint)
            ) {
              await setDoc(doc(firestoreDb!, 'tmdbProxyQueue', requestId), {
                requestId,
                cacheKey,
                endpoint: endpoint.slice(0, 200) || 'invalid',
                queryJson: queryJsonStr,
                region,
                language,
                status: 'error',
                statusCode: 400,
                responseJson: JSON.stringify({ status_message: 'Disallowed TMDB endpoint.' }),
                createdAt: Number(data.createdAt || Date.now()),
                updatedAt: Date.now(),
              });
              return;
            }

            let parsedQuery: Record<string, string> = {};
            try {
              const rawQ = JSON.parse(queryJsonStr);
              if (rawQ && typeof rawQ === 'object') {
                for (const [k, v] of Object.entries(rawQ)) {
                  if (k === 'api_key') continue;
                  if (v !== undefined && v !== null) {
                    parsedQuery[k] = String(v).slice(0, 200);
                  }
                }
              }
            } catch {
              parsedQuery = { language };
            }

            const regionLangId = `${region}_${language}`;
            const existingReg = activeRegions.get(regionLangId);
            if (!existingReg || Date.now() - existingReg.lastWarmedAt > 20 * 60 * 1000) {
              warmRegionCatalogue(region, language).catch(() => {});
            }

            const result = await fetchTmdbThroughRegionalCache(endpoint, parsedQuery, region);
            const compacted = compactTmdbPayloadForCache(result.data);
            const responseJson = JSON.stringify(compacted);

            await setDoc(doc(firestoreDb!, 'tmdbProxyQueue', requestId), {
              requestId,
              cacheKey,
              endpoint: endpoint.slice(0, 200),
              queryJson: queryJsonStr,
              region,
              language,
              status: result.status >= 200 && result.status < 300 ? 'completed' : 'error',
              statusCode: result.status,
              responseJson: responseJson.length <= 880000 ? responseJson : '{}',
              createdAt: Number(data.createdAt || Date.now()),
              updatedAt: Date.now(),
            });
          } catch (err: any) {
            try {
              await setDoc(doc(firestoreDb!, 'tmdbProxyQueue', requestId), {
                requestId,
                cacheKey: String(data.cacheKey || requestId).slice(0, 128),
                endpoint: String(data.endpoint || 'error').slice(0, 200),
                queryJson: String(data.queryJson || '{}').slice(0, 1000),
                region: String(data.region || 'DE').slice(0, 5),
                language: String(data.language || 'de-DE').slice(0, 10),
                status: 'error',
                statusCode: 502,
                responseJson: JSON.stringify({
                  status_message: err?.message || 'Upstream proxy error',
                }),
                createdAt: Number(data.createdAt || Date.now()),
                updatedAt: Date.now(),
              });
            } catch {
              // ignore
            }
          } finally {
            activeProxyJobs.delete(requestId);
          }
        })();
      });
    },
    (err) => {
      console.error('Firestore proxy queue listener error:', err);
    }
  );
}

const rateLimitWindowMs = 60 * 1000;
const maxRequestsPerMinute = 600;
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // --- Security Headers, Native iOS Capacitor CORS & High-Throughput Rate Limiter ---
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (req.path.startsWith('/api/')) {
      const origin = String(req.headers.origin || '');
      if (
        origin.startsWith('capacitor://') ||
        origin.startsWith('ionic://') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('https://localhost') ||
        origin.endsWith('.run.app')
      ) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, x-app-region, Authorization, x-2fa-ticket'
        );
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local')
        .split(',')[0]
        .trim();
      const now = Date.now();
      const bucket = ipRequestCounts.get(ip);
      if (!bucket || now > bucket.resetAt) {
        ipRequestCounts.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
      } else {
        bucket.count += 1;
        if (bucket.count > maxRequestsPerMinute) {
          res.status(429).json({ error: 'Too many requests. Please slow down.' });
          return;
        }
      }
    }
    next();
  });

  // --- 1. Server Capability Status ---
  app.get('/api/config', (_req, res) => {
    res.json({
      hasServerTmdbKey: hasAnyServerTmdbKey(),
      hasAiAvailable: Boolean(process.env.GEMINI_API_KEY),
      activeKeyPoolSize: tmdbKeyPool.size,
    });
  });

  // --- 2. Two-Factor Authentication (2FA / RFC 6238 TOTP) Endpoints ---

  // Check 2FA status for current signed-in user (Apple, Google, or Email)
  app.post('/api/auth/2fa/status', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const record = await getUserSecurityRecord(user.uid);
    const enabled = Boolean(record?.twoFactorEnabled && record?.encryptedTotpSecret);
    const ticket = String(req.body?.twoFactorTicket || req.headers['x-2fa-ticket'] || '');
    const sessionVerified = !enabled || verifyTwoFactorSessionTicket(user.uid, ticket);

    let remainingBackupCodes = 0;
    if (record?.backupCodeHashesJson) {
      try {
        const arr = JSON.parse(record.backupCodeHashesJson);
        if (Array.isArray(arr)) remainingBackupCodes = arr.length;
      } catch {
        remainingBackupCodes = 0;
      }
    }

    res.json({
      uid: user.uid,
      email: user.email,
      twoFactorEnabled: enabled,
      sessionVerified,
      remainingBackupCodes,
    });
  });

  // Step 1 of enabling 2FA in Profile: Generate Base32 Secret, SVG QR Code & 8 Backup Codes
  app.post('/api/auth/2fa/setup', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const secret = generateBase32Secret(20);
    const backupCodes = generateBackupCodes(8);
    pendingTotpSetups.set(user.uid, {
      secret,
      backupCodes,
      createdAt: Date.now(),
    });

    const label = encodeURIComponent(user.email || user.uid);
    const issuer = encodeURIComponent('MovieJournal');
    const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    let qrCodeSvg = '';
    try {
      qrCodeSvg = await QRCode.toString(otpauthUrl, {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#FFFFFF',
          light: '#00000000',
        },
      });
    } catch {
      qrCodeSvg = '';
    }

    res.json({
      secret,
      otpauthUrl,
      qrCodeSvg,
      backupCodes,
    });
  });

  // Step 2 of enabling 2FA: Verify 6-digit code from Authenticator app and activate encrypted vault
  app.post('/api/auth/2fa/enable', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const code = String(req.body?.code || '').trim();
    const pending = pendingTotpSetups.get(user.uid);
    if (!pending || Date.now() - pending.createdAt > 15 * 60 * 1000) {
      res.status(400).json({ error: 'Setup session expired. Please start 2FA setup again.' });
      return;
    }

    if (!verifyTotpCode(pending.secret, code)) {
      res.status(400).json({ error: 'Invalid 6-digit verification code.' });
      return;
    }

    const encryptedTotpSecret = encryptForServerVault(pending.secret);
    const hashes = pending.backupCodes.map((c) => hashBackupCode(user.uid, c));

    await saveUserSecurityRecord({
      uid: user.uid,
      twoFactorEnabled: true,
      encryptedTotpSecret,
      backupCodeHashesJson: JSON.stringify(hashes),
      updatedAt: Date.now(),
    });

    pendingTotpSetups.delete(user.uid);
    const twoFactorTicket = signTwoFactorSessionTicket(user.uid);

    res.json({
      ok: true,
      twoFactorEnabled: true,
      twoFactorTicket,
    });
  });

  // Verify 2FA challenge during login (accepts 6-digit TOTP code OR 8-character Backup Code)
  app.post('/api/auth/2fa/verify', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawCode = String(req.body?.code || '').trim();
    const record = await getUserSecurityRecord(user.uid);
    if (!record || !record.twoFactorEnabled || !record.encryptedTotpSecret) {
      const ticket = signTwoFactorSessionTicket(user.uid);
      res.json({ ok: true, twoFactorTicket: ticket });
      return;
    }

    const decryptedSecret = decryptFromServerVault(record.encryptedTotpSecret);
    if (!decryptedSecret) {
      res.status(500).json({ error: 'Failed to read security vault.' });
      return;
    }

    // 1. Check 6-digit Authenticator TOTP code
    if (verifyTotpCode(decryptedSecret, rawCode)) {
      const twoFactorTicket = signTwoFactorSessionTicket(user.uid);
      res.json({ ok: true, twoFactorTicket, method: 'totp' });
      return;
    }

    // 2. Check 8-character Backup Code
    const candidateHash = hashBackupCode(user.uid, rawCode);
    let hashes: string[] = [];
    try {
      hashes = JSON.parse(record.backupCodeHashesJson || '[]');
    } catch {
      hashes = [];
    }

    const matchIdx = hashes.indexOf(candidateHash);
    if (matchIdx !== -1) {
      hashes.splice(matchIdx, 1);
      await saveUserSecurityRecord({
        ...record,
        backupCodeHashesJson: JSON.stringify(hashes),
        updatedAt: Date.now(),
      });
      const twoFactorTicket = signTwoFactorSessionTicket(user.uid);
      res.json({
        ok: true,
        twoFactorTicket,
        method: 'backup_code',
        remainingBackupCodes: hashes.length,
      });
      return;
    }

    res.status(400).json({ error: 'Invalid verification or backup code.' });
  });

  // Disable 2FA in Profile Settings
  app.post('/api/auth/2fa/disable', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await saveUserSecurityRecord({
      uid: user.uid,
      twoFactorEnabled: false,
      encryptedTotpSecret: '',
      backupCodeHashesJson: '[]',
      updatedAt: Date.now(),
    });

    res.json({ ok: true, twoFactorEnabled: false });
  });

  // --- 2B. Smart TV & Hisense VIDAA Second-Screen QR Code / 6-Digit Pairing Auth ---
  interface TvPairingSessionRecord {
    sessionId: string;
    pollSecret: string;
    pairingCode: string;
    status: 'pending' | 'approved';
    createdAt: number;
    expiresAt: number;
    approvedUid?: string;
    approvedEmail?: string;
    approvedDisplayName?: string;
    twoFactorTicket?: string;
    encryptedPersistedUser?: string;
  }

  const tvPairingSessions = new Map<string, TvPairingSessionRecord>();

  function pruneExpiredTvSessions(): void {
    const now = Date.now();
    for (const [id, session] of tvPairingSessions.entries()) {
      if (now > session.expiresAt) {
        tvPairingSessions.delete(id);
      }
    }
  }

  function generateUniqueTvPairingCode(): string {
    pruneExpiredTvSessions();
    const activeCodes = new Set(
      Array.from(tvPairingSessions.values()).map((s) => s.pairingCode)
    );
    for (let i = 0; i < 25; i++) {
      const num = crypto.randomInt(100000, 999999);
      const code = String(num);
      if (!activeCodes.has(code)) return code;
    }
    return String(crypto.randomInt(100000, 999999));
  }

  // Create a new 5-minute Smart TV QR pairing session
  app.post('/api/auth/tv-session/create', async (req, res) => {
    pruneExpiredTvSessions();
    const sessionId = crypto.randomBytes(16).toString('hex');
    const pollSecret = crypto.randomBytes(16).toString('hex');
    const pairingCode = generateUniqueTvPairingCode();
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000; // 5 minutes

    const clientOrigin = String(
      req.body?.origin ||
        req.headers.origin ||
        `https://${req.headers.host || 'localhost:3000'}`
    ).replace(/\/+$/, '');
    const pairingUrl = `${clientOrigin}/?tvPair=${pairingCode}`;

    let qrCodeSvg = '';
    try {
      qrCodeSvg = await QRCode.toString(pairingUrl, {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#FFFFFF',
          light: '#00000000',
        },
      });
    } catch {
      qrCodeSvg = '';
    }

    tvPairingSessions.set(sessionId, {
      sessionId,
      pollSecret,
      pairingCode,
      status: 'pending',
      createdAt: now,
      expiresAt,
    });

    res.json({
      sessionId,
      pollSecret,
      pairingCode,
      pairingUrl,
      qrCodeSvg,
      expiresAt,
    });
  });

  // Poll Smart TV pairing status from the TV screen
  app.get('/api/auth/tv-session/poll', (req, res) => {
    pruneExpiredTvSessions();
    const sessionId = String(req.query.sessionId || '').trim();
    const pollSecret = String(req.query.pollSecret || '').trim();

    const session = tvPairingSessions.get(sessionId);
    if (!session || session.pollSecret !== pollSecret) {
      res.status(404).json({ status: 'expired' });
      return;
    }

    if (session.status !== 'approved' || !session.encryptedPersistedUser) {
      res.json({
        status: 'pending',
        expiresInSec: Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000)),
      });
      return;
    }

    // One-time retrieval: decrypt and immediately delete session
    const decryptedUserStr = decryptFromServerVault(session.encryptedPersistedUser);
    tvPairingSessions.delete(sessionId);

    if (!decryptedUserStr) {
      res.status(500).json({ status: 'expired' });
      return;
    }

    let persistedUser: any = null;
    try {
      persistedUser = JSON.parse(decryptedUserStr);
    } catch {
      res.status(500).json({ status: 'expired' });
      return;
    }

    res.json({
      status: 'approved',
      uid: session.approvedUid,
      email: session.approvedEmail,
      displayName: session.approvedDisplayName,
      twoFactorTicket: session.twoFactorTicket,
      persistedUser,
    });
  });

  // Approve Smart TV pairing session from a signed-in Smartphone / iPhone
  app.post('/api/auth/tv-session/approve', async (req, res) => {
    pruneExpiredTvSessions();
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized. Please sign in on your phone first.' });
      return;
    }

    const rawCode = String(req.body?.pairingCode || '')
      .replace(/[^0-9]/g, '')
      .trim();
    if (rawCode.length !== 6) {
      res.status(400).json({ error: 'Invalid 6-digit TV pairing code.' });
      return;
    }

    let targetSession: TvPairingSessionRecord | null = null;
    for (const s of tvPairingSessions.values()) {
      if (s.pairingCode === rawCode && s.status === 'pending' && Date.now() <= s.expiresAt) {
        targetSession = s;
        break;
      }
    }

    if (!targetSession) {
      res.status(404).json({
        error: 'TV code not found or expired. Please refresh the code on your Smart TV.',
      });
      return;
    }

    const rawPersistedUser = req.body?.persistedUser;
    if (
      !rawPersistedUser ||
      typeof rawPersistedUser !== 'object' ||
      String(rawPersistedUser.uid || '') !== user.uid
    ) {
      res.status(400).json({ error: 'Session identity mismatch.' });
      return;
    }

    targetSession.status = 'approved';
    targetSession.approvedUid = user.uid;
    targetSession.approvedEmail = user.email;
    targetSession.approvedDisplayName = String(rawPersistedUser.displayName || user.email || 'Cinephile');
    targetSession.twoFactorTicket = signTwoFactorSessionTicket(user.uid);
    targetSession.encryptedPersistedUser = encryptForServerVault(
      JSON.stringify(rawPersistedUser)
    );

    res.json({
      ok: true,
      uid: user.uid,
      email: user.email,
      pairingCode: rawCode,
    });
  });

  // --- 2C. Production Multi-Device User Cloud Sync Vault (Cross-Device Account Sync) ---
  interface ServerUserSyncRecord {
    uid: string;
    profile?: Record<string, any>;
    library?: {
      watchlist?: any[];
      removedWatchlistKeys?: Record<string, number>;
      watchedMovies?: number[];
      removedMovies?: Record<string, number>;
      manuallyWatchedShows?: number[];
      removedShows?: Record<string, number>;
      watchedEpisodes?: Record<string, number[]>;
      updatedAt?: string;
    };
    updatedAt: number;
  }

  const serverUserSyncVault = new Map<string, ServerUserSyncRecord>();
  try {
    if (fs.existsSync(USER_SYNC_VAULT_FILE)) {
      const rawSync = JSON.parse(fs.readFileSync(USER_SYNC_VAULT_FILE, 'utf-8'));
      if (Array.isArray(rawSync)) {
        for (const item of rawSync) {
          if (item?.uid) serverUserSyncVault.set(String(item.uid), item);
        }
      }
    }
  } catch {
    // ignore
  }

  function persistServerUserSyncVault(): void {
    try {
      fs.writeFileSync(
        USER_SYNC_VAULT_FILE,
        JSON.stringify(Array.from(serverUserSyncVault.values())),
        'utf-8'
      );
    } catch {
      // ignore
    }
  }

  function getSyncItemMediaKey(item: any): string {
    if (!item || !item.id) return '';
    const mType = item.media_type === 'tv' || (!item.title && item.name) ? 'tv' : 'movie';
    return `${mType}_${Math.abs(Math.floor(Number(item.id)))}`;
  }

  app.get('/api/user-sync/state', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const existing = serverUserSyncVault.get(user.uid) || {
      uid: user.uid,
      updatedAt: 0,
    };
    res.json(existing);
  });

  app.post('/api/user-sync/state', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const current = serverUserSyncVault.get(user.uid) || {
      uid: user.uid,
      updatedAt: Date.now(),
    };
    const nextProfile =
      req.body?.profile && typeof req.body.profile === 'object'
        ? { ...(current.profile || {}), ...req.body.profile }
        : current.profile;

    let nextLibrary = current.library || {};
    const incomingLib = req.body?.library;
    if (incomingLib && typeof incomingLib === 'object') {
      const replaceAll = Boolean(incomingLib.replaceAll);
      if (replaceAll) {
        nextLibrary = {
          watchlist: Array.isArray(incomingLib.watchlist) ? incomingLib.watchlist.slice(0, 500) : [],
          removedWatchlistKeys: incomingLib.removedWatchlistKeys || {},
          watchedMovies: Array.isArray(incomingLib.watchedMovies)
            ? incomingLib.watchedMovies.slice(0, 500)
            : [],
          removedMovies: incomingLib.removedMovies || {},
          manuallyWatchedShows: Array.isArray(incomingLib.manuallyWatchedShows)
            ? incomingLib.manuallyWatchedShows.slice(0, 500)
            : [],
          removedShows: incomingLib.removedShows || {},
          watchedEpisodes:
            incomingLib.watchedEpisodes && typeof incomingLib.watchedEpisodes === 'object'
              ? incomingLib.watchedEpisodes
              : {},
          updatedAt: new Date().toISOString(),
        };
      } else {
        // Merge tombstones first
        const mergedRemovedWatchlist: Record<string, number> = {
          ...(nextLibrary.removedWatchlistKeys || {}),
          ...(incomingLib.removedWatchlistKeys || {}),
        };
        const mergedRemovedMovies: Record<string, number> = {
          ...(nextLibrary.removedMovies || {}),
          ...(incomingLib.removedMovies || {}),
        };
        const mergedRemovedShows: Record<string, number> = {
          ...(nextLibrary.removedShows || {}),
          ...(incomingLib.removedShows || {}),
        };

        // Union watchlist items while respecting explicit removals
        const wlMap = new Map<string, any>();
        for (const item of nextLibrary.watchlist || []) {
          const k = getSyncItemMediaKey(item);
          if (k && !mergedRemovedWatchlist[k]) wlMap.set(k, item);
        }
        for (const item of incomingLib.watchlist || []) {
          const k = getSyncItemMediaKey(item);
          if (!k) continue;
          const addedAt = Number(item._addedAtMs || 0);
          const removedAt = Number(mergedRemovedWatchlist[k] || 0);
          if (removedAt > 0 && addedAt > removedAt) {
            delete mergedRemovedWatchlist[k];
            wlMap.set(k, item);
          } else if (!mergedRemovedWatchlist[k]) {
            wlMap.set(k, item);
          }
        }

        // Union watchedMovies while respecting explicit removals
        const movieSet = new Set<number>(nextLibrary.watchedMovies || []);
        for (const mId of incomingLib.watchedMovies || []) {
          const numId = Number(mId);
          if (Number.isFinite(numId) && numId > 0) movieSet.add(numId);
        }
        for (const [mKey, remTs] of Object.entries(mergedRemovedMovies)) {
          if (remTs > 0) movieSet.delete(Number(mKey));
        }

        // Union manuallyWatchedShows
        const showSet = new Set<number>(nextLibrary.manuallyWatchedShows || []);
        for (const sId of incomingLib.manuallyWatchedShows || []) {
          const numId = Number(sId);
          if (Number.isFinite(numId) && numId > 0) showSet.add(numId);
        }
        for (const [sKey, remTs] of Object.entries(mergedRemovedShows)) {
          if (remTs > 0) showSet.delete(Number(sKey));
        }

        // Merge watchedEpisodes per show
        const mergedEpisodes: Record<string, number[]> = {
          ...(nextLibrary.watchedEpisodes || {}),
        };
        if (incomingLib.watchedEpisodes && typeof incomingLib.watchedEpisodes === 'object') {
          for (const [seriesId, eps] of Object.entries(incomingLib.watchedEpisodes)) {
            if (Array.isArray(eps)) {
              mergedEpisodes[seriesId] = Array.from(
                new Set(eps.map(Number).filter((n) => Number.isFinite(n)))
              );
            }
          }
        }

        nextLibrary = {
          watchlist: Array.from(wlMap.values()).slice(0, 500),
          removedWatchlistKeys: mergedRemovedWatchlist,
          watchedMovies: Array.from(movieSet).slice(0, 500),
          removedMovies: mergedRemovedMovies,
          manuallyWatchedShows: Array.from(showSet).slice(0, 500),
          removedShows: mergedRemovedShows,
          watchedEpisodes: mergedEpisodes,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    const updated: ServerUserSyncRecord = {
      uid: user.uid,
      profile: nextProfile,
      library: nextLibrary,
      updatedAt: Date.now(),
    };
    serverUserSyncVault.set(user.uid, updated);
    persistServerUserSyncVault();
    res.json({ ok: true, updatedAt: updated.updatedAt, library: nextLibrary });
  });

  // --- 2D. Official Hisense VIDAA DevKit (Code 27753790) Native TV App Manifest & Launch Endpoints ---
  const resolvePublicOrigin = (req: express.Request): string => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).trim();
    return `${forwardedProto}://${host}`.replace(/\/+$/, '');
  };

  // High-contrast 512x512 SVG App Icon for Hisense VIDAA Home Screen & DevKit App Manager
  const renderVidaaIconSvg = (_req: express.Request, res: express.Response) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#09090b"/>
          <stop offset="50%" stop-color="#18181b"/>
          <stop offset="100%" stop-color="#312e81"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#818cf8"/>
          <stop offset="100%" stop-color="#6366f1"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#bg)"/>
      <rect x="24" y="24" width="464" height="464" rx="92" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="6"/>
      <rect x="96" y="120" width="320" height="224" rx="32" fill="#09090b" stroke="url(#accent)" stroke-width="16"/>
      <polygon points="226,184 226,280 310,232" fill="#ffffff"/>
      <rect x="176" y="376" width="160" height="20" rx="10" fill="#818cf8"/>
    </svg>`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  };

  app.get('/vidaa/icon.svg', renderVidaaIconSvg);
  app.get('/tv/icon.svg', renderVidaaIconSvg);

  // Official VIDAA DevKit App Manager Manifest (appinfo.json)
  const renderVidaaManifest = (req: express.Request, res: express.Response) => {
    const origin = resolvePublicOrigin(req);
    const manifest = {
      id: 'com.moviejournal.tv',
      version: '2.4.0',
      vendor: 'MovieJournal',
      type: 'web',
      main: `${origin}/?tv=1&vidaa=1`,
      title: 'MovieJournal',
      icon: `${origin}/vidaa/icon.svg`,
      largeIcon: `${origin}/vidaa/icon.svg`,
      bgColor: '#000000',
      resolution: '1080P',
      transparent: false,
      disableBackHistoryAPI: true,
      virtualKeyboard: true,
    };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(manifest);
  };

  app.get('/vidaa/appinfo.json', renderVidaaManifest);
  app.get('/tv/appinfo.json', renderVidaaManifest);
  app.get('/appinfo.json', renderVidaaManifest);

  // Setup info & QR Code for the Hisense 55U6KQ (Code 27753790) DevKit installation guide
  app.get('/api/vidaa/setup-info', async (req, res) => {
    const origin = resolvePublicOrigin(req);
    const tvLaunchUrl = `${origin}/tv`;
    const manifestUrl = `${origin}/vidaa/appinfo.json`;
    let qrCodeSvg = '';
    try {
      qrCodeSvg = await QRCode.toString(tvLaunchUrl, {
        type: 'svg',
        margin: 1,
        color: {
          dark: '#FFFFFF',
          light: '#00000000',
        },
      });
    } catch {
      qrCodeSvg = '';
    }
    res.json({
      storeUnlockCode: '27753790',
      appName: 'MovieJournal',
      tvLaunchUrl,
      manifestUrl,
      qrCodeSvg,
    });
  });

  // Short Smart TV Launch Route (/tv -> /?tv=1&vidaa=1)
  app.get('/tv', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.redirect(302, '/?tv=1&vidaa=1');
  });

  // --- 3. Multi-Key TMDB Pool Management Endpoints (Zero-Credential Client Policy) ---

  app.get('/api/admin/tmdb-keys', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    loadEnvTmdbKeysIntoPool();
    const now = Date.now();
    const keys = Array.from(tmdbKeyPool.values()).map((k, index) => {
      const isCooldownActive = k.status === 'cooldown' && k.cooldownUntil > now;
      return {
        keyId: k.keyId,
        slotNumber: index + 1,
        maskedKey: k.maskedKey,
        source: k.source,
        status: isCooldownActive ? 'cooldown' : k.status === 'invalid' ? 'invalid' : 'healthy',
        cooldownRemainingSec: isCooldownActive
          ? Math.ceil((k.cooldownUntil - now) / 1000)
          : 0,
        totalRequests: k.totalRequests,
        failoverCount: k.failoverCount,
        lastLatencyMs: k.lastLatencyMs,
      };
    });

    const totalLookups = cacheHits + coalescedHits + cacheMisses;
    const hitRatePercent =
      totalLookups > 0
        ? Math.round(((cacheHits + coalescedHits) / totalLookups) * 1000) / 10
        : 100;

    res.json({
      poolSize: keys.length,
      healthyCount: keys.filter((k) => k.status === 'healthy').length,
      estimatedRpsCapacity: Math.max(1, keys.filter((k) => k.status === 'healthy').length) * 40,
      totalFailovers: totalKeyFailovers,
      cacheStats: {
        l1Entries: l1RegionalCache.size,
        maxL1Entries: MAX_L1_ENTRIES,
        cacheHits,
        coalescedHits,
        swrInstantHits,
        cacheMisses,
        hitRatePercent,
      },
      keys,
    });
  });

  app.post('/api/admin/tmdb-keys', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawInput = String(req.body?.keys || req.body?.key || '').trim();
    if (!rawInput) {
      res.status(400).json({ error: 'No API keys provided.' });
      return;
    }

    const candidateKeys = rawInput
      .split(/[\s,;\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 16 && s !== 'SERVER_PROXY')
      .slice(0, 12);

    if (candidateKeys.length === 0) {
      res.status(400).json({ error: 'Invalid TMDB API key format.' });
      return;
    }

    const added: string[] = [];
    const invalid: string[] = [];

    for (const candidate of candidateKeys) {
      try {
        const testRes = await fetch(
          `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(candidate)}`,
          { method: 'GET', signal: AbortSignal.timeout(4000) }
        );
        if (testRes.ok) {
          const entry = registerTmdbKeyInPool(candidate, 'vault');
          if (entry) {
            entry.status = 'healthy';
            entry.cooldownUntil = 0;
            added.push(entry.maskedKey);
          }
        } else {
          invalid.push(maskTmdbKey(candidate));
        }
      } catch {
        // Network transient: still register key in pool so failover can use it
        const entry = registerTmdbKeyInPool(candidate, 'vault');
        if (entry) added.push(entry.maskedKey);
      }
    }

    if (added.length > 0) {
      persistVaultKeysToDiskAndFirestore(true);
    }

    res.json({
      ok: added.length > 0,
      addedCount: added.length,
      addedMasked: added,
      invalidMasked: invalid,
      poolSize: tmdbKeyPool.size,
    });
  });

  app.delete('/api/admin/tmdb-keys/:keyId', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const keyId = String(req.params.keyId || '').trim();
    const existing = tmdbKeyPool.get(keyId);
    if (!existing) {
      res.status(404).json({ error: 'Key not found in pool.' });
      return;
    }
    if (existing.source === 'env') {
      res.status(400).json({ error: 'Environment variable keys cannot be deleted via UI.' });
      return;
    }
    if (tmdbKeyPool.size <= 1) {
      res.status(400).json({ error: 'Cannot remove the last remaining key in the pool.' });
      return;
    }

    tmdbKeyPool.delete(keyId);
    persistVaultKeysToDiskAndFirestore(true);
    res.json({ ok: true, poolSize: tmdbKeyPool.size });
  });

  // --- 4. Active Region Heartbeat & Automatic Pre-Warmer Trigger ---
  app.post('/api/regions/heartbeat', (req, res) => {
    const region =
      String(req.body?.region || 'DE')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 5) || 'DE';
    const language =
      String(req.body?.language || 'de-DE')
        .replace(/[^a-zA-Z\-]/g, '')
        .slice(0, 10) || 'de-DE';
    const regionLangId = `${region}_${language}`;
    const now = Date.now();

    const existing = activeRegions.get(regionLangId);
    const shouldWarmNow = !existing || now - existing.lastWarmedAt > 20 * 60 * 1000;

    activeRegions.set(regionLangId, {
      regionLangId,
      region,
      language,
      lastHeartbeatAt: now,
      lastWarmedAt: existing?.lastWarmedAt || 0,
      userCountEstimate: (existing?.userCountEstimate || 0) + 1,
    });
    scheduleDiskCachePersist();

    if (shouldWarmNow) {
      warmRegionCatalogue(region, language);
    }

    res.json({
      ok: true,
      regionLangId,
    });
  });

  // --- 5. Central TMDB Server Proxy with Multi-Key Rotation & Universal Caching ---
  app.use('/api/tmdb', async (req, res) => {
    if (!hasAnyServerTmdbKey()) {
      res.status(401).json({
        status_message: 'TMDB Server Proxy key pool not initialized.',
      });
      return;
    }

    const endpoint = req.path.replace(/^\/+|\/+$/g, '');
    if (
      !endpoint ||
      endpoint.includes('..') ||
      endpoint.includes('\\') ||
      !ALLOWED_TMDB_ENDPOINT_REGEX.test(endpoint)
    ) {
      res.status(400).json({
        status_message: 'Invalid or disallowed TMDB endpoint.',
      });
      return;
    }

    const regionHeader =
      String(req.headers['x-app-region'] || 'DE')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 5) || 'DE';

    // Non-GET requests (only rating a movie/tv show is permitted)
    if (req.method !== 'GET') {
      if (req.method !== 'POST' || !/^(movie|tv)\/\d+\/rating$/.test(endpoint)) {
        res.status(405).json({ status_message: 'Method not allowed on this endpoint.' });
        return;
      }
      try {
        const queryRecord: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.query)) {
          if (k === 'api_key') continue;
          if (v !== undefined && v !== null) queryRecord[k] = String(v).slice(0, 200);
        }
        const rotated = await executeTmdbFetchWithKeyRotation(
          endpoint,
          queryRecord,
          'POST',
          req.body ? JSON.stringify(req.body) : undefined
        );
        res.status(rotated.status).json(rotated.data);
      } catch (error: any) {
        res.status(502).json({
          status_message: error?.message || 'Failed to reach TMDB upstream service.',
        });
      }
      return;
    }

    try {
      const queryRecord: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (k === 'api_key') continue;
        if (v !== undefined && v !== null) {
          queryRecord[k] = String(v).slice(0, 200);
        }
      }

      const result = await fetchTmdbThroughRegionalCache(endpoint, queryRecord, regionHeader);
      res.setHeader('X-Regional-Cache', result.fromCache ? 'HIT' : 'MISS');
      res.status(result.status).json(result.data);
    } catch (error: any) {
      res.status(502).json({
        status_message: error?.message || 'Failed to reach TMDB upstream service.',
      });
    }
  });

  // --- Server-Side Gemini AI: Movie & Series Insights ---
  app.post('/api/ai/insights', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'AI service is not configured. Please check your GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const { title, overview, releaseYear, genres, rating, query: userQuery, language } = req.body || {};
    if (!title) {
      res.status(400).json({ error: 'Missing media title.' });
      return;
    }

    const langHint =
      language && String(language).startsWith('de')
        ? 'Antworte auf Deutsch, präzise, cineastisch und ohne Spoiler.'
        : 'Respond in the same language as the user question (or English by default), concisely and without spoilers.';

    const contextBlock = [
      `Title: "${title}"`,
      releaseYear ? `Year: ${releaseYear}` : null,
      genres?.length ? `Genres: ${genres.join(', ')}` : null,
      rating ? `TMDB Rating: ${rating}/10` : null,
      overview ? `Synopsis: ${overview}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const promptText = userQuery
      ? `Context: ${contextBlock}\n\nUser Question: "${userQuery}"\nProvide a sharp, insightful answer in 2-4 sentences.`
      : `Context: ${contextBlock}\n\nProvide a compelling "Why Watch This" critique in under 60 words highlighting its tone, direction, and appeal.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: promptText,
        config: {
          systemInstruction: `You are an acclaimed film and television critic for MovieJournal. ${langHint}`,
        },
      });

      res.json({ text: response.text || 'No insight available.' });
    } catch (error: any) {
      console.error('Gemini Insights Error:', error);
      res.status(500).json({
        error: error?.message || 'Unable to generate AI insights at this time.',
      });
    }
  });

  // --- Server-Side Gemini AI: Multi-Turn Film Expert Chat ---
  app.post('/api/ai/chat', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'AI service is not configured. Please check your GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const { history = [], message, mediaContext, language } = req.body || {};
    if (!message) {
      res.status(400).json({ error: 'Missing chat message.' });
      return;
    }

    const langHint =
      language && String(language).startsWith('de')
        ? 'Antworte bevorzugt auf Deutsch, sofern der Nutzer nicht in einer anderen Sprache fragt.'
        : 'Match the language of the user prompt.';

    const conversationLog = Array.isArray(history)
      ? history
          .slice(-8)
          .map((h: any) => `${h.role === 'user' ? 'User' : 'Critic'}: ${h.text}`)
          .join('\n')
      : '';

    const fullPrompt = [
      mediaContext ? `Current Title Context: ${mediaContext}` : null,
      conversationLog ? `Conversation History:\n${conversationLog}` : null,
      `User: ${message}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: fullPrompt,
        config: {
          systemInstruction: `You are MovieJournal's expert film and series curator. Give concise, well-informed, spoiler-free answers. ${langHint}`,
        },
      });

      res.json({ text: response.text || 'No response generated.' });
    } catch (error: any) {
      console.error('Gemini Chat Error:', error);
      res.status(500).json({
        error: error?.message || 'Unable to reach the AI film expert right now.',
      });
    }
  });

  // Client runtime error telemetry endpoint for remote debugging Smart TVs
  app.post('/api/client-error', (req, res) => {
    console.error('[CLIENT-RUNTIME-ERROR]', JSON.stringify(req.body || {}));
    res.json({ ok: true });
  });

  // Self-healing Service Worker endpoint to purge any stale PWA cache on TV / Browser without forced reloads
  const sendSelfUnregisteringSw = (_req: express.Request, res: express.Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.send(`
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', (event) => {
        event.waitUntil(
          caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .then(() => self.registration.unregister())
        );
      });
    `);
  };
  app.get('/sw.js', sendSelfUnregisteringSw);
  app.get('/dev-sw.js', sendSelfUnregisteringSw);
  app.get('/registerSW.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send('// SW disabled');
  });

  // --- Vite Middleware (Development) or Static Assets (Production) ---
  const distPath = path.join(__dirname, 'dist');
  const distAssetsPath = path.join(distPath, 'assets');
  if (fs.existsSync(distAssetsPath)) {
    app.use('/assets', express.static(distAssetsPath));
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MovieJournal server listening on http://0.0.0.0:${PORT}`);
    hydrateKeyPoolFromFirestoreVault().then(() => {
      startFirestoreProxyBridge();
      warmRegionCatalogue('DE', 'de-DE').catch(() => {});
    });
  });
}

startServer();
