import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { TmdbService, resolveApiBaseUrl, isNativePlatform } from '../services/tmdb';
import {
  auth,
  db,
  signInWithGoogle,
  signInWithApple,
  signInWithEmail,
  registerWithEmail,
  resetPasswordForEmail,
  signOutUser,
  ensureAndSyncUserProfile,
  updateUserProfilePrefsFirestore,
  handleFirestoreError,
  OperationType,
  isWriteQuotaExhausted,
  isFirestoreQuotaError,
  markWriteQuotaExhausted,
} from '../services/firebase';
import {
  initPerformanceMonitor,
  syncHardwareTierAttributes,
} from '../services/performanceMonitor';

export const STORAGE_KEYS = {
  API: 'tmdb_key_v2',
  KINOCHECK: 'kinocheck_key_v1',
  LANGUAGE: 'tmdb_language_v1',
  REGION: 'tmdb_region_v1',
  THEME: 'tmdb_theme_v1',
  ONBOARDING_COMPLETE: 'tmdb_onboarding_v4',
  AUTH_PROMPT_SEEN: 'tmdb_auth_prompt_seen_v4',
  USER_GENRES: 'tmdb_user_genres_v1',
  USER_PROVIDERS: 'tmdb_user_providers_v1',
  INCLUDE_ADULT: 'tmdb_include_adult_v1',
  AUTOPLAY: 'tmdb_autoplay_v1',
  DATA_SAVER: 'tmdb_data_saver_v1',
  TV_MODE: 'tmdb_tv_mode_v1',
} as const;

export type TvModePreference = 'auto' | 'on' | 'off';

export function detectSmartTvEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tv') === '1' || params.get('mode') === 'tv') {
      return true;
    }
    const ua = navigator.userAgent || '';
    return /VIDAA|Hisense|SmartTV|SMART-TV|HbbTV|NetCast|Web0S|WebOS|Tizen|Viera|BRAVIA|AFT|GoogleTV|Android TV|AppleTV|Roku|PlayStation|Xbox|Large Screen|VEWD|Odin/i.test(
      ua
    );
  } catch {
    return false;
  }
}

export interface ServerCacheStats {
  l1Entries: number;
  activeRegions: string[];
  hits: number;
  misses: number;
  coalescedHits: number;
}

