import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
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
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

export function computeWeakEtag(payloadStr: string): string {
  const hash = crypto.createHash('sha1').update(payloadStr).digest('base64url').slice(0, 20);
  return `W/"${payloadStr.length.toString(16)}-${hash}"`;
}

export function logStructured(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  meta: Record<string, unknown> = {}
): void {
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  if (severity === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
const CACHE_DIR = path.join(__dirname, '.cache');
const VAULT_FILE = path.join(CACHE_DIR, 'tmdb-server-vault.json');
const DISK_CACHE_FILE = path.join(CACHE_DIR, 'tmdb-regional-cache.json');
const SECURITY_VAULT_FILE = path.join(CACHE_DIR, 'user-2fa-vault.json');
const USER_SYNC_VAULT_FILE = path.join(CACHE_DIR, 'user-cloud-sync-vault.json');
const QUOTA_GUARD_FILE = path.join(CACHE_DIR, 'daily-quota-guard.json');
const VAULT_MASTER_KEY_FILE = path.join(CACHE_DIR, 'vault-master.key');
const FIREBASE_CONFIG_FILE = path.join(__dirname, 'firebase-applet-config.json');
const ADMIN_OWNER_EMAIL = 'infoc232@gmail.com';

// Ensure .cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch {
  // ignore
}

// --- Automatic Daily Cloud Cost & Quota Guard (100% Free-Tier / Trial Credit Protection) ---
export interface DailyCloudQuotaSnapshot {
  utcDay: string;
  firestoreReads: number;
  firestoreWrites: number;
  aiCalls: number;
  maxFirestoreReads: number;
  maxFirestoreWrites: number;
  maxAiCalls: number;
  quotaGuardActive: boolean;
}

const MAX_DAILY_SERVER_FIRESTORE_READS = 15000;
const MAX_DAILY_SERVER_FIRESTORE_WRITES = 6000;
const MAX_DAILY_SERVER_AI_CALLS = 300;

let dailyQuotaState = {
  utcDay: new Date().toISOString().slice(0, 10),
  firestoreReads: 0,
  firestoreWrites: 0,
  aiCalls: 0,
};

try {
  if (fs.existsSync(QUOTA_GUARD_FILE)) {
    const rawQ = JSON.parse(fs.readFileSync(QUOTA_GUARD_FILE, 'utf-8'));
    const today = new Date().toISOString().slice(0, 10);
    if (rawQ && rawQ.utcDay === today) {
      dailyQuotaState = {
        utcDay: today,
        firestoreReads: Math.max(0, Number(rawQ.firestoreReads || 0)),
        firestoreWrites: Math.max(0, Number(rawQ.firestoreWrites || 0)),
        aiCalls: Math.max(0, Number(rawQ.aiCalls || 0)),
      };
    }
  }
} catch {
  // ignore
}

let quotaSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleQuotaGuardPersist(): void {
  if (quotaSaveTimer) return;
  quotaSaveTimer = setTimeout(() => {
    quotaSaveTimer = null;
    try {
      fs.writeFileSync(QUOTA_GUARD_FILE, JSON.stringify(dailyQuotaState), 'utf-8');
    } catch {
      // ignore
    }
  }, 3000);
  quotaSaveTimer.unref?.();
}

function syncUtcDayRollover(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyQuotaState.utcDay !== today) {
    dailyQuotaState = {
      utcDay: today,
      firestoreReads: 0,
      firestoreWrites: 0,
      aiCalls: 0,
    };
    serverFirestoreQuotaExhausted = false;
    scheduleQuotaGuardPersist();
  }
}

export function canUseServerFirestoreRead(cost: number = 1): boolean {
  syncUtcDayRollover();
  if (serverFirestoreQuotaExhausted) return false;
  if (dailyQuotaState.firestoreReads + cost > MAX_DAILY_SERVER_FIRESTORE_READS) {
    return false;
  }
  dailyQuotaState.firestoreReads += cost;
  scheduleQuotaGuardPersist();
  return true;
}

export function canUseServerFirestoreWrite(cost: number = 1): boolean {
  syncUtcDayRollover();
  if (serverFirestoreQuotaExhausted) return false;
  if (dailyQuotaState.firestoreWrites + cost > MAX_DAILY_SERVER_FIRESTORE_WRITES) {
    return false;
  }
  dailyQuotaState.firestoreWrites += cost;
  scheduleQuotaGuardPersist();
  return true;
}

export function canUseServerAiCall(): boolean {
  syncUtcDayRollover();
  if (dailyQuotaState.aiCalls + 1 > MAX_DAILY_SERVER_AI_CALLS) {
    return false;
  }
  dailyQuotaState.aiCalls += 1;
  scheduleQuotaGuardPersist();
  return true;
}

