import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserPopupRedirectResolver,
  updateCurrentUser,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  deleteUser,
  signOut,
  User,
} from 'firebase/auth';
import {
  initializeFirestore,
  setLogLevel,
  enableNetwork,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  limit,
  writeBatch,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { MediaItem, MediaType, resolveMediaType } from '../types';
import { resolveApiBaseUrl } from './tmdb';

const app = initializeApp(firebaseConfig);
const isCapacitorNative =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:' ||
    window.location.protocol === 'file:' ||
    Boolean((window as any).Capacitor?.isNativePlatform?.()));

try {
  setLogLevel('silent');
} catch {
  // ignore
}

export const db = initializeFirestore(
  app,
  {
    experimentalForceLongPolling: isCapacitorNative,
    experimentalAutoDetectLongPolling: !isCapacitorNative,
  },
  firebaseConfig.firestoreDatabaseId
);

const QUOTA_EXHAUSTED_STORAGE_KEY = 'mj_fs_write_quota_until';
const DAILY_CLIENT_QUOTA_KEY = 'mj_daily_client_fs_budget_v1';
const MAX_DAILY_CLIENT_WRITES = 450;
let writeQuotaCooldownUntil = 0;

// Clear any legacy 6-hour network lockout from localStorage and ensure Firestore network is active
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(QUOTA_EXHAUSTED_STORAGE_KEY);
  } catch {
    // ignore
  }
}
enableNetwork(db).catch(() => {});

function checkAndIncrementDailyClientWriteBudget(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = window.localStorage.getItem(DAILY_CLIENT_QUOTA_KEY);
    let state = { day: today, writes: 0 };
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.day === today && typeof parsed.writes === 'number') {
        state = parsed;
      }
    }
    if (state.writes >= MAX_DAILY_CLIENT_WRITES) {
      return false;
    }
    state.writes += 1;
    window.localStorage.setItem(DAILY_CLIENT_QUOTA_KEY, JSON.stringify(state));
    return true;
  } catch {
    return true;
  }
}

export function isWriteQuotaExhausted(): boolean {
  return Date.now() < writeQuotaCooldownUntil;
}

export function canPerformClientFirestoreWrite(): boolean {
  if (isWriteQuotaExhausted()) return false;
  return checkAndIncrementDailyClientWriteBudget();
}

export function resetWriteQuotaCooldown(): void {
  writeQuotaCooldownUntil = 0;
}

export function markWriteQuotaExhausted(): void {
  // Only pause direct client-side Firestore writes briefly (45s) while keeping reads/onSnapshot and server sync active
  writeQuotaCooldownUntil = Date.now() + 45 * 1000;
}

export function isFirestoreQuotaError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || '');
  const code = String((error as any)?.code || '');
  return (
    code.includes('resource-exhausted') ||
    msg.includes('resource-exhausted') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Quota exceeded')
  );
}

export const auth = (() => {
  if (typeof window === 'undefined') {
    return getAuth(app);
  }
  try {
    return initializeAuth(app, {
      persistence: [browserLocalPersistence, indexedDBLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(app);
  }
})();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export type { User };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface FirestoreCostMetrics {
  sessionReads: number;
  sessionWrites: number;
  savedReadsViaTimestampDiff: number;
  lastSyncTimestamp: string;
  syncMode: 'timestamp-diff-subcollections';
}

const costMetrics: FirestoreCostMetrics = {
  sessionReads: 0,
  sessionWrites: 0,
  savedReadsViaTimestampDiff: 0,
  lastSyncTimestamp: '',
  syncMode: 'timestamp-diff-subcollections',
};

export function getFirestoreCostMetrics(): FirestoreCostMetrics {
  return { ...costMetrics };
}

export function recordSavedReads(count: number, syncTs?: string) {
  costMetrics.savedReadsViaTimestampDiff += Math.max(1, count);
  if (syncTs) costMetrics.lastSyncTimestamp = syncTs;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  if (isFirestoreQuotaError(error)) {
    markWriteQuotaExhausted();
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot as required by Firebase skill
async function testConnection() {
  if (isWriteQuotaExhausted()) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
      return;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function toFirestoreMediaKey(id: number, type: MediaType): string {
  const safeType = type === 'tv' ? 'tv' : 'movie';
  return `${safeType}_${Math.abs(Math.floor(id))}`;
}

export function getLocalLibrarySyncTsKey(uid: string): string {
  return `mj_library_sync_ts_${uid}`;
}

export function getTwoFactorTicketStorageKey(uid: string): string {
  return `mj_2fa_ticket_${uid}`;
}

// Pre-warm popup resolver & complete any pending OAuth redirect flow on iOS / Safari
if (typeof window !== 'undefined') {
  try {
    (browserPopupRedirectResolver as any)?._initialize?.(auth)?.catch?.(() => {});
  } catch {
    // ignore
  }
  getRedirectResult(auth).catch(() => {});
}

// Helper to load Google Identity Services (GIS) script for iPhone Safari / PWA popup-blocker-safe OAuth2
let gisScriptPromise: Promise<boolean> | null = null;
function loadGoogleIdentityServicesScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve(true);
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean((window as any).google?.accounts?.oauth2)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean((window as any).google?.accounts?.oauth2));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

// Preload GIS script in browser so iPhone Safari can invoke initTokenClient synchronously on tap if needed
if (typeof window !== 'undefined' && !isCapacitorNative) {
  loadGoogleIdentityServicesScript().catch(() => {});
}

async function signInWithGoogleIdentityServicesFallback(): Promise<User | null> {
  const loaded = await loadGoogleIdentityServicesScript();
  const oauth2 = (window as any).google?.accounts?.oauth2;
  const clientId = (firebaseConfig as any).oAuthClientId;
  if (!loaded || !oauth2 || !clientId) {
    return null;
  }

  return new Promise<User | null>((resolve, reject) => {
    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: async (response: any) => {
          if (response?.error) {
            reject(new Error(response.error));
            return;
          }
          if (response?.access_token) {
            try {
              const cred = GoogleAuthProvider.credential(null, response.access_token);
              const res = await signInWithCredential(auth, cred);
              resolve(res.user);
            } catch (credErr) {
              reject(credErr);
            }
          } else {
            resolve(null);
          }
        },
        error_callback: (err: any) => {
          reject(err);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    } catch (e) {
      reject(e);
    }
  });
}

// --- Multi-Provider Authentication with iPhone Safari / PWA Safe Popup, GIS & Redirect Fallback ---

export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    return result.user;
  } catch (err: unknown) {
    const code = String((err as { code?: string; message?: string })?.code || (err as any)?.message || '');
    const isPopupBlockedOrUnsupported =
      code.includes('auth/popup-blocked') ||
      code.includes('auth/cancelled-popup-request') ||
      code.includes('auth/operation-not-supported-in-this-environment') ||
      code.includes('auth/web-storage-unsupported');

    if (isPopupBlockedOrUnsupported) {
      // Layer 2: Try Google Identity Services OAuth2 Token Client (engineered for iOS Safari & mobile web)
      try {
        const gisUser = await signInWithGoogleIdentityServicesFallback();
        if (gisUser) return gisUser;
      } catch {
        // Fall through to redirect
      }

      // Layer 3: Full-page OAuth Redirect fallback for iPhone Safari / Home Screen Web App
      if (!isCapacitorNative) {
        await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
        return null;
      }
    }
    throw err;
  }
}

export async function signInWithApple(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, appleProvider);
    return result.user;
  } catch (err: unknown) {
    const code = String((err as { code?: string })?.code || '');
    if (
      code.includes('auth/popup-blocked') ||
      code.includes('auth/operation-not-supported-in-this-environment')
    ) {
      if (!isCapacitorNative) {
        await signInWithRedirect(auth, appleProvider);
        return null;
      }
    }
    throw err;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  return result.user;
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName.trim().slice(0, 80);
  if (cleanName) {
    await updateProfile(result.user, { displayName: cleanName });
  }
  return result.user;
}

export async function resetPasswordForEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

// --- Server-Verified Two-Factor Authentication (2FA / RFC 6238 TOTP) & Key Pool Client ---

async function getBearerHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const idToken = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
}

export interface TwoFactorStatusResponse {
  uid: string;
  email: string;
  twoFactorEnabled: boolean;
  sessionVerified: boolean;
  remainingBackupCodes: number;
}

export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeSvg: string;
  backupCodes: string[];
}