interface ConfigContextValue {
  apiKey: string;
  setApiKey: (val: string) => void;
  kinoCheckKey: string;
  setKinoCheckKey: (val: string) => void;
  language: string;
  setLanguage: (val: string) => void;
  region: string;
  setRegion: (val: string) => void;
  theme: string;
  setTheme: (val: string) => void;
  includeAdult: boolean;
  setIncludeAdult: (val: boolean) => void;
  autoplay: boolean;
  setAutoplay: (val: boolean) => void;
  dataSaver: boolean;
  setDataSaver: (val: boolean) => void;
  tvMode: TvModePreference;
  setTvMode: (val: TvModePreference) => void;
  isTvMode: boolean;
  onboardingComplete: boolean;
  setOnboardingComplete: (val: boolean) => void;
  userGenres: number[];
  setUserGenres: (val: number[]) => void;
  userProviders: number[];
  setUserProviders: (val: number[]) => void;
  tmdb: TmdbService;
  // Intro & Onboarding Flow Control
  showIntro: boolean;
  completeIntro: () => void;
  replayIntro: () => void;
  authPromptSeen: boolean;
  setAuthPromptSeen: (val: boolean) => void;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  triggerFullTestFlow: () => void;
  // Firebase Auth & Cloud Sync State
  currentUser: User | null;
  isAuthReady: boolean;
  isCloudSynced: boolean;
  remoteLibraryUpdatedAt: string;
  loginWithGoogle: () => Promise<User | null>;
  loginWithApple: () => Promise<User | null>;
  loginWithEmail: (email: string, password: string) => Promise<User>;
  registerUserWithEmail: (email: string, password: string, displayName: string) => Promise<User>;
  sendResetPasswordEmail: (email: string) => Promise<void>;
  logoutUser: () => Promise<void>;
  serverCacheStats: ServerCacheStats | null;
  refreshServerStats: () => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiKey, setApiKey] = useLocalStorage<string>(STORAGE_KEYS.API, 'SERVER_PROXY');
  const [kinoCheckKey, setKinoCheckKey] = useLocalStorage<string>(STORAGE_KEYS.KINOCHECK, '');
  const [language, setLanguageState] = useLocalStorage<string>(STORAGE_KEYS.LANGUAGE, 'de-DE');
  const [region, setRegionState] = useLocalStorage<string>(STORAGE_KEYS.REGION, 'DE');
  const [theme, setThemeState] = useLocalStorage<string>(STORAGE_KEYS.THEME, 'indigo');
  const [includeAdult, setIncludeAdultState] = useLocalStorage<boolean>(
    STORAGE_KEYS.INCLUDE_ADULT,
    false
  );
  const [autoplay, setAutoplayState] = useLocalStorage<boolean>(STORAGE_KEYS.AUTOPLAY, true);
  const [dataSaver, setDataSaverState] = useLocalStorage<boolean>(STORAGE_KEYS.DATA_SAVER, false);
  const [tvMode, setTvMode] = useLocalStorage<TvModePreference>(STORAGE_KEYS.TV_MODE, 'auto');
  const [autoDetectedTv, setAutoDetectedTv] = useState<boolean>(() => detectSmartTvEnvironment());

  const isTvMode = tvMode === 'on' || (tvMode === 'auto' && autoDetectedTv);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-tv-mode', isTvMode ? 'true' : 'false');
    }
    initPerformanceMonitor(dataSaver);
    syncHardwareTierAttributes(dataSaver);
  }, [isTvMode, dataSaver]);

  // Auto-enable TV mode when a VIDAA / Smart TV hardware remote key is pressed while in 'auto' mode
  useEffect(() => {
    if (typeof window === 'undefined' || tvMode !== 'auto' || autoDetectedTv) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.keyCode || e.which;
      if (
        code === 461 || // VIDAA / LG webOS Back
        code === 10009 || // Samsung Tizen Return
        (code >= 403 && code <= 406) // VIDAA Color keys (Red/Green/Yellow/Blue)
      ) {
        setAutoDetectedTv(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, { passive: true });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tvMode, autoDetectedTv]);

  const [onboardingComplete, setOnboardingCompleteState] = useLocalStorage<boolean>(
    STORAGE_KEYS.ONBOARDING_COMPLETE,
    false
  );
  const [authPromptSeen, setAuthPromptSeen] = useLocalStorage<boolean>(
    STORAGE_KEYS.AUTH_PROMPT_SEEN,
    false
  );
  const [userGenres, setUserGenresState] = useLocalStorage<number[]>(
    STORAGE_KEYS.USER_GENRES,
    []
  );
  const [userProviders, setUserProvidersState] = useLocalStorage<number[]>(
    STORAGE_KEYS.USER_PROVIDERS,
    []
  );

  function hasExistingSetup(flag: boolean): boolean {
    return Boolean(flag);
  }

  // Phase 1: Instant startup < 2s. Render active view immediately on frame 1;
  // only play Cinema Intro Opener once per session and after First Paint.
  const [showIntro, setShowIntro] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seenInSession = window.sessionStorage.getItem('mj_intro_shown_v1') === '1';
      if (!seenInSession) {
        window.requestAnimationFrame(() => {
          setShowIntro(true);
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isCloudSynced, setIsCloudSynced] = useState<boolean>(false);
  const [remoteLibraryUpdatedAt, setRemoteLibraryUpdatedAt] = useState<string>('');
  const [serverCacheStats] = useState<ServerCacheStats | null>(null);

  const profileReadyRef = useRef<boolean>(false);

  const completeIntro = useCallback(() => {
    setShowIntro(false);
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('mj_intro_shown_v1', '1');
      } catch {
        // ignore
      }
    }
  }, []);

  const replayIntro = useCallback(() => {
    setShowIntro(true);
  }, []);

  const openAuthModal = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
  }, []);

  const setOnboardingComplete = useCallback(
    (val: boolean) => {
      setOnboardingCompleteState(val);
      if (currentUser?.uid && typeof window !== 'undefined') {
        localStorage.setItem(`mj_onboarding_done_${currentUser.uid}`, val ? '1' : '0');
      }
    },
    [currentUser?.uid, setOnboardingCompleteState]
  );

  const triggerFullTestFlow = useCallback(() => {
    setOnboardingComplete(false);
  }, [setOnboardingComplete]);

  const refreshServerStats = useCallback(() => {
    // No-op in production consumer build
  }, []);

  // 1. Ensure Server Proxy mode
  useEffect(() => {
    if (apiKey !== 'SERVER_PROXY') {
      setApiKey('SERVER_PROXY');
    }
  }, [apiKey, setApiKey]);

  // 2. Active Region Heartbeat (only in web environment with Express proxy)
  useEffect(() => {
    if (isNativePlatform()) return;
    const heartbeatUrl = resolveApiBaseUrl('/api/regions/heartbeat');
    fetch(heartbeatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, language }),
    }).catch(() => {});
  }, [region, language]);

  // 3. Firebase Auth Listener + Profile Document Bootstrap & Realtime Sync
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);

      if (!user) {
        profileReadyRef.current = false;
        setIsCloudSynced(false);
        setRemoteLibraryUpdatedAt('');
        return;
      }

      setIsAuthModalOpen(false);
      setAuthPromptSeen(true);

      try {
        const mergedProfile = await ensureAndSyncUserProfile(user, {
          displayName: user.displayName || user.email?.split('@')[0] || 'Cinephile',
          photoURL: user.photoURL || '',
          region,
          language,
          theme,
          userProviders,
          userGenres,
          autoplay,
          dataSaver,
          includeAdult,
        });

        setRegionState(mergedProfile.region);
        setLanguageState(mergedProfile.language);
        setThemeState(mergedProfile.theme);
        setUserProvidersState(mergedProfile.userProviders);
        setUserGenresState(mergedProfile.userGenres);
        setAutoplayState(mergedProfile.autoplay);
        setDataSaverState(mergedProfile.dataSaver);
        setIncludeAdultState(mergedProfile.includeAdult);
        setRemoteLibraryUpdatedAt(mergedProfile.lastLibraryUpdatedAt || '');

        const uidOnboardingKey = `mj_onboarding_done_${user.uid}`;
        const localUidFlag =
          typeof window !== 'undefined' ? localStorage.getItem(uidOnboardingKey) : null;

        const hasExistingCloudSetup =
          !mergedProfile.isNewUser ||
          mergedProfile.userProviders.length > 0 ||
          mergedProfile.userGenres.length > 0;

        if (localUidFlag === '1' || (localUidFlag === null && hasExistingSetup(hasExistingCloudSetup))) {
          setOnboardingCompleteState(true);
          if (typeof window !== 'undefined') {
            localStorage.setItem(uidOnboardingKey, '1');
          }
        } else if (mergedProfile.isNewUser && localUidFlag !== '1') {
          setOnboardingCompleteState(false);
        }

        profileReadyRef.current = true;
        setIsCloudSynced(true);
      } catch (e) {
        console.error('Failed to initialize cloud user profile:', e);
      }
    });

    return () => unsubAuth();
  }, []);

  // 4. Realtime Listener on /users/{uid} (1 single lightweight document listener!)
  useEffect(() => {
    if (!currentUser || !isCloudSynced || isWriteQuotaExhausted()) return;
    const path = `users/${currentUser.uid}`;
    const userRef = doc(db, 'users', currentUser.uid);

    const unsubDoc = onSnapshot(
      userRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.region && data.region !== region) setRegionState(data.region);
        if (data.language && data.language !== language) setLanguageState(data.language);
        if (data.theme && data.theme !== theme) setThemeState(data.theme);
        if (Array.isArray(data.userProviders)) setUserProvidersState(data.userProviders);
        if (Array.isArray(data.userGenres)) setUserGenresState(data.userGenres);
        if (typeof data.autoplay === 'boolean') setAutoplayState(data.autoplay);
        if (typeof data.dataSaver === 'boolean') setDataSaverState(data.dataSaver);
        if (typeof data.includeAdult === 'boolean') setIncludeAdultState(data.includeAdult);
        if (typeof data.lastLibraryUpdatedAt === 'string') {
          setRemoteLibraryUpdatedAt(data.lastLibraryUpdatedAt);
        }
      },
      (error) => {
        if (isFirestoreQuotaError(error)) {
          markWriteQuotaExhausted();
          return;
        }
        handleFirestoreError(error, OperationType.GET, path);
      }
    );

    return () => unsubDoc();
  }, [currentUser?.uid, isCloudSynced]);

  const pushPrefsToCloud = useCallback(
    (overrides: Partial<{
      region: string;
      language: string;
      theme: string;
      userProviders: number[];
      userGenres: number[];
      autoplay: boolean;
      dataSaver: boolean;
      includeAdult: boolean;
    }>) => {
      if (!currentUser || !profileReadyRef.current) return;
      updateUserProfilePrefsFirestore(currentUser.uid, {
        displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Cinephile',
        photoURL: currentUser.photoURL || '',
        region: overrides.region ?? region,
        language: overrides.language ?? language,
        theme: overrides.theme ?? theme,
        userProviders: overrides.userProviders ?? userProviders,
        userGenres: overrides.userGenres ?? userGenres,
        autoplay: overrides.autoplay ?? autoplay,
        dataSaver: overrides.dataSaver ?? dataSaver,
        includeAdult: overrides.includeAdult ?? includeAdult,
        lastLibraryUpdatedAt: remoteLibraryUpdatedAt,
      }).catch((e) => console.error('Cloud preference update failed:', e));
    },
    [
      currentUser,
      region,
      language,
      theme,
      userProviders,
      userGenres,
      autoplay,
      dataSaver,
      includeAdult,
      remoteLibraryUpdatedAt,
    ]
  );

  const setLanguage = useCallback(
    (val: string) => {
      setLanguageState(val);
      pushPrefsToCloud({ language: val });
    },
    [setLanguageState, pushPrefsToCloud]
  );

  const setRegion = useCallback(
    (val: string) => {
      setRegionState(val);
      pushPrefsToCloud({ region: val });
    },
    [setRegionState, pushPrefsToCloud]
  );

  const setTheme = useCallback(
    (val: string) => {
      setThemeState(val);
      pushPrefsToCloud({ theme: val });
    },
    [setThemeState, pushPrefsToCloud]
  );

  const setIncludeAdult = useCallback(
    (val: boolean) => {
      setIncludeAdultState(val);
      pushPrefsToCloud({ includeAdult: val });
    },
    [setIncludeAdultState, pushPrefsToCloud]
  );

  const setAutoplay = useCallback(
    (val: boolean) => {
      setAutoplayState(val);
      pushPrefsToCloud({ autoplay: val });
    },
    [setAutoplayState, pushPrefsToCloud]
  );

  const setDataSaver = useCallback(
    (val: boolean) => {
      setDataSaverState(val);
      pushPrefsToCloud({ dataSaver: val });
    },
    [setDataSaverState, pushPrefsToCloud]
  );

  const setUserGenres = useCallback(
    (val: number[]) => {
      setUserGenresState(val);
      pushPrefsToCloud({ userGenres: val });
    },
    [setUserGenresState, pushPrefsToCloud]
  );

  const setUserProviders = useCallback(
    (val: number[]) => {
      setUserProvidersState(val);
      pushPrefsToCloud({ userProviders: val });
    },
    [setUserProvidersState, pushPrefsToCloud]
  );

  const loginWithGoogle = useCallback(async (): Promise<User | null> => {
    const user = await signInWithGoogle();
    return user;
  }, []);

  const loginWithApple = useCallback(async (): Promise<User | null> => {
    const user = await signInWithApple();
    return user;
  }, []);

  const loginWithEmail = useCallback(async (email: string, password: string): Promise<User> => {
    return await signInWithEmail(email, password);
  }, []);

  const registerUserWithEmail = useCallback(
    async (email: string, password: string, displayName: string): Promise<User> => {
      return await registerWithEmail(email, password, displayName);
    },
    []
  );

  const sendResetPasswordEmail = useCallback(async (email: string): Promise<void> => {
    await resetPasswordForEmail(email);
  }, []);

  const logoutUser = useCallback(async (): Promise<void> => {
    await signOutUser();
  }, []);

  const tmdb = useMemo(() => {
    return new TmdbService(apiKey || 'SERVER_PROXY', language, region, includeAdult, dataSaver);
  }, [apiKey, language, region, includeAdult, dataSaver]);

  const value = useMemo<ConfigContextValue>(
    () => ({
      apiKey,
      setApiKey,
      kinoCheckKey,
      setKinoCheckKey,
      language,
      setLanguage,
      region,
      setRegion,
      theme,
      setTheme,
      includeAdult,
      setIncludeAdult,
      autoplay,
      setAutoplay,
      dataSaver,
      setDataSaver,
      tvMode,
      setTvMode,
      isTvMode,
      onboardingComplete,
      setOnboardingComplete,
      userGenres,
      setUserGenres,
      userProviders,
      setUserProviders,
      tmdb,
      showIntro,
      completeIntro,
      replayIntro,
      authPromptSeen,
      setAuthPromptSeen,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      triggerFullTestFlow,
      currentUser,
      isAuthReady,
      isCloudSynced,
      remoteLibraryUpdatedAt,
      loginWithGoogle,
      loginWithApple,
      loginWithEmail,
      registerUserWithEmail,
      sendResetPasswordEmail,
      logoutUser,
      serverCacheStats,
      refreshServerStats,
    }),
    [
      apiKey,
      setApiKey,
      kinoCheckKey,
      setKinoCheckKey,
      language,
      setLanguage,
      region,
      setRegion,
      theme,
      setTheme,
      includeAdult,
      setIncludeAdult,
      autoplay,
      setAutoplay,
      dataSaver,
      setDataSaver,
      tvMode,
      setTvMode,
      isTvMode,
      onboardingComplete,
      setOnboardingComplete,
      userGenres,
      setUserGenres,
      userProviders,
      setUserProviders,
      tmdb,
      showIntro,
      completeIntro,
      replayIntro,
      authPromptSeen,
      setAuthPromptSeen,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      triggerFullTestFlow,
      currentUser,
      isAuthReady,
      isCloudSynced,
      remoteLibraryUpdatedAt,
      loginWithGoogle,
      loginWithApple,
      loginWithEmail,
      registerUserWithEmail,
      sendResetPasswordEmail,
      logoutUser,
      serverCacheStats,
      refreshServerStats,
    ]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within a ConfigProvider');
  return ctx;
}
