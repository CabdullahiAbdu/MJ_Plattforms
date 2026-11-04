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
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
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

export function isWriteQuotaExhausted(): boolean {
  return Date.now() < writeQuotaCooldownUntil;
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

// Complete any pending OAuth redirect flow
if (typeof window !== 'undefined') {
  getRedirectResult(auth).catch(() => {});
}

// --- Multi-Provider Authentication with Clean Popup & Redirect Fallback ---

export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err: unknown) {
    const code = String((err as { code?: string })?.code || '');
    if (
      code.includes('auth/popup-blocked') ||
      code.includes('auth/operation-not-supported-in-this-environment')
    ) {
      if (!isCapacitorNative) {
        await signInWithRedirect(auth, googleProvider);
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
    watchedMovies?: number[];
    manuallyWatchedShows?: number[];
    watchedEpisodes?: Record<number, number[]>;
    updatedAt?: string;
  };
} | null> {
  if (isCapacitorNative || !auth.currentUser) return null;
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
  if (isCapacitorNative || !auth.currentUser) return;
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
  if (isWriteQuotaExhausted()) return;

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
  if (isWriteQuotaExhausted()) return nextTs;

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
  } | null
): SyncedLibrarySnapshot {
  const removedWatchlistKeys: Record<string, number> = {
    ...(serverLib?.removedWatchlistKeys || {}),
  };
  const removedMovies: Record<string, number> = {
    ...(serverLib?.removedMovies || {}),
  };
  const removedShows: Record<string, number> = {
    ...(serverLib?.removedShows || {}),
  };

  const wlMap = new Map<string, MediaItem>();
  const addItems = (list: MediaItem[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || !item.id || item.id <= 0) continue;
      const mType: 'movie' | 'tv' = resolveMediaType(item) === 'tv' ? 'tv' : 'movie';
      const key = toFirestoreMediaKey(item.id, mType);
      if (removedWatchlistKeys[key]) continue;
      if (!wlMap.has(key)) {
        wlMap.set(key, { ...item, media_type: mType });
      }
    }
  };

  // Priority order: Firestore -> Server Sync Vault -> Local unmerged items
  addItems(firestoreSnap.watchlist);
  addItems(serverLib?.watchlist);
  addItems(localLib?.watchlist);

  const movieSet = new Set<number>();
  for (const id of [
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

  let firestoreData = {
    watchlist: [] as MediaItem[],
    watchedMovies: [] as number[],
    manuallyWatchedShows: [] as number[],
    watchedEpisodes: {} as Record<number, number[]>,
  };

  try {
    const watchlistQ = query(collection(db, 'users', uid, 'watchlist'), where('uid', '==', uid));
    const progressQ = query(collection(db, 'users', uid, 'progress'), where('uid', '==', uid));

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

  const serverState = await serverPromise;
  const combined = combineLibrarySnapshots(firestoreData, serverState?.library || null, null);
  return {
    watchlist: combined.watchlist,
    watchedMovies: combined.watchedMovies,
    manuallyWatchedShows: combined.manuallyWatchedShows,
    watchedEpisodes: combined.watchedEpisodes,
  };
}

/**
 * Real-Time Account Library Subscription (Firestore onSnapshot + Server Sync Vault)
 * Keeps 2, 3, or any number of devices logged into the same account UID in sync in real time.
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
      latestServerLib
    );
    const payload = {
      watchlist: merged.watchlist,
      watchedMovies: merged.watchedMovies,
      manuallyWatchedShows: merged.manuallyWatchedShows,
      watchedEpisodes: merged.watchedEpisodes,
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

  const pullServerVault = async () => {
    const s = await fetchServerUserSyncState();
    if (!active || !s?.library) return;
    latestServerLib = s.library;
    emitCombined();
  };

  pullServerVault();

  const watchlistQ = query(collection(db, 'users', uid, 'watchlist'), where('uid', '==', uid));
  const progressQ = query(collection(db, 'users', uid, 'progress'), where('uid', '==', uid));

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
      pullServerVault();
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
      pullServerVault();
    }
  );

  // Periodic & focus-triggered server vault sync so multi-device changes propagate even if Firestore write quota is paused
  const pollTimer =
    typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            pullServerVault();
          }
        }, 10000)
      : null;

  const onFocus = () => pullServerVault();
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus);
  }

  return () => {
    active = false;
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
        watchlist: [{ ...item, media_type: mType, _addedAtMs: Date.now() }],
      },
    }).catch(() => {});
  }

  if (isWriteQuotaExhausted()) {
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

  if (isWriteQuotaExhausted()) {
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

  if (isWriteQuotaExhausted()) {
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
  // 1. Fetch existing cloud state (Firestore + Server Sync Vault)
  const existingCloud = await fetchLibrarySubcollectionsOnce(uid);
  const serverState = await fetchServerUserSyncState();

  // 2. Union-merge local device items with existing cloud items (respecting tombstones)
  const combined = combineLibrarySnapshots(existingCloud, serverState?.library || null, {
    watchlist: localWatchlist,
    watchedMovies: localWatchedMovies,
    manuallyWatchedShows: localManuallyWatchedShows,
    watchedEpisodes: localWatchedEpisodes,
  });

  // 3. Push the unified library to Server Sync Vault
  await pushServerUserSyncState({
    library: {
      watchlist: combined.watchlist.slice(0, 500),
      removedWatchlistKeys: combined.removedWatchlistKeys,
      watchedMovies: combined.watchedMovies.slice(0, 500),
      removedMovies: combined.removedMovies,
      watchedEpisodes: combined.watchedEpisodes,
      manuallyWatchedShows: combined.manuallyWatchedShows.slice(0, 500),
      removedShows: combined.removedShows,
      updatedAt: new Date().toISOString(),
    },
  });

  // 4. Write only missing local items to Firestore subcollections so we don't waste writes
  if (!isWriteQuotaExhausted()) {
    const existingCloudWlKeys = new Set(
      existingCloud.watchlist.map((i) => toFirestoreMediaKey(i.id, resolveMediaType(i)))
    );
    const existingCloudMovies = new Set(existingCloud.watchedMovies);
    const existingCloudShows = new Set(existingCloud.manuallyWatchedShows);

    let wroteAny = false;

    for (const item of combined.watchlist.slice(0, 120)) {
      if (isWriteQuotaExhausted()) break;
      const k = toFirestoreMediaKey(item.id, resolveMediaType(item));
      if (!existingCloudWlKeys.has(k)) {
        await saveWatchlistItemFirestore(uid, item, true);
        wroteAny = true;
      }
    }

    for (const movieId of combined.watchedMovies.slice(0, 150)) {
      if (isWriteQuotaExhausted()) break;
      if (!existingCloudMovies.has(movieId)) {
        await saveWatchProgressFirestore(uid, movieId, 'movie', true, [], true);
        wroteAny = true;
      }
    }

    const allTvIds = new Set<number>([
      ...combined.manuallyWatchedShows,
      ...Object.keys(combined.watchedEpisodes).map(Number),
    ]);

    for (const tvId of Array.from(allTvIds).slice(0, 120)) {
      if (isWriteQuotaExhausted()) break;
      if (!tvId || tvId <= 0) continue;
      const isCompleted = combined.manuallyWatchedShows.includes(tvId);
      const eps = combined.watchedEpisodes[tvId] || [];
      const prevEps = existingCloud.watchedEpisodes[tvId] || [];
      if (
        (isCompleted && !existingCloudShows.has(tvId)) ||
        eps.length !== prevEps.length
      ) {
        await saveWatchProgressFirestore(uid, tvId, 'tv', isCompleted, eps, true);
        wroteAny = true;
      }
    }

    if (wroteAny && !isWriteQuotaExhausted()) {
      await bumpUserLibrarySyncTimestamp(uid);
    }
  }

  return {
    watchlist: combined.watchlist,
    watchedMovies: combined.watchedMovies,
    manuallyWatchedShows: combined.manuallyWatchedShows,
    watchedEpisodes: combined.watchedEpisodes,
  };
}