export async function getTwoFactorStatus(userOverride?: User | null): Promise<TwoFactorStatusResponse> {
  const user = userOverride || auth.currentUser;
  if (!user) {
    return {
      uid: '',
      email: '',
      twoFactorEnabled: false,
      sessionVerified: true,
      remainingBackupCodes: 0,
    };
  }

  try {
    const idToken = await user.getIdToken();
    const ticket =
      typeof window !== 'undefined'
        ? localStorage.getItem(getTwoFactorTicketStorageKey(user.uid)) || ''
        : '';

    const res = await fetch(resolveApiBaseUrl('/api/auth/2fa/status'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ twoFactorTicket: ticket }),
    });

    if (!res.ok) {
      return {
        uid: user.uid,
        email: user.email || '',
        twoFactorEnabled: false,
        sessionVerified: true,
        remainingBackupCodes: 0,
      };
    }
    return await res.json();
  } catch {
    return {
      uid: user.uid,
      email: user.email || '',
      twoFactorEnabled: false,
      sessionVerified: true,
      remainingBackupCodes: 0,
    };
  }
}

export async function setupTwoFactor(): Promise<TwoFactorSetupResponse> {
  const headers = await getBearerHeaders();
  const res = await fetch(resolveApiBaseUrl('/api/auth/2fa/setup'), {
    method: 'POST',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to initialize 2FA setup.');
  }
  return data;
}

export async function enableTwoFactor(code: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const headers = await getBearerHeaders();
  const res = await fetch(resolveApiBaseUrl('/api/auth/2fa/enable'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: code.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Invalid 6-digit verification code.');
  }
  if (data?.twoFactorTicket && typeof window !== 'undefined') {
    localStorage.setItem(getTwoFactorTicketStorageKey(user.uid), data.twoFactorTicket);
  }
  return true;
}

export async function verifyTwoFactorChallenge(
  code: string,
  userOverride?: User | null
): Promise<{ ok: boolean; method?: string; remainingBackupCodes?: number }> {
  const user = userOverride || auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const idToken = await user.getIdToken();
  const res = await fetch(resolveApiBaseUrl('/api/auth/2fa/verify'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ code: code.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Invalid verification code.');
  }
  if (data?.twoFactorTicket && typeof window !== 'undefined') {
    localStorage.setItem(getTwoFactorTicketStorageKey(user.uid), data.twoFactorTicket);
  }
  return data;
}

export async function disableTwoFactor(): Promise<boolean> {
  const user = auth.currentUser;
  const headers = await getBearerHeaders();
  const res = await fetch(resolveApiBaseUrl('/api/auth/2fa/disable'), {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Failed to disable 2FA.');
  }
  if (user && typeof window !== 'undefined') {
    localStorage.removeItem(getTwoFactorTicketStorageKey(user.uid));
  }
  return true;
}

// --- Smart TV & Hisense VIDAA Second-Screen QR / 6-Digit Pairing Client ---

export interface TvPairingSessionResponse {
  sessionId: string;
  pollSecret: string;
  pairingCode: string;
  pairingUrl: string;
  qrCodeSvg: string;
  expiresAt: number;
}

export interface TvPairingPollResponse {
  status: 'pending' | 'approved' | 'expired';
  expiresInSec?: number;
  uid?: string;
  email?: string;
  displayName?: string;
  twoFactorTicket?: string;
  persistedUser?: Record<string, any>;
}

export async function createTvPairingSession(): Promise<TvPairingSessionResponse> {
  const origin =
    typeof window !== 'undefined' && window.location.origin.startsWith('http')
      ? window.location.origin
      : 'https://ais-pre-37sas3mekyso6nio5hh72d-849714710389.europe-west2.run.app';
  const res = await fetch(resolveApiBaseUrl('/api/auth/tv-session/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Could not create Smart TV pairing session.');
  }
  return data;
}

export async function pollTvPairingSession(
  sessionId: string,
  pollSecret: string
): Promise<TvPairingPollResponse> {
  try {
    const url = resolveApiBaseUrl(
      `/api/auth/tv-session/poll?sessionId=${encodeURIComponent(sessionId)}&pollSecret=${encodeURIComponent(pollSecret)}`
    );
    const res = await fetch(url, { method: 'GET' });
    if (res.status === 404) {
      return { status: 'expired' };
    }
    const data = await res.json().catch(() => ({ status: 'pending' }));
    return data;
  } catch {
    return { status: 'pending' };
  }
}

export async function approveTvPairingSession(
  pairingCode: string
): Promise<{ ok: boolean; email?: string; pairingCode?: string }> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Bitte melde dich zuerst auf deinem Smartphone an.');
  }
  const headers = await getBearerHeaders();
  const persistedUser = typeof user.toJSON === 'function' ? user.toJSON() : null;
  if (!persistedUser) {
    throw new Error('Konto-Sitzung konnte nicht exportiert werden.');
  }

  const res = await fetch(resolveApiBaseUrl('/api/auth/tv-session/approve'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pairingCode: pairingCode.replace(/[^0-9]/g, '').trim(),
      persistedUser,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Smart TV Koppelung fehlgeschlagen.');
  }
  return data;
}

export async function applyApprovedTvSessionAndHydrate(
  pollData: TvPairingPollResponse
): Promise<boolean> {
  if (
    pollData.status !== 'approved' ||
    !pollData.persistedUser ||
    !pollData.uid ||
    typeof window === 'undefined'
  ) {
    return false;
  }

  // 1. Save 2FA verified session ticket so the Smart TV won't challenge for 2FA
  if (pollData.twoFactorTicket) {
    localStorage.setItem(
      getTwoFactorTicketStorageKey(pollData.uid),
      pollData.twoFactorTicket
    );
  }

  // 2. Write Firebase Auth persisted user blob to localStorage for browserLocalPersistence
  const storageKey = `firebase:authUser:${firebaseConfig.apiKey}:[DEFAULT]`;
  localStorage.setItem(storageKey, JSON.stringify(pollData.persistedUser));

  // 3. Try in-memory hydration first; otherwise reload cleanly into the authenticated TV session
  try {
    const authAny = auth as any;
    const UserClass = authAny?.currentUser?.constructor;
    if (UserClass && typeof UserClass._fromJSON === 'function') {
      const hydrated = UserClass._fromJSON(authAny, pollData.persistedUser);
      await updateCurrentUser(auth, hydrated);
      return true;
    }
  } catch {
    // Fallback to clean page reload which reads firebase:authUser from browserLocalPersistence
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('tvPair');
  window.location.replace(cleanUrl.toString());
  return true;
}

export interface ServerKeyPoolItem {
  keyId: string;
  slotNumber: number;
  maskedKey: string;
  source: 'env' | 'vault';
  status: 'healthy' | 'cooldown' | 'invalid';
  cooldownRemainingSec: number;
  totalRequests: number;
  failoverCount: number;
  lastLatencyMs: number;
}

export interface ServerKeyPoolStatus {
  poolSize: number;
  healthyCount: number;
  estimatedRpsCapacity: number;
  totalFailovers: number;
  cacheStats: {
    l1Entries: number;
    maxL1Entries: number;
    cacheHits: number;
    coalescedHits: number;
    swrInstantHits: number;
    cacheMisses: number;
    hitRatePercent: number;
  };
  keys: ServerKeyPoolItem[];
}

export async function fetchTmdbKeyPoolStatus(): Promise<ServerKeyPoolStatus | null> {
  try {
    const headers = await getBearerHeaders();
    const res = await fetch(resolveApiBaseUrl('/api/admin/tmdb-keys'), {
      method: 'GET',
      headers,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function addTmdbKeysToServerPool(keysInput: string): Promise<{
  ok: boolean;
  addedCount: number;
  addedMasked: string[];
  invalidMasked: string[];
  poolSize: number;
}> {
  const headers = await getBearerHeaders();
  const res = await fetch(resolveApiBaseUrl('/api/admin/tmdb-keys'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ keys: keysInput }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Could not add API keys to server pool.');
  }
  return data;
}

export async function removeTmdbKeyFromServerPool(keyId: string): Promise<boolean> {
  const headers = await getBearerHeaders();
  const res = await fetch(
    resolveApiBaseUrl(`/api/admin/tmdb-keys/${encodeURIComponent(keyId)}`),
    {
      method: 'DELETE',
      headers,
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Could not remove key from pool.');
  }
  return true;
}

// --- User Profile & Timestamp-Diff Sync ---

export interface CloudUserProfileInput {
  displayName: string;
  photoURL: string;
  region: string;
  language: string;
  theme: string;
  userProviders: number[];
  userGenres: number[];
  autoplay: boolean;
  dataSaver: boolean;
  includeAdult: boolean;
  lastLibraryUpdatedAt?: string;
}

function sanitizeRegion(region: string): string {
  const clean = (region || 'DE').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  return clean.length >= 2 ? clean : 'DE';
}

function sanitizeLanguage(lang: string): string {
  const clean = (lang || 'de-DE').replace(/[^a-zA-Z\-]/g, '').slice(0, 10);
  return clean.length >= 2 ? clean : 'de-DE';
}

function sanitizeTheme(theme: string): 'indigo' | 'crimson' | 'emerald' | 'gold' | 'violet' {
  if (
    theme === 'crimson' ||
    theme === 'emerald' ||
    theme === 'gold' ||
    theme === 'violet'
  ) {
    return theme;
  }
  return 'indigo';
}

async function fetchServerUserSyncState(): Promise<{
  profile?: Record<string, any>;
  library?: {
    watchlist?: MediaItem[];
    removedWatchlistKeys?: Record<string, number>;
    watchedMovies?: number[];
    removedMovies?: Record<string, number>;
    manuallyWatchedShows?: number[];
    removedShows?: Record<string, number>;
    watchedEpisodes?: Record<number, number[]>;
    updatedAt?: string;
  };
} | null> {
  if (!auth.currentUser) return null;
  try {
    const headers = await getBearerHeaders();
    const res = await fetch(resolveApiBaseUrl('/api/user-sync/state'), {
      method: 'GET',
      headers,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function pushServerUserSyncState(payload: {
  profile?: Record<string, any>;
  library?: Record<string, any>;
}): Promise<void> {
  if (!auth.currentUser) return;
  try {
    const headers = await getBearerHeaders();
    await fetch(resolveApiBaseUrl('/api/user-sync/state'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore
  }
}

export async function ensureAndSyncUserProfile(
  user: User,
  prefs: CloudUserProfileInput
): Promise<CloudUserProfileInput & { lastLibraryUpdatedAt: string; isNewUser: boolean }> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const safeRegion = sanitizeRegion(prefs.region);
  const safeLang = sanitizeLanguage(prefs.language);
  const safeTheme = sanitizeTheme(prefs.theme);
  const safeProviders = (prefs.userProviders || [])
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .slice(0, 50);
  const safeGenres = (prefs.userGenres || [])
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .slice(0, 25);

  const fallbackFromServerOrLocal = async () => {
    const serverState = await fetchServerUserSyncState();
    const sp = serverState?.profile || {};
    const mergedProviders = Array.from(
      new Set([...(sp.userProviders || []), ...safeProviders])
    ).slice(0, 50);
    const mergedGenres = Array.from(
      new Set([...(sp.userGenres || []), ...safeGenres])
    ).slice(0, 25);
    const result = {
      displayName: (user.displayName || sp.displayName || prefs.displayName || 'Cinephile').slice(
        0,
        100
      ),
      photoURL: (user.photoURL || sp.photoURL || prefs.photoURL || '').slice(0, 500),
      region: sanitizeRegion(sp.region || safeRegion),
      language: sanitizeLanguage(sp.language || safeLang),
      theme: sanitizeTheme(sp.theme || safeTheme),
      userProviders: mergedProviders,
      userGenres: mergedGenres,
      autoplay: typeof sp.autoplay === 'boolean' ? sp.autoplay : Boolean(prefs.autoplay),
      dataSaver: typeof sp.dataSaver === 'boolean' ? sp.dataSaver : Boolean(prefs.dataSaver),
      includeAdult:
        typeof sp.includeAdult === 'boolean' ? sp.includeAdult : Boolean(prefs.includeAdult),
      lastLibraryUpdatedAt:
        typeof sp.lastLibraryUpdatedAt === 'string' && sp.lastLibraryUpdatedAt
          ? sp.lastLibraryUpdatedAt
          : new Date().toISOString(),
      isNewUser: !serverState?.profile,
    };
    await pushServerUserSyncState({ profile: result });
    return result;
  };

  if (isWriteQuotaExhausted()) {
    return await fallbackFromServerOrLocal();
  }

  try {
    costMetrics.sessionReads += 1;
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      const initialTs = new Date().toISOString();
      const firestoreProfileFields = {
        displayName: (user.displayName || prefs.displayName || 'Cinephile').slice(0, 100),
        photoURL: (user.photoURL || prefs.photoURL || '').slice(0, 500),
        region: safeRegion,
        language: safeLang,
        theme: safeTheme,
        userProviders: safeProviders,
        userGenres: safeGenres,
        autoplay: Boolean(prefs.autoplay),
        dataSaver: Boolean(prefs.dataSaver),
        includeAdult: Boolean(prefs.includeAdult),
        lastLibraryUpdatedAt: initialTs,
      };
      const createdProfile = {
        ...firestoreProfileFields,
        isNewUser: true,
      };
      await pushServerUserSyncState({ profile: createdProfile });
      if (!isWriteQuotaExhausted()) {
        costMetrics.sessionWrites += 1;
        await setDoc(userRef, {
          uid,
          ...firestoreProfileFields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      return createdProfile;
    } else {
      const data = snap.data();
      const mergedProviders = Array.from(
        new Set([...(data.userProviders || []), ...safeProviders])
      ).slice(0, 50);
      const mergedGenres = Array.from(
        new Set([...(data.userGenres || []), ...safeGenres])
      ).slice(0, 25);

      const cloudRegion = sanitizeRegion(data.region || safeRegion);
      const cloudLang = sanitizeLanguage(data.language || safeLang);
      const cloudTheme = sanitizeTheme(data.theme || safeTheme);
      const cloudLibTs =
        typeof data.lastLibraryUpdatedAt === 'string' && data.lastLibraryUpdatedAt.length > 0
          ? data.lastLibraryUpdatedAt.slice(0, 40)
          : new Date().toISOString();

      const needsProfilePatch =
        typeof data.lastLibraryUpdatedAt !== 'string' ||
        mergedProviders.length !== (data.userProviders || []).length ||
        mergedGenres.length !== (data.userGenres || []).length;

      const syncedProfile = {
        displayName: (user.displayName || data.displayName || 'Cinephile').slice(0, 100),
        photoURL: (user.photoURL || data.photoURL || '').slice(0, 500),
        region: cloudRegion,
        language: cloudLang,
        theme: cloudTheme,
        userProviders: mergedProviders,
        userGenres: mergedGenres,
        autoplay: typeof data.autoplay === 'boolean' ? data.autoplay : Boolean(prefs.autoplay),
        dataSaver: typeof data.dataSaver === 'boolean' ? data.dataSaver : Boolean(prefs.dataSaver),
        includeAdult:
          typeof data.includeAdult === 'boolean' ? data.includeAdult : Boolean(prefs.includeAdult),
        lastLibraryUpdatedAt: cloudLibTs,
        isNewUser: false,
      };

      await pushServerUserSyncState({ profile: syncedProfile });

      if (needsProfilePatch && !isWriteQuotaExhausted()) {
        costMetrics.sessionWrites += 1;
        await updateDoc(userRef, {
          displayName: syncedProfile.displayName,
          photoURL: syncedProfile.photoURL,
          region: cloudRegion,
          language: cloudLang,
          theme: cloudTheme,
          userProviders: mergedProviders,
          userGenres: mergedGenres,
          autoplay: syncedProfile.autoplay,
          dataSaver: syncedProfile.dataSaver,
          includeAdult: syncedProfile.includeAdult,
          lastLibraryUpdatedAt: cloudLibTs,
          updatedAt: serverTimestamp(),
        });
      }

      return syncedProfile;
    }
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
    } else {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
    return await fallbackFromServerOrLocal();
  }
}

export async function updateUserProfilePrefsFirestore(
  uid: string,
  prefs: CloudUserProfileInput
): Promise<void> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  const safeRegion = sanitizeRegion(prefs.region);
  const safeLang = sanitizeLanguage(prefs.language);
  const safeTheme = sanitizeTheme(prefs.theme);
  const currentSyncTs =
    prefs.lastLibraryUpdatedAt ||
    (typeof window !== 'undefined' ? localStorage.getItem(getLocalLibrarySyncTsKey(uid)) : null) ||
    new Date().toISOString();

  const cleanPrefs = {
    displayName: (prefs.displayName || 'Cinephile').slice(0, 100),
    photoURL: (prefs.photoURL || '').slice(0, 500),
    region: safeRegion,
    language: safeLang,
    theme: safeTheme,
    userProviders: (prefs.userProviders || [])
      .filter((n) => typeof n === 'number' && Number.isFinite(n))
      .slice(0, 50),
    userGenres: (prefs.userGenres || [])
      .filter((n) => typeof n === 'number' && Number.isFinite(n))
      .slice(0, 25),
    autoplay: Boolean(prefs.autoplay),
    dataSaver: Boolean(prefs.dataSaver),
    includeAdult: Boolean(prefs.includeAdult),
    lastLibraryUpdatedAt: currentSyncTs.slice(0, 40),
  };

  await pushServerUserSyncState({ profile: cleanPrefs });
  if (!canPerformClientFirestoreWrite()) return;

  try {
    costMetrics.sessionWrites += 1;
    await updateDoc(userRef, {
      ...cleanPrefs,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function bumpUserLibrarySyncTimestamp(uid: string): Promise<string> {
  const nextTs = new Date().toISOString();
  const userRef = doc(db, 'users', uid);
  if (typeof window !== 'undefined') {
    localStorage.setItem(getLocalLibrarySyncTsKey(uid), nextTs);
  }
  costMetrics.lastSyncTimestamp = nextTs;
  await pushServerUserSyncState({
    profile: { lastLibraryUpdatedAt: nextTs },
  });
  if (!canPerformClientFirestoreWrite()) return nextTs;

  try {
    costMetrics.sessionWrites += 1;
    await updateDoc(userRef, {
      lastLibraryUpdatedAt: nextTs,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
    }
  }
  return nextTs;
}

export interface SyncedLibrarySnapshot {
  watchlist: MediaItem[];
  removedWatchlistKeys: Record<string, number>;
  watchedMovies: number[];
  removedMovies: Record<string, number>;
  manuallyWatchedShows: number[];
  removedShows: Record<string, number>;
  watchedEpisodes: Record<number, number[]>;
}

/**
 * Compacts a MediaItem before storing it in /userLibraryVault/{uid} or /api/user-sync/state
 * so 500 items stay well below 150 KB (Firestore hard limit is 1 MiB).
 */
export function compactMediaItemForSync(item: MediaItem): MediaItem & { _addedAtMs?: number } {
  const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
  return {
    id: Math.abs(Math.floor(Number(item.id))),
    media_type: mType,
    title: mType === 'movie' ? (item.title || item.name || 'Untitled').slice(0, 140) : undefined,
    name: mType === 'tv' ? (item.name || item.title || 'Untitled').slice(0, 140) : undefined,
    poster_path: item.poster_path ? String(item.poster_path).slice(0, 120) : null,
    backdrop_path: item.backdrop_path ? String(item.backdrop_path).slice(0, 120) : null,
    release_date:
      mType === 'movie'
        ? String(item.release_date || item.first_air_date || '').slice(0, 20)
        : undefined,
    first_air_date:
      mType === 'tv'
        ? String(item.first_air_date || item.release_date || '').slice(0, 20)
        : undefined,
    vote_average: Math.round(Math.min(10, Math.max(0, Number(item.vote_average || 0))) * 10) / 10,
    ...((item as any)._addedAtMs ? { _addedAtMs: Number((item as any)._addedAtMs) } : {}),
  };
}

function normalizeEpisodeRecord(raw: Record<string, any> | undefined): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const numKey = Number(k);
    if (Number.isFinite(numKey) && Array.isArray(v)) {
      const cleanEps = Array.from(
        new Set(v.map(Number).filter((n) => Number.isFinite(n) && n > 0))
      );
      if (cleanEps.length > 0) out[numKey] = cleanEps;
    }
  }
  return out;
}

/**
 * Reads the atomic 1-Doc Firestore Library Vault (/userLibraryVault/{uid}).
 * Shared across all Cloud Run containers (ais-dev, ais-pre), Capacitor iPhone, and Smart TVs in 1 Read.
 */
export async function fetchUserLibraryVaultFirestore(
  uid: string
): Promise<Partial<SyncedLibrarySnapshot> | null> {
  if (!uid) return null;
  try {
    costMetrics.sessionReads += 1;
    const snap = await getDoc(doc(db, 'userLibraryVault', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || typeof data.libraryJson !== 'string') return null;
    const parsed = JSON.parse(data.libraryJson);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      removedWatchlistKeys:
        parsed.removedWatchlistKeys && typeof parsed.removedWatchlistKeys === 'object'
          ? parsed.removedWatchlistKeys
          : {},
      watchedMovies: Array.isArray(parsed.watchedMovies) ? parsed.watchedMovies : [],
      removedMovies:
        parsed.removedMovies && typeof parsed.removedMovies === 'object'
          ? parsed.removedMovies
          : {},
      manuallyWatchedShows: Array.isArray(parsed.manuallyWatchedShows)
        ? parsed.manuallyWatchedShows
        : [],
      removedShows:
        parsed.removedShows && typeof parsed.removedShows === 'object' ? parsed.removedShows : {},
      watchedEpisodes: normalizeEpisodeRecord(parsed.watchedEpisodes),
    };
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
    }
    return null;
  }
}

/**
 * Writes the unified library snapshot atomically to /userLibraryVault/{uid} in 1 Firestore Write.
 */
export async function saveUserLibraryVaultFirestore(
  uid: string,
  snapshot: {
    watchlist: MediaItem[];
    removedWatchlistKeys?: Record<string, number>;
    watchedMovies: number[];
    removedMovies?: Record<string, number>;
    manuallyWatchedShows: number[];
    removedShows?: Record<string, number>;
    watchedEpisodes: Record<number, number[]>;
  }
): Promise<void> {
  if (!uid || !canPerformClientFirestoreWrite()) return;
  try {
    const compactedWatchlist = (snapshot.watchlist || [])
      .slice(0, 500)
      .map(compactMediaItemForSync);
    const payloadObj = {
      watchlist: compactedWatchlist,
      removedWatchlistKeys: snapshot.removedWatchlistKeys || {},
      watchedMovies: (snapshot.watchedMovies || []).slice(0, 500),
      removedMovies: snapshot.removedMovies || {},
      manuallyWatchedShows: (snapshot.manuallyWatchedShows || []).slice(0, 500),
      removedShows: snapshot.removedShows || {},
      watchedEpisodes: snapshot.watchedEpisodes || {},
      updatedAtIso: new Date().toISOString(),
    };
    const libraryJson = JSON.stringify(payloadObj);
    if (libraryJson.length > 850000) return;

    costMetrics.sessionWrites += 1;
    await setDoc(doc(db, 'userLibraryVault', uid), {
      uid: String(uid).trim(),
      libraryJson,
      itemCount: Math.max(0, Math.min(5000, Math.floor(compactedWatchlist.length))),
      updatedAtMs: Math.max(1, Math.floor(Date.now())),
    });
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
      return;
    }
    // Server bridge (/api/user-sync/state) also mirrors the vault; avoid crashing the UI on transient client rule/network races
    console.warn('Client userLibraryVault sync fallback to server bridge:', error);
  }
}

/**
 * Permanently deletes the signed-in user's cloud data (Watchlist, Progress, Vaults, Profile)
 * and deletes their Firebase Auth account (Apple App Store Guideline 5.1.1(v) compliance).
 */
export async function deleteUserAccountAndCloudData(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Kein angemeldetes Konto gefunden.');
  }
  const uid = user.uid;

  try {
    const idToken = await user.getIdToken();
    const base = resolveApiBaseUrl();
    await fetch(`${base}/api/user-sync/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    }).catch(() => {});
  } catch {
    // Continue with client cleanup
  }

  try {
    const [wlSnap, progSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'watchlist'), where('uid', '==', uid), limit(500))).catch(() => null),
      getDocs(query(collection(db, 'users', uid, 'progress'), where('uid', '==', uid), limit(500))).catch(() => null),
    ]);
    const deletes: Promise<unknown>[] = [];
    wlSnap?.forEach((d) => deletes.push(deleteDoc(d.ref).catch(() => {})));
    progSnap?.forEach((d) => deletes.push(deleteDoc(d.ref).catch(() => {})));
    deletes.push(deleteDoc(doc(db, 'userLibraryVault', uid)).catch(() => {}));
    deletes.push(deleteDoc(doc(db, 'userSecurityVault', uid)).catch(() => {}));
    deletes.push(deleteDoc(doc(db, 'users', uid)).catch(() => {}));
    await Promise.allSettled(deletes);
  } catch {
    // Ignore partial Firestore cleanup errors
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(getLocalLibrarySyncTsKey(uid));
      sessionStorage.removeItem(getTwoFactorTicketStorageKey(uid));
    } catch {
      // ignore
    }
  }

  try {
    await deleteUser(user);
  } catch (err: any) {
    // If Firebase requires recent login for Auth record deletion, sign out after wiping all cloud & profile data
    const code = String(err?.code || '');
    if (code.includes('auth/requires-recent-login')) {
      await signOut(auth);
      return;
    }
    await signOut(auth).catch(() => {});
  }
}

/**
 * Pushes the complete current library snapshot to both the Server Sync Vault AND the atomic
 * Firestore /userLibraryVault/{uid} document so every device & URL stays 100% synchronized.
 */
export async function syncFullLibrarySnapshotToCloud(
  uid: string,
  snapshot: {
    watchlist: MediaItem[];
    watchedMovies: number[];
    manuallyWatchedShows: number[];
    watchedEpisodes: Record<number, number[]>;
    removedWatchlistKeys?: Record<string, number>;
    removedMovies?: Record<string, number>;
    removedShows?: Record<string, number>;
  }
): Promise<void> {
  if (!uid) return;
  const compactedWatchlist = (snapshot.watchlist || []).slice(0, 500).map(compactMediaItemForSync);
  await Promise.all([
    pushServerUserSyncState({
      library: {
        watchlist: compactedWatchlist,
        removedWatchlistKeys: snapshot.removedWatchlistKeys || {},
        watchedMovies: (snapshot.watchedMovies || []).slice(0, 500),
        removedMovies: snapshot.removedMovies || {},
        manuallyWatchedShows: (snapshot.manuallyWatchedShows || []).slice(0, 500),
        removedShows: snapshot.removedShows || {},
        watchedEpisodes: snapshot.watchedEpisodes || {},
        updatedAt: new Date().toISOString(),
      },
    }),
    saveUserLibraryVaultFirestore(uid, {
      watchlist: compactedWatchlist,
      removedWatchlistKeys: snapshot.removedWatchlistKeys,
      watchedMovies: snapshot.watchedMovies,
      removedMovies: snapshot.removedMovies,
      manuallyWatchedShows: snapshot.manuallyWatchedShows,
      removedShows: snapshot.removedShows,
      watchedEpisodes: snapshot.watchedEpisodes,
    }),
  ]);
}

export function combineLibrarySnapshots(
  firestoreSnap: {
    watchlist: MediaItem[];
    watchedMovies: number[];
    manuallyWatchedShows: number[];
    watchedEpisodes: Record<number, number[]>;
  },
  serverLib?: {
    watchlist?: MediaItem[];
    removedWatchlistKeys?: Record<string, number>;
    watchedMovies?: number[];
    removedMovies?: Record<string, number>;
    manuallyWatchedShows?: number[];
    removedShows?: Record<string, number>;
    watchedEpisodes?: Record<number, number[]>;
  } | null,
  localLib?: {
    watchlist?: MediaItem[];
    watchedMovies?: number[];
    manuallyWatchedShows?: number[];
    watchedEpisodes?: Record<number, number[]>;
  } | null,
  vaultLib?: Partial<SyncedLibrarySnapshot> | null
): SyncedLibrarySnapshot {
  const removedWatchlistKeys: Record<string, number> = {
    ...(vaultLib?.removedWatchlistKeys || {}),
    ...(serverLib?.removedWatchlistKeys || {}),
  };
  for (const [k, v] of Object.entries(vaultLib?.removedWatchlistKeys || {})) {
    if (Number(v) > (removedWatchlistKeys[k] || 0)) {
      removedWatchlistKeys[k] = Number(v);
    }
  }

  const removedMovies: Record<string, number> = {
    ...(vaultLib?.removedMovies || {}),
    ...(serverLib?.removedMovies || {}),
  };
  const removedShows: Record<string, number> = {
    ...(vaultLib?.removedShows || {}),
    ...(serverLib?.removedShows || {}),
  };

  const wlMap = new Map<string, MediaItem>();
  const addItems = (list: MediaItem[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || !item.id || item.id <= 0) continue;
      const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
      const key = toFirestoreMediaKey(item.id, mType);
      const removedAt = Number(removedWatchlistKeys[key] || 0);
      const addedAt = Number((item as any)._addedAtMs || 0);
      if (removedAt > 0 && addedAt <= removedAt) continue;
      if (removedAt > 0 && addedAt > removedAt) {
        delete removedWatchlistKeys[key];
      }
      if (!wlMap.has(key)) {
        wlMap.set(key, { ...item, media_type: mType });
      }
    }
  };

  // Priority order: Atomic Firestore Vault -> Firestore Subcollections -> Server Sync Vault -> Local unmerged items
  addItems(vaultLib?.watchlist);
  addItems(firestoreSnap.watchlist);
  addItems(serverLib?.watchlist);
  addItems(localLib?.watchlist);

  const movieSet = new Set<number>();
  for (const id of [
    ...(vaultLib?.watchedMovies || []),
    ...(firestoreSnap.watchedMovies || []),
    ...(serverLib?.watchedMovies || []),
    ...(localLib?.watchedMovies || []),
  ]) {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0 && !removedMovies[String(n)]) {
      movieSet.add(n);
    }
  }

  const showSet = new Set<number>();
  for (const id of [
    ...(vaultLib?.manuallyWatchedShows || []),
    ...(firestoreSnap.manuallyWatchedShows || []),
    ...(serverLib?.manuallyWatchedShows || []),
    ...(localLib?.manuallyWatchedShows || []),
  ]) {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0 && !removedShows[String(n)]) {
      showSet.add(n);
    }
  }

  const mergedEpisodes: Record<number, number[]> = {};
  const mergeEpSource = (src: Record<number, number[]> | undefined) => {
    if (!src || typeof src !== 'object') return;
    for (const [k, eps] of Object.entries(src)) {
      const sId = Number(k);
      if (!Number.isFinite(sId) || sId <= 0 || !Array.isArray(eps)) continue;
      const existing = mergedEpisodes[sId] || [];
      const combined = Array.from(
        new Set([...existing, ...eps.map(Number).filter((n) => Number.isFinite(n) && n > 0)])
      );
      if (combined.length > 0) {
        mergedEpisodes[sId] = combined;
      }
    }
  };

  mergeEpSource(vaultLib?.watchedEpisodes);
  mergeEpSource(firestoreSnap.watchedEpisodes);
  mergeEpSource(normalizeEpisodeRecord(serverLib?.watchedEpisodes as any));
  mergeEpSource(localLib?.watchedEpisodes);

  return {
    watchlist: Array.from(wlMap.values()),
    removedWatchlistKeys,
    watchedMovies: Array.from(movieSet),
    removedMovies,
    manuallyWatchedShows: Array.from(showSet),
    removedShows,
    watchedEpisodes: mergedEpisodes,
  };
}

export async function fetchLibrarySubcollectionsOnce(uid: string): Promise<{
  watchlist: MediaItem[];
  watchedMovies: number[];
  manuallyWatchedShows: number[];
  watchedEpisodes: Record<number, number[]>;
}> {
  const serverPromise = fetchServerUserSyncState().catch(() => null);
  const vaultPromise = fetchUserLibraryVaultFirestore(uid).catch(() => null);

  let firestoreData = {
    watchlist: [] as MediaItem[],
    watchedMovies: [] as number[],
    manuallyWatchedShows: [] as number[],
    watchedEpisodes: {} as Record<number, number[]>,
  };

  try {
    const watchlistQ = query(
      collection(db, 'users', uid, 'watchlist'),
      where('uid', '==', uid),
      limit(500)
    );
    const progressQ = query(
      collection(db, 'users', uid, 'progress'),
      where('uid', '==', uid),
      limit(500)
    );

    const [wlSnap, progSnap] = await Promise.all([getDocs(watchlistQ), getDocs(progressQ)]);
    costMetrics.sessionReads += Math.max(1, wlSnap.size) + Math.max(1, progSnap.size);

    const watchlist: MediaItem[] = [];
    wlSnap.forEach((docSnap) => {
      const d = docSnap.data();
      watchlist.push({
        id: Number(d.mediaId),
        media_type: d.mediaType === 'tv' ? 'tv' : 'movie',
        title: d.mediaType === 'movie' ? d.title : undefined,
        name: d.mediaType === 'tv' ? d.title : undefined,
        poster_path: d.posterPath || null,
        backdrop_path: d.backdropPath || null,
        release_date: d.mediaType === 'movie' ? d.releaseDate : undefined,
        first_air_date: d.mediaType === 'tv' ? d.releaseDate : undefined,
        vote_average: Number(d.voteAverage || 0),
        overview: d.overview || '',
      });
    });

    const watchedMovies: number[] = [];
    const manuallyWatchedShows: number[] = [];
    const watchedEpisodes: Record<number, number[]> = {};

    progSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const mId = Number(d.mediaId);
      if (d.mediaType === 'movie') {
        if (d.isCompleted) watchedMovies.push(mId);
      } else if (d.mediaType === 'tv') {
        if (d.isCompleted) manuallyWatchedShows.push(mId);
        if (Array.isArray(d.watchedEpisodes) && d.watchedEpisodes.length > 0) {
          watchedEpisodes[mId] = d.watchedEpisodes;
        }
      }
    });

    firestoreData = { watchlist, watchedMovies, manuallyWatchedShows, watchedEpisodes };
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
    }
  }

  const [serverState, vaultState] = await Promise.all([serverPromise, vaultPromise]);
  const combined = combineLibrarySnapshots(
    firestoreData,
    serverState?.library || null,
    null,
    vaultState
  );
  return {
    watchlist: combined.watchlist,
    watchedMovies: combined.watchedMovies,
    manuallyWatchedShows: combined.manuallyWatchedShows,
    watchedEpisodes: combined.watchedEpisodes,
  };
}

/**
 * Real-Time Account Library Subscription (Atomic /userLibraryVault/{uid} + Subcollections + Server Sync Vault)
 * Keeps iPhone, Laptop, Hisense VIDAA Smart TV, ais-dev, and ais-pre in sync in real time.
 */
export function subscribeToUserLibraryRealtime(
  uid: string,
  onLibraryUpdate: (snapshot: {
    watchlist: MediaItem[];
    watchedMovies: number[];
    manuallyWatchedShows: number[];
    watchedEpisodes: Record<number, number[]>;
  }) => void
): () => void {
  let latestFirestoreWl: MediaItem[] = [];
  let latestFirestoreMovies: number[] = [];
  let latestFirestoreShows: number[] = [];
  let latestFirestoreEps: Record<number, number[]> = {};
  let latestServerLib: Record<string, any> | null = null;
  let latestVaultLib: Partial<SyncedLibrarySnapshot> | null = null;
  let lastEmittedJson = '';
  let active = true;

  const emitCombined = () => {
    if (!active) return;
    const merged = combineLibrarySnapshots(
      {
        watchlist: latestFirestoreWl,
        watchedMovies: latestFirestoreMovies,
        manuallyWatchedShows: latestFirestoreShows,
        watchedEpisodes: latestFirestoreEps,
      },
      latestServerLib,
      null,
      latestVaultLib
    );
    const payload = {
      watchlist: merged.watchlist,
      watchedMovies: merged.watchedMovies,
      manuallyWatchedShows: merged.manuallyWatchedShows,
      watchedEpisodes: merged.watchedEpisodes,
      removedWatchlistKeys: merged.removedWatchlistKeys,
      removedMovies: merged.removedMovies,
      removedShows: merged.removedShows,
    };
    try {
      const nextJson = JSON.stringify(payload);
      if (nextJson === lastEmittedJson) return;
      lastEmittedJson = nextJson;
    } catch {
      // ignore
    }
    onLibraryUpdate(payload);
  };

  const pullServerAndVault = async () => {
    const [s, v] = await Promise.all([
      fetchServerUserSyncState().catch(() => null),
      fetchUserLibraryVaultFirestore(uid).catch(() => null),
    ]);
    if (!active) return;
    if (s?.library) latestServerLib = s.library;
    if (v) latestVaultLib = v;
    emitCombined();
  };

  pullServerAndVault();

  // 1. Real-time listener on atomic 1-Doc /userLibraryVault/{uid} (cross-origin & cross-container source of truth)
  const unsubVault = onSnapshot(
    doc(db, 'userLibraryVault', uid),
    (snap) => {
      if (!active || !snap.exists()) return;
      try {
        const data = snap.data();
        if (data && typeof data.libraryJson === 'string') {
          const parsed = JSON.parse(data.libraryJson);
          if (parsed && typeof parsed === 'object') {
            latestVaultLib = {
              watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
              removedWatchlistKeys: parsed.removedWatchlistKeys || {},
              watchedMovies: Array.isArray(parsed.watchedMovies) ? parsed.watchedMovies : [],
              removedMovies: parsed.removedMovies || {},
              manuallyWatchedShows: Array.isArray(parsed.manuallyWatchedShows)
                ? parsed.manuallyWatchedShows
                : [],
              removedShows: parsed.removedShows || {},
              watchedEpisodes: normalizeEpisodeRecord(parsed.watchedEpisodes),
            };
            // Also prune any deleted items from cached latestServerLib / latestFirestoreWl immediately
            const tombstones = latestVaultLib.removedWatchlistKeys || {};
            if (Object.keys(tombstones).length > 0) {
              latestFirestoreWl = latestFirestoreWl.filter((item) => {
                const mType = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
                const k = toFirestoreMediaKey(item.id, mType);
                return !tombstones[k];
              });
              if (latestServerLib?.watchlist) {
                latestServerLib = {
                  ...latestServerLib,
                  watchlist: latestServerLib.watchlist.filter((item) => {
                    const mType = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
                    const k = toFirestoreMediaKey(item.id, mType);
                    return !tombstones[k];
                  }),
                  removedWatchlistKeys: {
                    ...(latestServerLib.removedWatchlistKeys || {}),
                    ...tombstones,
                  },
                };
              }
            }
            emitCombined();
          }
        }
      } catch {
        // ignore parse errors
      }
    },
    () => {}
  );

  // 2. Real-time listeners on subcollections (bounded to 500 items)
  const watchlistQ = query(
    collection(db, 'users', uid, 'watchlist'),
    where('uid', '==', uid),
    limit(500)
  );
  const progressQ = query(
    collection(db, 'users', uid, 'progress'),
    where('uid', '==', uid),
    limit(500)
  );

  const unsubWl = onSnapshot(
    watchlistQ,
    (snap) => {
      if (!active) return;
      const list: MediaItem[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: Number(d.mediaId),
          media_type: d.mediaType === 'tv' ? 'tv' : 'movie',
          title: d.mediaType === 'movie' ? d.title : undefined,
          name: d.mediaType === 'tv' ? d.title : undefined,
          poster_path: d.posterPath || null,
          backdrop_path: d.backdropPath || null,
          release_date: d.mediaType === 'movie' ? d.releaseDate : undefined,
          first_air_date: d.mediaType === 'tv' ? d.releaseDate : undefined,
          vote_average: Number(d.voteAverage || 0),
          overview: d.overview || '',
        });
      });
      latestFirestoreWl = list;
      emitCombined();
    },
    () => {
      pullServerAndVault();
    }
  );

  const unsubProg = onSnapshot(
    progressQ,
    (snap) => {
      if (!active) return;
      const movies: number[] = [];
      const shows: number[] = [];
      const eps: Record<number, number[]> = {};
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const mId = Number(d.mediaId);
        if (d.mediaType === 'movie') {
          if (d.isCompleted) movies.push(mId);
        } else if (d.mediaType === 'tv') {
          if (d.isCompleted) shows.push(mId);
          if (Array.isArray(d.watchedEpisodes) && d.watchedEpisodes.length > 0) {
            eps[mId] = d.watchedEpisodes;
          }
        }
      });
      latestFirestoreMovies = movies;
      latestFirestoreShows = shows;
      latestFirestoreEps = eps;
      emitCombined();
    },
    () => {
      pullServerAndVault();
    }
  );

  // Focus-triggered & fast periodic sync fallback (every 4s while visible)
  const pollTimer =
    typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            pullServerAndVault();
          }
        }, 4000)
      : null;

  const onFocus = () => pullServerAndVault();
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus);
  }

  return () => {
    active = false;
    unsubVault();
    unsubWl();
    unsubProg();
    if (pollTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(pollTimer);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onFocus);
    }
  };
}

export async function saveWatchlistItemFirestore(
  uid: string,
  item: MediaItem,
  skipTimestampBump = false
): Promise<void> {
  const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
  const mediaKey = toFirestoreMediaKey(item.id, mType);
  const path = `users/${uid}/watchlist/${mediaKey}`;
  const ref = doc(db, 'users', uid, 'watchlist', mediaKey);

  // 1. Immediately mirror to Server Sync Vault so all devices see the addition right away
  if (!skipTimestampBump) {
    pushServerUserSyncState({
      library: {
        watchlist: [compactMediaItemForSync({ ...item, media_type: mType, _addedAtMs: Date.now() } as any)],
      },
    }).catch(() => {});
  }

  if (!canPerformClientFirestoreWrite()) {
    return;
  }

  const mutableFields = {
    title: (item.title || item.name || 'Untitled').slice(0, 300),
    posterPath: (item.poster_path || '').slice(0, 300),
    backdropPath: (item.backdrop_path || '').slice(0, 300),
    releaseDate: (item.release_date || item.first_air_date || '').slice(0, 30),
    voteAverage: Math.min(10, Math.max(0, Number(item.vote_average || 0))),
    overview: (item.overview || '').slice(0, 2000),
    updatedAt: serverTimestamp(),
  };

  try {
    costMetrics.sessionReads += 1;
    const existing = await getDoc(ref);
    costMetrics.sessionWrites += 1;
    if (existing.exists()) {
      await updateDoc(ref, mutableFields);
    } else {
      await setDoc(ref, {
        uid,
        mediaKey,
        mediaId: Number(item.id),
        mediaType: mType,
        ...mutableFields,
        addedAt: serverTimestamp(),
      });
    }
    if (!skipTimestampBump) {
      await bumpUserLibrarySyncTimestamp(uid);
    }
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteWatchlistItemFirestore(
  uid: string,
  id: number,
  type: MediaType,
  skipTimestampBump = false
): Promise<void> {
  const mType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
  const mediaKey = toFirestoreMediaKey(id, mType);
  const path = `users/${uid}/watchlist/${mediaKey}`;
  const ref = doc(db, 'users', uid, 'watchlist', mediaKey);

  // 1. Record removal tombstone in Server Sync Vault so other devices remove it cleanly
  if (!skipTimestampBump) {
    pushServerUserSyncState({
      library: {
        removedWatchlistKeys: { [mediaKey]: Date.now() },
      },
    }).catch(() => {});
  }

  if (!canPerformClientFirestoreWrite()) {
    return;
  }

  try {
    costMetrics.sessionWrites += 1;
    await deleteDoc(ref);
    if (!skipTimestampBump) {
      await bumpUserLibrarySyncTimestamp(uid);
    }
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveWatchProgressFirestore(
  uid: string,
  mediaId: number,
  mediaType: 'movie' | 'tv',
  isCompleted: boolean,
  watchedEpisodes: number[],
  skipTimestampBump = false
): Promise<void> {
  const mediaKey = toFirestoreMediaKey(mediaId, mediaType);
  const path = `users/${uid}/progress/${mediaKey}`;
  const ref = doc(db, 'users', uid, 'progress', mediaKey);
  const safeEps = (watchedEpisodes || [])
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .slice(0, 500);

  if (!skipTimestampBump) {
    if (mediaType === 'movie') {
      pushServerUserSyncState({
        library: isCompleted
          ? { watchedMovies: [Number(mediaId)], removedMovies: { [String(mediaId)]: 0 } }
          : { removedMovies: { [String(mediaId)]: Date.now() } },
      }).catch(() => {});
    } else {
      pushServerUserSyncState({
        library: {
          ...(isCompleted
            ? { manuallyWatchedShows: [Number(mediaId)], removedShows: { [String(mediaId)]: 0 } }
            : { removedShows: { [String(mediaId)]: Date.now() } }),
          watchedEpisodes: { [String(mediaId)]: safeEps },
        },
      }).catch(() => {});
    }
  }

  if (!canPerformClientFirestoreWrite()) {
    return;
  }

  try {
    costMetrics.sessionReads += 1;
    const existing = await getDoc(ref);
    costMetrics.sessionWrites += 1;
    if (existing.exists()) {
      await updateDoc(ref, {
        isCompleted: Boolean(isCompleted),
        watchedEpisodes: safeEps,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid,
        mediaKey,
        mediaId: Number(mediaId),
        mediaType,
        isCompleted: Boolean(isCompleted),
        watchedEpisodes: safeEps,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (!skipTimestampBump) {
      await bumpUserLibrarySyncTimestamp(uid);
    }
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      markWriteQuotaExhausted();
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function mergeLocalLibraryIntoFirestore(
  uid: string,
  localWatchlist: MediaItem[],
  localWatchedMovies: number[],
  localWatchedEpisodes: Record<number, number[]>,
  localManuallyWatchedShows: number[]
): Promise<{
  watchlist: MediaItem[];
  watchedMovies: number[];
  manuallyWatchedShows: number[];
  watchedEpisodes: Record<number, number[]>;
}> {
  // 1. Fetch existing cloud state across all 3 cloud layers in parallel:
  //    - Atomic 1-Doc Firestore /userLibraryVault/{uid}
  //    - Firestore /users/{uid}/watchlist & /progress subcollections
  //    - Express Server Sync Vault (/api/user-sync/state)
  const [existingCloud, serverState, vaultState] = await Promise.all([
    fetchLibrarySubcollectionsOnce(uid),
    fetchServerUserSyncState().catch(() => null),
    fetchUserLibraryVaultFirestore(uid).catch(() => null),
  ]);

  // 2. Union-merge local device items with existing cloud items (respecting tombstones)
  const combined = combineLibrarySnapshots(
    existingCloud,
    serverState?.library || null,
    {
      watchlist: localWatchlist,
      watchedMovies: localWatchedMovies,
      manuallyWatchedShows: localManuallyWatchedShows,
      watchedEpisodes: localWatchedEpisodes,
    },
    vaultState
  );

  // 3. Push the unified library atomically to BOTH /userLibraryVault/{uid} and /api/user-sync/state
  await syncFullLibrarySnapshotToCloud(uid, combined);

  // 4. Batch-write any missing items to Firestore subcollections using writeBatch (max 500 ops)
  if (!isWriteQuotaExhausted() && canPerformClientFirestoreWrite()) {
    try {
      const existingCloudWlKeys = new Set(
        existingCloud.watchlist.map((i) => toFirestoreMediaKey(i.id, resolveMediaType(i)))
      );
      const existingCloudMovies = new Set(existingCloud.watchedMovies);
      const existingCloudShows = new Set(existingCloud.manuallyWatchedShows);

      const batch = writeBatch(db);
      let opCount = 0;

      for (const item of combined.watchlist.slice(0, 120)) {
        if (opCount >= 450) break;
        const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
        const mediaKey = toFirestoreMediaKey(item.id, mType);
        if (!existingCloudWlKeys.has(mediaKey)) {
          const ref = doc(db, 'users', uid, 'watchlist', mediaKey);
          batch.set(ref, {
            uid,
            mediaKey,
            mediaId: Number(item.id),
            mediaType: mType,
            title: (item.title || item.name || 'Untitled').slice(0, 300),
            posterPath: (item.poster_path || '').slice(0, 300),
            backdropPath: (item.backdrop_path || '').slice(0, 300),
            releaseDate: (item.release_date || item.first_air_date || '').slice(0, 30),
            voteAverage: Math.min(10, Math.max(0, Number(item.vote_average || 0))),
            overview: (item.overview || '').slice(0, 2000),
            addedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          opCount += 1;
        }
      }

      for (const movieId of combined.watchedMovies.slice(0, 150)) {
        if (opCount >= 450) break;
        if (!existingCloudMovies.has(movieId)) {
          const mediaKey = toFirestoreMediaKey(movieId, 'movie');
          const ref = doc(db, 'users', uid, 'progress', mediaKey);
          batch.set(ref, {
            uid,
            mediaKey,
            mediaId: Number(movieId),
            mediaType: 'movie',
            isCompleted: true,
            watchedEpisodes: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          opCount += 1;
        }
      }

      const allTvIds = new Set<number>([
        ...combined.manuallyWatchedShows,
        ...Object.keys(combined.watchedEpisodes).map(Number),
      ]);

      for (const tvId of Array.from(allTvIds).slice(0, 120)) {
        if (opCount >= 450) break;
        if (!tvId || tvId <= 0) continue;
        const isCompleted = combined.manuallyWatchedShows.includes(tvId);
        const eps = (combined.watchedEpisodes[tvId] || [])
          .filter((n) => typeof n === 'number' && Number.isFinite(n))
          .slice(0, 500);
        const prevEps = existingCloud.watchedEpisodes[tvId] || [];
        if ((isCompleted && !existingCloudShows.has(tvId)) || eps.length !== prevEps.length) {
          const mediaKey = toFirestoreMediaKey(tvId, 'tv');
          const ref = doc(db, 'users', uid, 'progress', mediaKey);
          batch.set(ref, {
            uid,
            mediaKey,
            mediaId: Number(tvId),
            mediaType: 'tv',
            isCompleted: Boolean(isCompleted),
            watchedEpisodes: eps,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          opCount += 1;
        }
      }

      if (opCount > 0) {
        costMetrics.sessionWrites += opCount;
        await batch.commit();
        await bumpUserLibrarySyncTimestamp(uid);
      }
    } catch (error) {
      if (isFirestoreQuotaError(error)) {
        markWriteQuotaExhausted();
      }
    }
  }

  return {
    watchlist: combined.watchlist,
    watchedMovies: combined.watchedMovies,
    manuallyWatchedShows: combined.manuallyWatchedShows,
    watchedEpisodes: combined.watchedEpisodes,
  };
}