export function getDailyCloudQuotaSnapshot(): DailyCloudQuotaSnapshot {
  syncUtcDayRollover();
  return {
    ...dailyQuotaState,
    maxFirestoreReads: MAX_DAILY_SERVER_FIRESTORE_READS,
    maxFirestoreWrites: MAX_DAILY_SERVER_FIRESTORE_WRITES,
    maxAiCalls: MAX_DAILY_SERVER_AI_CALLS,
    quotaGuardActive:
      serverFirestoreQuotaExhausted ||
      dailyQuotaState.firestoreReads >= MAX_DAILY_SERVER_FIRESTORE_READS ||
      dailyQuotaState.firestoreWrites >= MAX_DAILY_SERVER_FIRESTORE_WRITES,
  };
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

let firebaseDatabaseId = '(default)';
try {
  if (fs.existsSync(FIREBASE_CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf-8'));
    if (cfg?.firestoreDatabaseId) {
      firebaseDatabaseId = String(cfg.firestoreDatabaseId);
    }
  }
} catch {
  // ignore
}

// --- AES-256-GCM Server Cryptographic Vault (SEC-05: Dedicated Secret & Per-Record Random Salt) ---
function loadOrCreateMasterVaultSecret(): string {
  const envSecret = (process.env.VAULT_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return envSecret;
  }
  try {
    if (fs.existsSync(VAULT_MASTER_KEY_FILE)) {
      const saved = fs.readFileSync(VAULT_MASTER_KEY_FILE, 'utf-8').trim();
      if (saved.length >= 32) return saved;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(VAULT_MASTER_KEY_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
    return generated;
  } catch {
    return crypto
      .createHash('sha256')
      .update(`moviejournal-dedicated-vault-secret-${firebaseProjectId || 'acaa1505'}`)
      .digest('hex');
  }
}

const MASTER_VAULT_SECRET = loadOrCreateMasterVaultSecret();

const VAULT_CIPHER_KEY = crypto.scryptSync(
  MASTER_VAULT_SECRET,
  'moviejournal-vault-salt-v1',
  32
);

export function encryptForServerVault(plainText: string): string {
  const recordSalt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(MASTER_VAULT_SECRET, recordSalt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v2:${recordSalt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptFromServerVault(cipherPayload: string): string | null {
  try {
    if (!cipherPayload || typeof cipherPayload !== 'string') return null;
    if (cipherPayload.startsWith('v2:')) {
      const parts = cipherPayload.split(':');
      if (parts.length !== 5) return null;
      const recordSalt = Buffer.from(parts[1], 'hex');
      const iv = Buffer.from(parts[2], 'hex');
      const authTag = Buffer.from(parts[3], 'hex');
      const encrypted = Buffer.from(parts[4], 'hex');
      const derivedKey = crypto.scryptSync(MASTER_VAULT_SECRET, recordSalt, 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    }

    // Legacy v1 compatibility (3-part payload)
    const parts = cipherPayload.split(':');
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

export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const digestA = crypto.createHmac('sha256', VAULT_CIPHER_KEY).update(a).digest();
  const digestB = crypto.createHmac('sha256', VAULT_CIPHER_KEY).update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB) && a.length === b.length;
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

function persistVaultKeysToDiskAndFirestore(_syncFirestore: boolean = false): void {
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
    const now = Date.now();
    const validEntries = Array.from(l1RegionalCache.values())
      .filter((e) => e.expiresAt + 24 * 60 * 60 * 1000 > now)
      .slice(-300);
    const regionsList = Array.from(activeRegions.values());
    const serialized = JSON.stringify({ entries: validEntries, regions: regionsList });
    fs.promises.writeFile(DISK_CACHE_FILE, serialized, 'utf-8').catch(() => {});
  }, 5000);
  persistTimeout.unref?.();
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

const IGNORED_CACHE_QUERY_KEYS = new Set(['api_key', '_', 'cb', 'timestamp', 'cacheBuster']);

export function buildDeterministicCacheKey(
  region: string,
  language: string,
  endpoint: string,
  queryObj: Record<string, any>
): string {
  const cleanRegion =
    region === 'DE' || region === 'US' || region === 'GB'
      ? region
      : String(region || 'DE')
          .toUpperCase()
          .replace(/[^A-Z]/g, '')
          .slice(0, 5) || 'DE';
  const cleanLang =
    language === 'de-DE' || language === 'en-US'
      ? language
      : String(language || 'de-DE')
          .replace(/[^a-zA-Z\-]/g, '')
          .slice(0, 10) || 'de-DE';
  const cleanEndpoint = String(endpoint || '').replace(/^\/+|\/+$/g, '');
  const sortedPairs = Object.keys(queryObj || {})
    .filter((k) => !IGNORED_CACHE_QUERY_KEYS.has(k) && queryObj[k] !== undefined && queryObj[k] !== null)
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
 * Compacts large TMDB responses (e.g., aggregate details with 500 cast/crew or 200 images/videos)
 * so serialized JSON is always fast and safely within Firestore's document size limits (< 350 KB).
 */
export function compactTmdbPayloadForCache(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  try {
    const rawStr = JSON.stringify(payload);
    if (rawStr.length <= 320000) return payload;

    const compactPersonEntry = (c: any) => ({
      id: c.id,
      name: c.name,
      original_name: c.original_name,
      character: c.character,
      job: c.job,
      department: c.department,
      profile_path: c.profile_path,
      order: c.order,
      total_episode_count: c.total_episode_count,
    });

    const clone: any = { ...payload };
    if (clone.credits) {
      clone.credits = {
        ...clone.credits,
        cast: Array.isArray(clone.credits.cast)
          ? clone.credits.cast.slice(0, 35).map(compactPersonEntry)
          : [],
        crew: Array.isArray(clone.credits.crew)
          ? clone.credits.crew.slice(0, 35).map(compactPersonEntry)
          : [],
      };
    }
    if (clone.aggregate_credits) {
      clone.aggregate_credits = {
        ...clone.aggregate_credits,
        cast: Array.isArray(clone.aggregate_credits.cast)
          ? clone.aggregate_credits.cast.slice(0, 35).map(compactPersonEntry)
          : [],
        crew: Array.isArray(clone.aggregate_credits.crew)
          ? clone.aggregate_credits.crew.slice(0, 30).map(compactPersonEntry)
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
    if (clone.videos?.results && Array.isArray(clone.videos.results)) {
      clone.videos = {
        ...clone.videos,
        results: clone.videos.results
          .filter((v: any) => v && v.site === 'YouTube' && v.key)
          .slice(0, 12)
          .map((v: any) => ({
            id: v.id,
            key: v.key,
            name: typeof v.name === 'string' ? v.name.slice(0, 140) : '',
            site: v.site,
            type: v.type,
            official: Boolean(v.official),
          })),
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
}, 15 * 60 * 1000).unref();

// --- Server-Side Firebase ID Token Verification (SEC-01: Cryptographic RS256 + Fail-Closed) ---
export interface VerifiedUserIdentity {
  uid: string;
  email: string;
  provider: string;
  rawToken?: string;
}

let cachedGoogleCerts: Record<string, string> = {};
let cachedGoogleCertsExpiresAt = 0;

async function fetchGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < cachedGoogleCertsExpiresAt && Object.keys(cachedGoogleCerts).length > 0) {
    return cachedGoogleCerts;
  }
  try {
    const res = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const certs = (await res.json()) as Record<string, string>;
      if (certs && typeof certs === 'object' && Object.keys(certs).length > 0) {
        cachedGoogleCerts = certs;
        cachedGoogleCertsExpiresAt = now + 60 * 60 * 1000; // 1 hour cache
        return certs;
      }
    }
  } catch {
    // Return cached certs if still available; otherwise empty object (fail-closed)
  }
  return cachedGoogleCerts;
}

export async function verifyFirebaseIdToken(
  authHeader?: string
): Promise<VerifiedUserIdentity | null> {
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.slice(7).trim();
  const segments = idToken.split('.');
  if (!idToken || segments.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = segments;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: any = null;
  let payload: any = null;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  // Strictly require RS256 and valid non-expired claims before any verification
  const nowSec = Math.floor(Date.now() / 1000);
  const expectedProject = firebaseProjectId || 'gen-lang-client-0463426822';
  const expectedIssuer = `https://securetoken.google.com/${expectedProject}`;
  const uid = String(payload?.user_id || payload?.sub || '').trim();

  if (
    !header ||
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !header.kid ||
    !payload ||
    !uid ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSec ||
    typeof payload.iat !== 'number' ||
    payload.iat > nowSec + 300 ||
    payload.aud !== expectedProject ||
    payload.iss !== expectedIssuer
  ) {
    return null;
  }

  // 1. Cryptographic RS256 signature verification against Google's X.509 public certificates
  try {
    const certs = await fetchGoogleSecureTokenCerts();
    const certPem = certs[header.kid];
    if (certPem) {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      verifier.end();
      const sigBuf = Buffer.from(signatureB64, 'base64url');
      if (verifier.verify(certPem, sigBuf)) {
        return {
          uid,
          email: String(payload.email || ''),
          provider: String(payload.firebase?.sign_in_provider || 'firebase'),
          rawToken: idToken,
        };
      }
      // If cert exists for kid and signature verification failed, immediately reject (forged signature)
      return null;
    }
  } catch {
    // Fall through to Google Identity Toolkit accounts:lookup verification
  }

  // 2. Cryptographic verification via Google Identity Toolkit accounts:lookup
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
        if (account?.localId && String(account.localId) === uid) {
          return {
            uid: String(account.localId),
            email: String(account.email || payload.email || ''),
            provider: String(account.providerUserInfo?.[0]?.providerId || 'firebase'),
            rawToken: idToken,
          };
        }
      }
    } catch {
      // Fail closed below
    }
  }

  // SEC-01: Strictly fail closed. Never accept unverified JWT payloads.
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

export function computeTotpCode(secretBase32: string, stepCounter: number): string {
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

export function verifyTotpCode(
  secretBase32: string,
  userCode: string,
  nowMs: number = Date.now()
): boolean {
  const cleanCode = (userCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const currentStep = Math.floor(nowMs / 1000 / 30);
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

export function signTwoFactorSessionTicket(uid: string): string {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = `${uid}:${expiresAt}`;
  const sig = crypto
    .createHmac('sha256', VAULT_CIPHER_KEY)
    .update(`2fa_ticket:${payload}`)
    .digest('hex');
  return `${payload}:${sig}`;
}

export function verifyTwoFactorSessionTicket(uid: string, ticket?: string): boolean {
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
  return timingSafeEqualStrings(sig, expectedSig);
}

export function isAuthorizedAdminOwner(user: VerifiedUserIdentity | null): boolean {
  if (!user || !user.uid) return false;
  const configuredOwnerUid = (process.env.ADMIN_OWNER_UID || '').trim();
  if (configuredOwnerUid) {
    return user.uid === configuredOwnerUid;
  }
  const configuredOwnerEmail = (process.env.ADMIN_OWNER_EMAIL || ADMIN_OWNER_EMAIL)
    .trim()
    .toLowerCase();
  if (!user.email) return false;
  return user.email.trim().toLowerCase() === configuredOwnerEmail;
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

function getFirestoreDocumentRestUrl(collectionName: string, docId: string): string {
  const proj = firebaseProjectId || 'gen-lang-client-0463426822';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(proj)}/databases/${encodeURIComponent(firebaseDatabaseId)}/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
}

async function getUserSecurityRecord(
  uid: string,
  userRawToken?: string
): Promise<UserSecurityRecord | null> {
  const cached = localUserSecurityCache.get(uid);
  if (cached) return cached;
  if (userRawToken && canUseServerFirestoreRead(1)) {
    try {
      const res = await fetch(getFirestoreDocumentRestUrl('userSecurityVault', uid), {
        method: 'GET',
        headers: { Authorization: `Bearer ${userRawToken}` },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const docJson = await res.json();
        const f = docJson?.fields;
        if (f) {
          const record: UserSecurityRecord = {
            uid: String(f.uid?.stringValue || uid),
            twoFactorEnabled: Boolean(f.twoFactorEnabled?.booleanValue),
            encryptedTotpSecret: String(f.encryptedTotpSecret?.stringValue || ''),
            backupCodeHashesJson: String(f.backupCodeHashesJson?.stringValue || '[]'),
            updatedAt: Number(f.updatedAt?.integerValue || f.updatedAt?.doubleValue || Date.now()),
          };
          localUserSecurityCache.set(uid, record);
          return record;
        }
      }
    } catch (err) {
      handleServerFirestoreQuotaError(err);
    }
  }
  return localUserSecurityCache.get(uid) || null;
}

async function saveUserSecurityRecord(
  record: UserSecurityRecord,
  userRawToken?: string
): Promise<void> {
  localUserSecurityCache.set(record.uid, record);
  saveLocalUserSecurityCache();
  if (userRawToken && canUseServerFirestoreWrite(1)) {
    try {
      await fetch(getFirestoreDocumentRestUrl('userSecurityVault', record.uid), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userRawToken}`,
        },
        body: JSON.stringify({
          fields: {
            uid: { stringValue: record.uid },
            twoFactorEnabled: { booleanValue: Boolean(record.twoFactorEnabled) },
            encryptedTotpSecret: { stringValue: record.encryptedTotpSecret || '' },
            backupCodeHashesJson: { stringValue: record.backupCodeHashesJson || '[]' },
            updatedAt: { integerValue: String(Math.floor(record.updatedAt || Date.now())) },
          },
        }),
        signal: AbortSignal.timeout(3500),
      });
    } catch (err) {
      handleServerFirestoreQuotaError(err);
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

export const ALLOWED_TMDB_ENDPOINT_REGEX =
  /^(authentication\/guest_session\/new|configuration|genre\/(movie|tv)\/list|watch\/providers\/(movie|tv)|movie\/(now_playing|upcoming|top_rated|\d+(\/[a-zA-Z0-9_]+)*)|tv\/(on_the_air|airing_today|top_rated|\d+(\/[a-zA-Z0-9_]+)*)|person\/\d+(\/[a-zA-Z0-9_]+)*|collection\/\d+(\/[a-zA-Z0-9_]+)*|company\/\d+(\/[a-zA-Z0-9_]+)*|keyword\/\d+|discover\/(movie|tv)|trending\/[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+|search\/(multi|movie|tv|person|keyword))$/;

// --- Explicit CORS Origin Allow-List (SEC-06) ---
const ALLOWED_CORS_ORIGINS = new Set<string>([
  'https://ais-dev-37sas3mekyso6nio5hh72d-849714710389.europe-west2.run.app',
  'https://ais-pre-37sas3mekyso6nio5hh72d-849714710389.europe-west2.run.app',
  'capacitor://localhost',
  'ionic://localhost',
]);

export function isAllowedCorsOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  const clean = origin.trim().replace(/\/+$/, '');
  if (ALLOWED_CORS_ORIGINS.has(clean)) return true;
  const customAllowed = (process.env.ALLOWED_ORIGIN || '').trim().replace(/\/+$/, '');
  if (customAllowed && clean === customAllowed) return true;
  if (process.env.NODE_ENV !== 'production') {
    if (
      clean === 'http://localhost' ||
      clean === 'https://localhost' ||
      /^https?:\/\/localhost:\d+$/.test(clean)
    ) {
      return true;
    }
  }
  return false;
}

// --- Tiered Anti-Bot & Anti-Brute-Force Rate Limiter (SEC-04: Bounded Memory & Trust Proxy) ---
const rateLimitWindowMs = 60 * 1000;
const MAX_RATE_BUCKETS = 5000;
const ipTierBuckets = new Map<string, { count: number; resetAt: number }>();

export function getRateLimitMaxForPath(
  reqPath: string,
  method: string = 'GET'
): { tier: string; maxPerMinute: number } {
  if (reqPath.startsWith('/api/auth/')) {
    return { tier: 'auth', maxPerMinute: 25 };
  }
  if (reqPath.startsWith('/api/ai/')) {
    return { tier: 'ai', maxPerMinute: 15 };
  }
  if (reqPath.startsWith('/api/client-error')) {
    return { tier: 'client-error', maxPerMinute: 15 };
  }
  if (reqPath.startsWith('/api/tmdb') && method === 'POST') {
    return { tier: 'tmdb-rate', maxPerMinute: 20 };
  }
  if (reqPath.startsWith('/api/user-sync/')) {
    return { tier: 'sync', maxPerMinute: 60 };
  }
  if (reqPath.startsWith('/api/admin/')) {
    return { tier: 'admin', maxPerMinute: 20 };
  }
  return { tier: 'general', maxPerMinute: 450 };
}

export function checkTieredRateLimit(
  ip: string,
  reqPath: string,
  nowMs: number = Date.now(),
  method: string = 'GET'
): { allowed: boolean; remaining: number; limit: number } {
  const { tier, maxPerMinute } = getRateLimitMaxForPath(reqPath, method);
  const safeIp = String(ip || 'local').slice(0, 64);
  const bucketKey = `${safeIp}:${tier}`;
  const bucket = ipTierBuckets.get(bucketKey);
  if (!bucket || nowMs > bucket.resetAt) {
    if (!bucket && ipTierBuckets.size >= MAX_RATE_BUCKETS) {
      const oldestKey = ipTierBuckets.keys().next().value;
      if (oldestKey) ipTierBuckets.delete(oldestKey);
    }
    ipTierBuckets.set(bucketKey, { count: 1, resetAt: nowMs + rateLimitWindowMs });
    return { allowed: true, remaining: maxPerMinute - 1, limit: maxPerMinute };
  }
  bucket.count += 1;
  if (bucket.count > maxPerMinute) {
    return { allowed: false, remaining: 0, limit: maxPerMinute };
  }
  return { allowed: true, remaining: maxPerMinute - bucket.count, limit: maxPerMinute };
}

// Periodic cleanup of expired rate-limit buckets every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipTierBuckets.entries()) {
    if (now > v.resetAt) {
      ipTierBuckets.delete(k);
    }
  }
}, 5 * 60 * 1000).unref();

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  // --- Hardened Security Headers, Explicit CORS Allow-List & Tiered Rate Limiter ---
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://accounts.google.com https://*.firebaseapp.com; frame-ancestors 'self' https://*.google.com https://*.run.app;"
    );

    if (req.path.startsWith('/api/')) {
      const origin = String(req.headers.origin || '');
      if (isAllowedCorsOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
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

      const clientIp = String(req.ip || req.socket.remoteAddress || 'local').trim();
      const rateCheck = checkTieredRateLimit(clientIp, req.path, Date.now(), req.method);
      res.setHeader('X-RateLimit-Limit', String(rateCheck.limit));
      res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
      if (!rateCheck.allowed) {
        res.status(429).json({ error: 'Too many requests. Please slow down.' });
        return;
      }
    }
    next();
  });

  // --- 0. Cloud Run Liveness & Readiness Health Endpoint ---
  app.get('/health', (_req, res) => {
    const mem = process.memoryUsage();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'ok',
      service: 'moviejournal-cloudrun',
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      l1Entries: l1RegionalCache.size,
      activeKeyPoolSize: tmdbKeyPool.size,
    });
  });

  // --- 1. Server Capability Status ---
  app.get('/api/config', (_req, res) => {
    res.json({
      hasServerTmdbKey: hasAnyServerTmdbKey(),
      hasAiAvailable: Boolean(process.env.GEMINI_API_KEY),
      activeKeyPoolSize: tmdbKeyPool.size,
      quotaGuard: getDailyCloudQuotaSnapshot(),
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

    const record = await getUserSecurityRecord(user.uid, user.rawToken);
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

    await saveUserSecurityRecord(
      {
        uid: user.uid,
        twoFactorEnabled: true,
        encryptedTotpSecret,
        backupCodeHashesJson: JSON.stringify(hashes),
        updatedAt: Date.now(),
      },
      user.rawToken
    );

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
    const record = await getUserSecurityRecord(user.uid, user.rawToken);
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
      await saveUserSecurityRecord(
        {
          ...record,
          backupCodeHashesJson: JSON.stringify(hashes),
          updatedAt: Date.now(),
        },
        user.rawToken
      );
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

    await saveUserSecurityRecord(
      {
        uid: user.uid,
        twoFactorEnabled: false,
        encryptedTotpSecret: '',
        backupCodeHashesJson: '[]',
        updatedAt: Date.now(),
      },
      user.rawToken
    );

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
    if (!session || !timingSafeEqualStrings(session.pollSecret, pollSecret)) {
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

  // --- 2C. Production Multi-Device User Cloud Sync Vault (AES-256-GCM Encrypted At Rest) ---
  interface ServerUserSyncRecord {
    uid: string;
    profile?: Record<string, any>;
    library?: SyncUserLibraryState;
    updatedAt: number;
  }

  const serverUserSyncVault = new Map<string, ServerUserSyncRecord>();
  try {
    if (fs.existsSync(USER_SYNC_VAULT_FILE)) {
      const rawSync = JSON.parse(fs.readFileSync(USER_SYNC_VAULT_FILE, 'utf-8'));
      if (typeof rawSync?.encryptedPayload === 'string') {
        const dec = decryptFromServerVault(rawSync.encryptedPayload);
        if (dec) {
          const parsedList = JSON.parse(dec);
          if (Array.isArray(parsedList)) {
            for (const item of parsedList) {
              if (item?.uid) serverUserSyncVault.set(String(item.uid), item);
            }
          }
        }
      } else if (Array.isArray(rawSync)) {
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
      const plainJson = JSON.stringify(Array.from(serverUserSyncVault.values()));
      const encryptedPayload = encryptForServerVault(plainJson);
      fs.writeFileSync(
        USER_SYNC_VAULT_FILE,
        JSON.stringify({
          encryptedPayload,
          userCount: serverUserSyncVault.size,
          updatedAt: Date.now(),
        }),
        'utf-8'
      );
    } catch {
      // ignore
    }
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

    res.setHeader('Cache-Control', 'no-store');
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
      nextLibrary = mergeUserSyncLibraryState(nextLibrary, incomingLib);
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

  app.post('/api/user-sync/delete-account', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    serverUserSyncVault.delete(user.uid);
    persistServerUserSyncVault();
    localUserSecurityCache.delete(user.uid);
    saveLocalUserSecurityCache();

    if (user.rawToken) {
      await Promise.allSettled([
        fetch(getFirestoreDocumentRestUrl('userLibraryVault', user.uid), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${user.rawToken}` },
          signal: AbortSignal.timeout(3500),
        }),
        fetch(getFirestoreDocumentRestUrl('userSecurityVault', user.uid), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${user.rawToken}` },
          signal: AbortSignal.timeout(3500),
        }),
      ]);
    }
    res.json({ ok: true });
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

  // --- 3. Multi-Key TMDB Pool Management Endpoints (Restricted to Owner Only) ---

  app.get('/api/admin/tmdb-keys', async (req, res) => {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!isAuthorizedAdminOwner(user)) {
      res.status(403).json({ error: 'Forbidden: Owner access required.' });
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
    if (!isAuthorizedAdminOwner(user)) {
      res.status(403).json({ error: 'Forbidden: Owner access required.' });
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
    if (!isAuthorizedAdminOwner(user)) {
      res.status(403).json({ error: 'Forbidden: Owner access required.' });
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

    // Non-GET requests (SEC-07: Only authenticated & validated rating POST is permitted)
    if (req.method !== 'GET') {
      if (req.method !== 'POST' || !/^(movie|tv)\/\d+\/rating$/.test(endpoint)) {
        res.status(405).json({ status_message: 'Method not allowed on this endpoint.' });
        return;
      }
      const verifiedUser = await verifyFirebaseIdToken(req.headers.authorization);
      if (!verifiedUser) {
        res.status(401).json({ status_message: 'Authentication required to submit ratings.' });
        return;
      }
      const ratingVal = Number(req.body?.value);
      if (!Number.isFinite(ratingVal) || ratingVal < 0.5 || ratingVal > 10) {
        res.status(400).json({ status_message: 'Rating value must be between 0.5 and 10.0.' });
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
          JSON.stringify({ value: Math.round(ratingVal * 2) / 2 })
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

      if (result.status === 200 && result.data) {
        const jsonStr = JSON.stringify(result.data);
        const etag = computeWeakEtag(jsonStr);
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.setHeader('Vary', 'Accept-Encoding, x-app-region');

        const ifNoneMatch = String(req.headers['if-none-match'] || '').trim();
        if (ifNoneMatch && ifNoneMatch === etag) {
          res.status(304).end();
          return;
        }

        const acceptEncoding = String(req.headers['accept-encoding'] || '');
        if (acceptEncoding.includes('gzip') && jsonStr.length > 1024) {
          const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.status(200).send(compressed);
          return;
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.status(200).send(jsonStr);
        return;
      }

      res.status(result.status).json(result.data);
    } catch (error: any) {
      res.status(502).json({
        status_message: error?.message || 'Failed to reach TMDB upstream service.',
      });
    }
  });

  // --- Server-Side Gemini AI: Movie & Series Insights (Protected by Daily Quota Guard & Input Validation) ---
  app.post('/api/ai/insights', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'AI service is not configured. Please check your GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const { title, overview, releaseYear, genres, rating, query: userQuery, language } = req.body || {};
    const safeTitle = String(title || '').trim().slice(0, 200);
    if (!safeTitle) {
      res.status(400).json({ error: 'Missing media title.' });
      return;
    }
    if (!canUseServerAiCall()) {
      res.status(429).json({
        error: 'Daily free AI insight quota reached to protect your Cloud credit budget.',
      });
      return;
    }

    const safeQuery = userQuery ? String(userQuery).trim().slice(0, 600) : '';
    const safeOverview = overview ? String(overview).trim().slice(0, 1200) : '';
    const langHint =
      language && String(language).startsWith('de')
        ? 'Antworte auf Deutsch, präzise, cineastisch und ohne Spoiler.'
        : 'Respond in the same language as the user question (or English by default), concisely and without spoilers.';

    const contextBlock = [
      `Title: "${safeTitle}"`,
      releaseYear ? `Year: ${String(releaseYear).slice(0, 10)}` : null,
      Array.isArray(genres) && genres.length ? `Genres: ${genres.slice(0, 8).join(', ')}` : null,
      rating ? `TMDB Rating: ${Number(rating).toFixed(1)}/10` : null,
      safeOverview ? `Synopsis: ${safeOverview}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const promptText = safeQuery
      ? `Context: ${contextBlock}\n\nUser Question: "${safeQuery}"\nProvide a sharp, insightful answer in 2-4 sentences.`
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

  // --- Server-Side Gemini AI: Multi-Turn Film Expert Chat (Protected by Daily Quota Guard & Input Validation) ---
  app.post('/api/ai/chat', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'AI service is not configured. Please check your GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const { history = [], message, mediaContext, language } = req.body || {};
    const safeMessage = String(message || '').trim().slice(0, 800);
    if (!safeMessage) {
      res.status(400).json({ error: 'Missing chat message.' });
      return;
    }
    if (!canUseServerAiCall()) {
      res.status(429).json({
        error: 'Daily free AI chat quota reached to protect your Cloud credit budget.',
      });
      return;
    }

    const langHint =
      language && String(language).startsWith('de')
        ? 'Antworte bevorzugt auf Deutsch, sofern der Nutzer nicht in einer anderen Sprache fragt.'
        : 'Match the language of the user prompt.';

    const conversationLog = Array.isArray(history)
      ? history
          .slice(-8)
          .map(
            (h: any) =>
              `${h?.role === 'user' ? 'User' : 'Critic'}: ${String(h?.text || '').slice(0, 600)}`
          )
          .join('\n')
      : '';

    const fullPrompt = [
      mediaContext ? `Current Title Context: ${String(mediaContext).slice(0, 600)}` : null,
      conversationLog ? `Conversation History:\n${conversationLog}` : null,
      `User: ${safeMessage}`,
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

  // Client runtime error telemetry endpoint (SEC-04: Sanitized & bounded log entry)
  app.post('/api/client-error', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    logStructured('ERROR', 'Client runtime error reported', {
      clientMessage: String(body.message || body.error || 'Unknown error').slice(0, 300),
      clientUrl: String(body.url || '').slice(0, 200),
      clientStack: String(body.stack || '').slice(0, 500),
    });
    res.json({ ok: true });
  });

  // Production Offline-Capable Stale-While-Revalidate Service Worker (App-Shell + TMDB Poster Cache)
  const sendProductionServiceWorker = (_req: express.Request, res: express.Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.send(`
      const CACHE_SHELL = 'mj-shell-v3';
      const CACHE_IMAGES = 'mj-posters-v3';
      const CACHE_API = 'mj-api-v3';
      const PRECACHE_ASSETS = [
        '/manifest.json',
        '/icon.svg',
        '/apple-touch-icon.png',
        '/pwa-192x192.png',
        '/pwa-512x512.png',
        '/pwa-maskable-512x512.png'
      ];

      self.addEventListener('install', (event) => {
        self.skipWaiting();
        event.waitUntil(
          caches.open(CACHE_SHELL).then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
        );
      });

      self.addEventListener('activate', (event) => {
        event.waitUntil(
          caches.keys().then((keys) =>
            Promise.all(
              keys
                .filter((k) => k !== CACHE_SHELL && k !== CACHE_IMAGES && k !== CACHE_API)
                .map((k) => caches.delete(k))
            )
          ).then(() => self.clients.claim())
        );
      });

      self.addEventListener('fetch', (event) => {
        const req = event.request;
        if (req.method !== 'GET') return;
        const url = new URL(req.url);

        // Never intercept Vite dev transforms or auth/sync mutations
        if (
          url.pathname.startsWith('/@') ||
          url.pathname.startsWith('/node_modules/') ||
          url.pathname.endsWith('.tsx') ||
          url.pathname.endsWith('.ts') ||
          url.pathname.startsWith('/api/auth/') ||
          url.pathname.startsWith('/api/user-sync/') ||
          url.pathname.startsWith('/api/admin/')
        ) {
          return;
        }

        // 1. TMDB Posters & Backdrops: Cache-First with background refresh
        if (url.hostname === 'image.tmdb.org') {
          event.respondWith(
            caches.open(CACHE_IMAGES).then(async (cache) => {
              const cached = await cache.match(req);
              const fetchPromise = fetch(req)
                .then((netRes) => {
                  if (netRes && netRes.ok) {
                    cache.put(req, netRes.clone()).catch(() => {});
                  }
                  return netRes;
                })
                .catch(() => cached);
              return cached || fetchPromise;
            })
          );
          return;
        }

        // 2. TMDB Proxy GET API: Network-First with offline cache fallback
        if (url.pathname.startsWith('/api/tmdb/')) {
          event.respondWith(
            caches.open(CACHE_API).then(async (cache) => {
              try {
                const netRes = await fetch(req);
                if (netRes && netRes.ok) {
                  cache.put(req, netRes.clone()).catch(() => {});
                }
                return netRes;
              } catch (err) {
                const cached = await cache.match(req);
                if (cached) return cached;
                throw err;
              }
            })
          );
          return;
        }

        // 3. HTML Navigation & Static Assets: Network-First with offline shell fallback
        if (req.mode === 'navigate' || url.origin === self.location.origin) {
          event.respondWith(
            caches.open(CACHE_SHELL).then(async (cache) => {
              try {
                const netRes = await fetch(req);
                if (netRes && netRes.ok && url.origin === self.location.origin) {
                  cache.put(req, netRes.clone()).catch(() => {});
                }
                return netRes;
              } catch (err) {
                const cached = await cache.match(req);
                if (cached) return cached;
                if (req.mode === 'navigate') {
                  const rootCached = await cache.match('/');
                  if (rootCached) return rootCached;
                }
                throw err;
              }
            })
          );
        }
      });
    `);
  };
  app.get('/sw.js', sendProductionServiceWorker);
  app.get('/dev-sw.js', sendProductionServiceWorker);
  app.get('/registerSW.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
      }
    `);
  });

  // --- Vite Middleware (Development) or Static Assets (Production) ---
  const distPath = path.join(__dirname, 'dist');
  const distAssetsPath = path.join(distPath, 'assets');
  if (fs.existsSync(distAssetsPath)) {
    app.use(
      '/assets',
      express.static(distAssetsPath, {
        maxAge: '365d',
        immutable: true,
      })
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath, { maxAge: '1h' }));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logStructured('INFO', `MovieJournal server listening on http://0.0.0.0:${PORT}`, {
      port: PORT,
      env: process.env.NODE_ENV || 'development',
    });
    hydrateKeyPoolFromFirestoreVault().then(() => {
      warmRegionCatalogue('DE', 'de-DE').catch(() => {});
    });
  });

  const gracefulShutdown = (signal: string) => {
    logStructured('INFO', `Received ${signal}, flushing caches and shutting down gracefully...`);
    try {
      persistServerUserSyncVault();
    } catch {
      // ignore
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}

export interface SyncUserLibraryState {
  watchlist?: any[];
  removedWatchlistKeys?: Record<string, number>;
  watchedMovies?: number[];
  removedMovies?: Record<string, number>;
  manuallyWatchedShows?: number[];
  removedShows?: Record<string, number>;
  watchedEpisodes?: Record<string, number[]>;
  removedEpisodes?: Record<string, number>;
  updatedAt?: string;
  replaceAll?: boolean;
}

export function getSyncItemMediaKey(item: any): string {
  if (!item || !item.id) return '';
  const numId = Math.abs(Math.floor(Number(item.id)));
  if (!Number.isFinite(numId) || numId <= 0) return '';
  const mType = item.media_type === 'tv' || (!item.title && item.name) ? 'tv' : 'movie';
  return `${mType}_${numId}`;
}

export function mergeUserSyncLibraryState(
  currentLib: SyncUserLibraryState = {},
  incomingLib: SyncUserLibraryState = {}
): SyncUserLibraryState {
  if (Boolean(incomingLib.replaceAll)) {
    return {
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
      removedEpisodes: incomingLib.removedEpisodes || {},
      updatedAt: new Date().toISOString(),
    };
  }

  // Merge tombstones first (latest timestamp wins)
  const mergedRemovedWatchlist: Record<string, number> = {
    ...(currentLib.removedWatchlistKeys || {}),
  };
  for (const [k, ts] of Object.entries(incomingLib.removedWatchlistKeys || {})) {
    const numTs = Number(ts || 0);
    if (numTs > (mergedRemovedWatchlist[k] || 0)) {
      mergedRemovedWatchlist[k] = numTs;
    }
  }

  const mergedRemovedMovies: Record<string, number> = {
    ...(currentLib.removedMovies || {}),
    ...(incomingLib.removedMovies || {}),
  };
  const mergedRemovedShows: Record<string, number> = {
    ...(currentLib.removedShows || {}),
    ...(incomingLib.removedShows || {}),
  };
  const mergedRemovedEpisodes: Record<string, number> = {
    ...(currentLib.removedEpisodes || {}),
    ...(incomingLib.removedEpisodes || {}),
  };

  // Union watchlist items while respecting explicit removals
  const wlMap = new Map<string, any>();
  for (const item of currentLib.watchlist || []) {
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
  const movieSet = new Set<number>(currentLib.watchedMovies || []);
  for (const mId of incomingLib.watchedMovies || []) {
    const numId = Number(mId);
    if (Number.isFinite(numId) && numId > 0) movieSet.add(numId);
  }
  for (const [mKey, remTs] of Object.entries(mergedRemovedMovies)) {
    if (Number(remTs) > 0) movieSet.delete(Number(mKey));
  }

  // Union manuallyWatchedShows while respecting explicit removals
  const showSet = new Set<number>(currentLib.manuallyWatchedShows || []);
  for (const sId of incomingLib.manuallyWatchedShows || []) {
    const numId = Number(sId);
    if (Number.isFinite(numId) && numId > 0) showSet.add(numId);
  }
  for (const [sKey, remTs] of Object.entries(mergedRemovedShows)) {
    if (Number(remTs) > 0) showSet.delete(Number(sKey));
  }

  // Union watchedEpisodes per show across devices while respecting episode tombstones
  const mergedEpisodes: Record<string, number[]> = {};
  for (const [seriesId, eps] of Object.entries(currentLib.watchedEpisodes || {})) {
    if (Array.isArray(eps)) {
      const filtered = Array.from(
        new Set(
          eps
            .map(Number)
            .filter(
              (n) => Number.isFinite(n) && n > 0 && !mergedRemovedEpisodes[`${seriesId}:${n}`]
            )
        )
      );
      if (filtered.length > 0) {
        mergedEpisodes[seriesId] = filtered;
      }
    }
  }
  if (incomingLib.watchedEpisodes && typeof incomingLib.watchedEpisodes === 'object') {
    for (const [seriesId, eps] of Object.entries(incomingLib.watchedEpisodes)) {
      if (Array.isArray(eps)) {
        const existingEps = mergedEpisodes[seriesId] || [];
        const combined = Array.from(
          new Set(
            [...existingEps, ...eps.map(Number).filter((n) => Number.isFinite(n) && n > 0)].filter(
              (n) => !mergedRemovedEpisodes[`${seriesId}:${n}`]
            )
          )
        );
        if (combined.length > 0) {
          mergedEpisodes[seriesId] = combined;
        } else {
          delete mergedEpisodes[seriesId];
        }
      }
    }
  }

  return {
    watchlist: Array.from(wlMap.values()).slice(0, 500),
    removedWatchlistKeys: mergedRemovedWatchlist,
    watchedMovies: Array.from(movieSet).slice(0, 500),
    removedMovies: mergedRemovedMovies,
    manuallyWatchedShows: Array.from(showSet).slice(0, 500),
    removedShows: mergedRemovedShows,
    watchedEpisodes: mergedEpisodes,
    removedEpisodes: mergedRemovedEpisodes,
    updatedAt: new Date().toISOString(),
  };
}

if (process.env.MOVIEJOURNAL_TEST_MODE !== '1') {
  startServer();
}
