import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TmdbService } from '../services/tmdb';
import { WatchProvider } from '../types';
import {
  Globe,
  Trash2,
  Check,
  Palette,
  MapPin,
  Download,
  Upload,
  LogOut,
  ChevronRight,
  Tv,
  X,
  Search,
  User as UserIcon,
  Shield,
  Key,
  Copy,
  RefreshCw,
  Plus,
} from '../components/Icons';
import { SafeImage } from '../components/SafeImage';
import {
  User,
  getTwoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  TwoFactorSetupResponse,
  fetchTmdbKeyPoolStatus,
  addTmdbKeysToServerPool,
  removeTmdbKeyFromServerPool,
  ServerKeyPoolStatus,
  approveTvPairingSession,
} from '../services/firebase';
import { ServerCacheStats, TvModePreference } from '../context/ConfigContext';

interface SettingsViewProps {
  tmdb: TmdbService;
  currentLanguage: string;
  setLanguage: (lang: string) => void;
  currentRegion: string;
  setRegion: (reg: string) => void;
  onClearApiCache: () => void;
  onResetLibrary: () => void;
  onExportLibrary: () => string;
  onImportLibrary: (rawJson: string) => { ok: boolean; count: number; error?: string };
  onNotify: (msg: string, type?: 'success' | 'info') => void;
  currentTheme: string;
  setTheme: (theme: string) => void;
  userProviders: number[];
  setUserProviders: (providers: number[]) => void;
  autoplay: boolean;
  setAutoplay: (val: boolean) => void;
  dataSaver: boolean;
  setDataSaver: (val: boolean) => void;
  includeAdult: boolean;
  setIncludeAdult: (val: boolean) => void;
  tvMode: TvModePreference;
  setTvMode: (val: TvModePreference) => void;
  isTvMode: boolean;
  currentUser: User | null;
  isCloudSynced: boolean;
  openAuthModal: () => void;
  logoutUser: () => Promise<void>;
  replayIntro: () => void;
  triggerFullTestFlow: () => void;
  onReopenOnboarding: () => void;
  serverCacheStats: ServerCacheStats | null;
  refreshServerStats: () => void;
}

const LANGUAGES = [
  { code: 'de-DE', name: 'Deutsch', subtitle: 'Deutschland' },
  { code: 'en-US', name: 'English', subtitle: 'United States' },
  { code: 'en-GB', name: 'English', subtitle: 'United Kingdom' },
  { code: 'fr-FR', name: 'Français', subtitle: 'France' },
  { code: 'es-ES', name: 'Español', subtitle: 'España' },
  { code: 'it-IT', name: 'Italiano', subtitle: 'Italia' },
  { code: 'ja-JP', name: '日本語', subtitle: '日本' },
];

const REGIONS = [
  { code: 'DE', nameDe: 'Deutschland', nameEn: 'Germany', flag: '🇩🇪' },
  { code: 'AT', nameDe: 'Österreich', nameEn: 'Austria', flag: '🇦🇹' },
  { code: 'CH', nameDe: 'Schweiz', nameEn: 'Switzerland', flag: '🇨🇭' },
  { code: 'US', nameDe: 'Vereinigte Staaten', nameEn: 'United States', flag: '🇺🇸' },
  { code: 'GB', nameDe: 'Großbritannien', nameEn: 'United Kingdom', flag: '🇬🇧' },
  { code: 'FR', nameDe: 'Frankreich', nameEn: 'France', flag: '🇫🇷' },
  { code: 'ES', nameDe: 'Spanien', nameEn: 'Spain', flag: '🇪🇸' },
  { code: 'IT', nameDe: 'Italien', nameEn: 'Italy', flag: '🇮🇹' },
  { code: 'JP', nameDe: 'Japan', nameEn: 'Japan', flag: '🇯🇵' },
];

const THEMES = [
  { id: 'indigo', nameDe: 'Indigo', nameEn: 'Indigo', swatch: '#6366f1' },
  { id: 'crimson', nameDe: 'Karmesin', nameEn: 'Crimson', swatch: '#e11d48' },
  { id: 'gold', nameDe: 'Gold', nameEn: 'Gold', swatch: '#f59e0b' },
  { id: 'emerald', nameDe: 'Smaragd', nameEn: 'Emerald', swatch: '#10b981' },
  { id: 'violet', nameDe: 'Violett', nameEn: 'Violet', swatch: '#8b5cf6' },
];

const FALLBACK_PROVIDERS: WatchProvider[] = [
  { provider_id: 8, provider_name: 'Netflix', logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg', display_priority: 1 },
  { provider_id: 9, provider_name: 'Amazon Prime Video', logo_path: '/pvske1MyAoymrs5bguRfVqYiM9a.jpg', display_priority: 2 },
  { provider_id: 337, provider_name: 'Disney Plus', logo_path: '/97yvRBw1GzX7fXprcF80er19ot.jpg', display_priority: 3 },
  { provider_id: 350, provider_name: 'Apple TV+', logo_path: '/2E03IAZsX4ZaUqM7tXlctEPMGWS.jpg', display_priority: 4 },
  { provider_id: 30, provider_name: 'WOW', logo_path: '/d9c78F6p4E63V7X3kR1C3wP8b5W.jpg', display_priority: 5 },
  { provider_id: 531, provider_name: 'Paramount+', logo_path: '/h5DcR0J2EESLitnhR8xLG1QymTE.jpg', display_priority: 6 },
  { provider_id: 283, provider_name: 'Crunchyroll', logo_path: '/mXeC4TrcgdU6ltE9bCBCEORwSQR.jpg', display_priority: 7 },
  { provider_id: 298, provider_name: 'RTL+', logo_path: '/3hI22hp7YDZXyrmXVqDGnVivNTI.jpg', display_priority: 8 },
  { provider_id: 304, provider_name: 'Joyn', logo_path: '/tJqmTmQ8jp9WfyaZfApHK8lSywA.jpg', display_priority: 9 },
  { provider_id: 11, provider_name: 'MUBI', logo_path: '/fj9Y8iIMFUC6952HwxbGixTQPb7.jpg', display_priority: 10 },
];

type SheetType = 'providers' | 'region' | 'language' | 'twoFactor' | 'keyPool' | 'tvPairing' | null;

export const SettingsView: React.FC<SettingsViewProps> = ({
  tmdb,
  currentLanguage,
  setLanguage,
  currentRegion,
  setRegion,
  onResetLibrary,
  onExportLibrary,
  onImportLibrary,
  onNotify,
  currentTheme,
  setTheme,
  userProviders,
  setUserProviders,
  tvMode,
  setTvMode,
  isTvMode,
  currentUser,
  isCloudSynced,
  openAuthModal,
  logoutUser,
}) => {
  const [activeSheet, setActiveSheet] = useState<SheetType>(null);
  const [availableProviders, setAvailableProviders] = useState<WatchProvider[]>(FALLBACK_PROVIDERS);
  const [providerSearch, setProviderSearch] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Two-Factor Auth (2FA) State
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean>(false);
  const [remainingBackupCodes, setRemainingBackupCodes] = useState<number>(0);
  const [twoFactorSetupData, setTwoFactorSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [twoFactorCodeInput, setTwoFactorCodeInput] = useState<string>('');
  const [twoFactorBusy, setTwoFactorBusy] = useState<boolean>(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  // Multi-Key TMDB Failover Pool State
  const [keyPoolStatus, setKeyPoolStatus] = useState<ServerKeyPoolStatus | null>(null);
  const [newKeysInput, setNewKeysInput] = useState<string>('');
  const [keyPoolBusy, setKeyPoolBusy] = useState<boolean>(false);
  const [keyPoolError, setKeyPoolError] = useState<string | null>(null);

  // Smart TV 6-Digit Pairing State (for linking TV from iPhone)
  const [tvCodeInput, setTvCodeInput] = useState<string>('');
  const [tvApproveBusy, setTvApproveBusy] = useState<boolean>(false);
  const [tvApproveError, setTvApproveError] = useState<string | null>(null);

  const isDe = currentLanguage.toLowerCase().startsWith('de');

  // Close active settings sheet on TV Remote Back button
  useEffect(() => {
    if (!activeSheet) return;
    const onTvBack = (e: Event) => {
      e.preventDefault();
      setActiveSheet(null);
    };
    window.addEventListener('mj:tv-back', onTvBack);
    return () => window.removeEventListener('mj:tv-back', onTvBack);
  }, [activeSheet]);

  const handleApproveTvByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = tvCodeInput.replace(/[^0-9]/g, '').trim();
    if (clean.length !== 6) {
      setTvApproveError(
        isDe
          ? 'Bitte gib den 6-stelligen TV-Code ein.'
          : 'Please enter the 6-digit TV pairing code.'
      );
      return;
    }
    setTvApproveError(null);
    setTvApproveBusy(true);
    try {
      await approveTvPairingSession(clean);
      setTvCodeInput('');
      setActiveSheet(null);
      onNotify(
        isDe
          ? 'Smart TV erfolgreich mit deinem Konto angemeldet!'
          : 'Smart TV successfully signed in to your account!',
        'success'
      );
    } catch (err: any) {
      setTvApproveError(
        err?.message ||
          (isDe ? 'Koppelung fehlgeschlagen.' : 'Failed to pair Smart TV.')
      );
    } finally {
      setTvApproveBusy(false);
    }
  };

  const refreshSecurityAndPoolInfo = useCallback(async () => {
    if (!currentUser) return;
    const [tfStatus, poolInfo] = await Promise.all([
      getTwoFactorStatus(currentUser),
      fetchTmdbKeyPoolStatus(),
    ]);
    setTwoFactorEnabled(tfStatus.twoFactorEnabled);
    setRemainingBackupCodes(tfStatus.remainingBackupCodes);
    if (poolInfo) {
      setKeyPoolStatus(poolInfo);
    }
  }, [currentUser]);

  useEffect(() => {
    refreshSecurityAndPoolInfo();
  }, [refreshSecurityAndPoolInfo]);

  useEffect(() => {
    let active = true;
    tmdb
      .getWatchProviderList('movie')
      .then((list) => {
        if (!active) return;
        if (Array.isArray(list) && list.length > 0) {
          const map = new Map<number, WatchProvider>();
          list.forEach((p) => {
            if (p && p.provider_id && p.logo_path) map.set(p.provider_id, p);
          });
          FALLBACK_PROVIDERS.forEach((fb) => {
            if (!map.has(fb.provider_id)) map.set(fb.provider_id, fb);
          });
          setAvailableProviders(
            Array.from(map.values())
              .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
              .slice(0, 32)
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tmdb, currentRegion, currentLanguage]);

  const toggleProvider = (id: number) => {
    if (userProviders.includes(id)) {
      setUserProviders(userProviders.filter((p) => p !== id));
    } else {
      setUserProviders([...userProviders, id]);
    }
  };

  const handleStartTwoFactorSetup = async () => {
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      const setup = await setupTwoFactor();
      setTwoFactorSetupData(setup);
      setTwoFactorCodeInput('');
    } catch (err: any) {
      setTwoFactorError(
        err?.message ||
          (isDe ? '2FA-Setup konnte nicht gestartet werden.' : 'Failed to start 2FA setup.')
      );
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleConfirmEnableTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFactorCodeInput.trim().length !== 6) {
      setTwoFactorError(
        isDe
          ? 'Bitte gib den 6-stelligen Code aus deiner Authenticator-App ein.'
          : 'Please enter the 6-digit code from your Authenticator app.'
      );
      return;
    }
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      await enableTwoFactor(twoFactorCodeInput);
      setTwoFactorEnabled(true);
      setRemainingBackupCodes(twoFactorSetupData?.backupCodes.length || 8);
      setTwoFactorSetupData(null);
      setTwoFactorCodeInput('');
      onNotify(
        isDe
          ? 'Zwei-Faktor-Authentifizierung aktiviert'
          : 'Two-Factor Authentication enabled',
        'success'
      );
    } catch (err: any) {
      setTwoFactorError(
        isDe
          ? 'Code ungültig. Bitte überprüfe die Uhrzeit deines Geräts und versuche es erneut.'
          : err?.message || 'Invalid verification code.'
      );
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleDisableTwoFactor = async () => {
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      await disableTwoFactor();
      setTwoFactorEnabled(false);
      setTwoFactorSetupData(null);
      setRemainingBackupCodes(0);
      onNotify(
        isDe ? 'Zwei-Faktor-Schutz deaktiviert' : 'Two-Factor Authentication disabled',
        'info'
      );
    } catch (err: any) {
      setTwoFactorError(err?.message || 'Error');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleAddKeysToPool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeysInput.trim()) return;
    setKeyPoolError(null);
    setKeyPoolBusy(true);
    try {
      const result = await addTmdbKeysToServerPool(newKeysInput);
      setNewKeysInput('');
      const updated = await fetchTmdbKeyPoolStatus();
      if (updated) setKeyPoolStatus(updated);
      onNotify(
        isDe
          ? `${result.addedCount} Schlüssel verschlüsselt in den Failover-Pool aufgenommen (${result.poolSize} aktiv)`
          : `Added ${result.addedCount} keys to encrypted failover pool (${result.poolSize} active)`,
        'success'
      );
    } catch (err: any) {
      setKeyPoolError(
        err?.message ||
          (isDe ? 'Schlüssel konnten nicht hinzugefügt werden.' : 'Failed to add keys.')
      );
    } finally {
      setKeyPoolBusy(false);
    }
  };

  const handleRemoveKeyFromPool = async (keyId: string) => {
    setKeyPoolError(null);
    setKeyPoolBusy(true);
    try {
      await removeTmdbKeyFromServerPool(keyId);
      const updated = await fetchTmdbKeyPoolStatus();
      if (updated) setKeyPoolStatus(updated);
      onNotify(isDe ? 'Schlüssel aus Pool entfernt' : 'Key removed from pool', 'info');
    } catch (err: any) {
      setKeyPoolError(err?.message || 'Failed to remove key');
    } finally {
      setKeyPoolBusy(false);
    }
  };

  const handleExportDownload = () => {
    try {
      const jsonStr = onExportLibrary();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `moviejournal-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify(
        isDe ? 'Backup erfolgreich gespeichert' : 'Backup exported successfully',
        'success'
      );
    } catch {
      onNotify(isDe ? 'Backup fehlgeschlagen' : 'Backup export failed', 'info');
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const res = onImportLibrary(content);
      if (res.ok) {
        onNotify(
          isDe
            ? `Backup wiederhergestellt (${res.count} Einträge)`
            : `Restored backup (${res.count} items)`,
          'success'
        );
      } else {
        onNotify(
          res.error || (isDe ? 'Ungültige Backup-Datei' : 'Invalid backup file'),
          'info'
        );
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const currentLangObj = LANGUAGES.find((l) => l.code === currentLanguage);
  const currentLangLabel = currentLangObj ? currentLangObj.name : currentLanguage;

  const currentRegionObj = REGIONS.find((r) => r.code === currentRegion);
  const currentRegionLabel = currentRegionObj
    ? `${currentRegionObj.flag} ${isDe ? currentRegionObj.nameDe : currentRegionObj.nameEn}`
    : currentRegion;

  const activeProviderObjects = availableProviders.filter((p) =>
    userProviders.includes(p.provider_id)
  );

  const filteredProviders = availableProviders.filter((p) =>
    p.provider_name.toLowerCase().includes(providerSearch.trim().toLowerCase())
  );

  return (
    <div
      style={{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
      }}
      className="min-h-screen bg-transparent sm:pt-10 pb-36 px-[var(--fluid-page-px)] max-w-2xl mx-auto animate-fade-in select-none"
    >
      {/* Native Large Title Header */}
      <div className="mb-6">
        <h1 className="text-[clamp(1.75rem,5vw,2.5rem)] font-bold tracking-tight text-white leading-tight">
          {isDe ? 'Einstellungen' : 'Settings'}
        </h1>
      </div>

      <div className="space-y-8">
        {/* 1. ACCOUNT PROFILE ROW */}
        <section className="pb-6 border-b border-white/[0.08]">
          <div className="flex items-center justify-between gap-3.5">
            <div className="flex items-center gap-3.5 min-w-0">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'Profil'}
                  className="w-14 h-14 rounded-full object-cover border border-white/15 shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-white/[0.08] text-white flex items-center justify-center font-bold text-xl shrink-0">
                  {(
                    currentUser?.displayName ||
                    currentUser?.email ||
                    'M'
                  )
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[clamp(1.05rem,2.5vw,1.15rem)] font-semibold text-white truncate">
                    {currentUser?.displayName ||
                      currentUser?.email?.split('@')[0] ||
                      (isDe ? 'Gast-Profil' : 'Guest Profile')}
                  </h2>
                </div>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {currentUser?.email ||
                    (isDe
                      ? 'Cloud-Sync & persönliche Mediathek'
                      : 'Cloud Sync & Personal Library')}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[11px] font-medium text-zinc-400">
                  {isCloudSynced && (
                    <span className="text-emerald-400">
                      {isDe ? 'Cloud Synchronisiert' : 'Cloud Synced'}
                    </span>
                  )}
                  {twoFactorEnabled && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-400">2FA Aktiv</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {currentUser ? (
              <button
                type="button"
                onClick={async () => {
                  await logoutUser();
                  onNotify(isDe ? 'Abgemeldet' : 'Signed out', 'info');
                }}
                className="px-3.5 py-2 rounded-full bg-white/[0.07] hover:bg-red-500/20 text-zinc-300 hover:text-red-300 text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5 active:scale-95"
              >
                <LogOut size={14} />
                <span>{isDe ? 'Abmelden' : 'Sign Out'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={openAuthModal}
                className="px-4 py-2 rounded-full bg-white text-black text-xs font-bold transition-transform shrink-0 flex items-center gap-1.5 active:scale-95"
              >
                <UserIcon size={14} />
                <span>{isDe ? 'Anmelden' : 'Sign In'}</span>
              </button>
            )}
          </div>

          {currentUser && (
            <div className="mt-5 divide-y divide-white/[0.08] border-y border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('mj:force-library-sync'));
                  onNotify(
                    isDe
                      ? 'Watchlist & Fortschritt werden über alle Geräte synchronisiert…'
                      : 'Syncing Watchlist & progress across all devices…',
                    'success'
                  );
                }}
                className="w-full py-3.5 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <RefreshCw size={18} className="text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                      {isDe
                        ? 'Konto-Watchlist jetzt synchronisieren'
                        : 'Sync Account Watchlist Now'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {isDe
                        ? 'Echtzeit-Abgleich für alle angemeldeten Geräte (E-Mail & Google)'
                        : 'Real-time sync across all signed-in devices'}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-zinc-400 font-medium shrink-0">
                  {isDe ? 'Abgleichen' : 'Sync'}
                </span>
              </button>

              <a
                href="https://console.firebase.google.com/project/gen-lang-client-0463426822/usage/details"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Globe size={18} className="text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                      {isDe
                        ? 'Firebase Blaze-Plan & Cloud-Guthaben'
                        : 'Firebase Blaze Plan & Cloud Billing'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {isDe
                        ? 'Tageslimit aufheben & Google Cloud Testguthaben verknüpfen'
                        : 'Lift daily free quota & link Google Cloud trial credit'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 shrink-0">
                  <span>Blaze</span>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </a>
            </div>
          )}
        </section>

        {/* 2. SICHERHEIT & SERVER KEY-POOL (2FA + 5-10 Key Failover Pool) */}
        {currentUser && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              {isDe ? 'Sicherheit & Hochverfügbarkeit' : 'Security & High Availability'}
            </h3>

            <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
              {/* Row 1: Zwei-Faktor-Authentifizierung (2FA) */}
              <button
                type="button"
                onClick={() => {
                  setTwoFactorError(null);
                  setTwoFactorSetupData(null);
                  setActiveSheet('twoFactor');
                  refreshSecurityAndPoolInfo();
                }}
                className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Shield size={18} className="text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                      {isDe
                        ? 'Zwei-Faktor-Authentifizierung (2FA)'
                        : 'Two-Factor Authentication (2FA)'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {isDe
                        ? 'Optional für Apple, Google & E-Mail-Login'
                        : 'Optional for Apple, Google & Email sign-in'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[clamp(0.85rem,2vw,0.925rem)] font-medium ${
                      twoFactorEnabled ? 'text-emerald-400' : 'text-zinc-400'
                    }`}
                  >
                    {twoFactorEnabled
                      ? isDe
                        ? 'Aktiv'
                        : 'Enabled'
                      : isDe
                      ? 'Aus'
                      : 'Off'}
                  </span>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              {/* Row 2: TMDB Multi-Key Failover Pool (5-10 Keys + 1,000-User Cache) */}
              <button
                type="button"
                onClick={() => {
                  setKeyPoolError(null);
                  setActiveSheet('keyPool');
                  refreshSecurityAndPoolInfo();
                }}
                className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Key size={18} className="text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                      {isDe
                        ? 'TMDB Multi-Key Failover-Pool'
                        : 'TMDB Multi-Key Failover Pool'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {isDe
                        ? 'Automatische Rotation & 1.000-User-Cache'
                        : 'Automatic key rotation & 1,000-user cache'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[clamp(0.85rem,2vw,0.925rem)] text-zinc-400 tabular-nums">
                    {keyPoolStatus
                      ? isDe
                        ? `${keyPoolStatus.healthyCount}/${keyPoolStatus.poolSize} Keys`
                        : `${keyPoolStatus.healthyCount}/${keyPoolStatus.poolSize} keys`
                      : isDe
                      ? 'Verwalten'
                      : 'Manage'}
                  </span>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>
            </div>
          </section>
        )}

        {/* 3. STREAMING & KATALOG */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {isDe ? 'Streaming & Katalog' : 'Streaming & Catalogue'}
          </h3>

          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {/* Row 1: Meine Streaming-Dienste */}
            <button
              type="button"
              onClick={() => {
                setProviderSearch('');
                setActiveSheet('providers');
              }}
              className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Tv size={18} className="text-zinc-400 shrink-0" />
                <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                  {isDe ? 'Meine Streaming-Dienste' : 'Streaming Subscriptions'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeProviderObjects.length > 0 && (
                  <div className="flex items-center -space-x-1.5 mr-0.5">
                    {activeProviderObjects.slice(0, 4).map((p) => (
                      <div
                        key={p.provider_id}
                        className="w-5 h-5 rounded-full overflow-hidden ring-1 ring-black bg-zinc-800"
                      >
                        <SafeImage
                          src={tmdb.getImageUrl(p.logo_path, 'w200')}
                          fallbackTitle={p.provider_name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
                <span className="text-[clamp(0.85rem,2vw,0.925rem)] text-zinc-400">
                  {userProviders.length > 0
                    ? isDe
                      ? `${userProviders.length} aktiv`
                      : `${userProviders.length} active`
                    : isDe
                    ? 'Keine'
                    : 'None'}
                </span>
                <ChevronRight size={16} className="text-zinc-600" />
              </div>
            </button>

            {/* Row 2: Streaming-Region */}
            <button
              type="button"
              onClick={() => setActiveSheet('region')}
              className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <MapPin size={18} className="text-zinc-400 shrink-0" />
                <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                  {isDe ? 'Streaming-Region' : 'Streaming Region'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[clamp(0.85rem,2vw,0.925rem)] text-zinc-400">
                  {currentRegionLabel}
                </span>
                <ChevronRight size={16} className="text-zinc-600" />
              </div>
            </button>

            {/* Row 3: App-Sprache */}
            <button
              type="button"
              onClick={() => setActiveSheet('language')}
              className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Globe size={18} className="text-zinc-400 shrink-0" />
                <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                  {isDe ? 'Sprache' : 'Language'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[clamp(0.85rem,2vw,0.925rem)] text-zinc-400">
                  {currentLangLabel}
                </span>
                <ChevronRight size={16} className="text-zinc-600" />
              </div>
            </button>
          </div>
        </section>

        {/* 4. ERSCHEINUNGSBILD */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {isDe ? 'Erscheinungsbild' : 'Appearance'}
          </h3>

          <div className="border-y border-white/[0.08]">
            <div className="py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <Palette size={18} className="text-zinc-400 shrink-0" />
                <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                  {isDe ? 'Akzentfarbe' : 'Accent Color'}
                </span>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {THEMES.map((t) => {
                  const active = currentTheme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-label={isDe ? t.nameDe : t.nameEn}
                      onClick={() => setTheme(t.id)}
                      style={{ backgroundColor: t.swatch }}
                      className={`w-6 h-6 rounded-full transition-transform flex items-center justify-center ${
                        active
                          ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-black'
                          : 'opacity-70 hover:opacity-100 active:scale-95'
                      }`}
                    >
                      {active && <Check size={12} strokeWidth={3.5} className="text-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 4B. SMART TV & HISENSE VIDAA OS */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {isDe ? 'Smart TV & Hisense VIDAA OS' : 'Smart TV & Hisense VIDAA OS'}
          </h3>

          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {/* Row 1: Smart TV / Fernbedienungs-Modus (Auto / Ein / Aus) */}
            <div className="py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <Tv size={18} className="text-zinc-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                    {isDe ? 'Smart TV Modus (D-Pad)' : 'Smart TV Mode (D-Pad)'}
                  </div>
                  <div className="text-xs text-zinc-500 truncate mt-0.5">
                    {isTvMode
                      ? isDe
                        ? 'Aktiv · TV-Fernbedienung & Fokusring eingeschaltet'
                        : 'Active · TV remote & focus ring enabled'
                      : isDe
                      ? 'Steuerkreuz, Back-Taste (461) & 10-Foot-Skalierung'
                      : 'D-Pad, Back key (461) & 10-foot scaling'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.06] border border-white/10 shrink-0">
                {(
                  [
                    { id: 'auto', labelDe: 'Auto', labelEn: 'Auto' },
                    { id: 'on', labelDe: 'An', labelEn: 'On' },
                    { id: 'off', labelDe: 'Aus', labelEn: 'Off' },
                  ] as const
                ).map((opt) => {
                  const active = tvMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setTvMode(opt.id);
                        onNotify(
                          isDe
                            ? `Smart TV Modus: ${opt.labelDe}`
                            : `Smart TV Mode: ${opt.labelEn}`,
                          'info'
                        );
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                        active
                          ? 'bg-white text-black shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {isDe ? opt.labelDe : opt.labelEn}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row 2: Fernseher per 6-stelligem Code koppeln & VIDAA Setup Guide */}
            <button
              type="button"
              onClick={() => {
                setTvApproveError(null);
                setActiveSheet('tvPairing');
              }}
              className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Key size={18} className="text-zinc-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                    {isDe
                      ? 'Fernseher per Code anmelden & VIDAA Setup'
                      : 'Pair Smart TV via Code & VIDAA Setup'}
                  </div>
                  <div className="text-xs text-zinc-500 truncate mt-0.5">
                    {isDe
                      ? '6-stelliger TV-Code & Hisense 27753790 App-Installation'
                      : '6-digit TV code & Hisense 27753790 app installation'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[clamp(0.85rem,2vw,0.925rem)] text-zinc-400">
                  {isDe ? 'Koppeln' : 'Pair'}
                </span>
                <ChevronRight size={16} className="text-zinc-600" />
              </div>
            </button>
          </div>
        </section>

        {/* 5. DATEN & MEDIATHEK */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {isDe ? 'Daten & Mediathek' : 'Data & Library'}
          </h3>

          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            <button
              type="button"
              onClick={handleExportDownload}
              className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Download size={18} className="text-zinc-400 shrink-0" />
                <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                  {isDe ? 'Backup exportieren' : 'Export Backup'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-zinc-500 font-mono">.json</span>
                <ChevronRight size={16} className="text-zinc-600" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Upload size={18} className="text-zinc-400 shrink-0" />
                <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-white truncate">
                  {isDe ? 'Backup wiederherstellen' : 'Restore Backup'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-zinc-500 font-mono">.json</span>
                <ChevronRight size={16} className="text-zinc-600" />
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFileChange}
              className="hidden"
            />

            {!confirmingReset ? (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className="w-full py-4 flex items-center justify-between gap-3 hover:opacity-80 active:opacity-60 transition-opacity text-left"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Trash2 size={18} className="text-red-400 shrink-0" />
                  <span className="text-[clamp(0.925rem,2.2vw,1rem)] font-medium text-red-400 truncate">
                    {isDe ? 'Mediathek zurücksetzen' : 'Reset Library'}
                  </span>
                </div>
                <ChevronRight size={16} className="text-zinc-600 shrink-0" />
              </button>
            ) : (
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
                <span className="text-xs font-medium text-red-300">
                  {isDe
                    ? 'Watchlist und gesehene Episoden wirklich löschen?'
                    : 'Really clear your Watchlist and watched progress?'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    className="px-3.5 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold hover:bg-white/15"
                  >
                    {isDe ? 'Abbrechen' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onResetLibrary();
                      setConfirmingReset(false);
                    }}
                    className="px-3.5 py-1.5 rounded-full bg-red-500 text-white text-xs font-semibold hover:bg-red-600"
                  >
                    {isDe ? 'Endgültig löschen' : 'Delete All'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* --- NATIVE iOS BOTTOM SHEETS --- */}
      {activeSheet && (
        <div
          data-tv-scope="modal"
          className="fixed inset-0 z-[150] bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
          onClick={() => setActiveSheet(null)}
        >
          <div
            className="w-full sm:max-w-lg bg-[#1C1C1E] border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 max-h-[85dvh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber Handle */}
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4 sm:hidden shrink-0" />

            {/* Sheet: Smart TV 6-Digit Pairing & Hisense VIDAA OS Guide */}
            {activeSheet === 'tvPairing' && (
              <div className="overflow-y-auto no-scrollbar ios-touch-rail space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white">
                      <Tv size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {isDe ? 'Smart TV & VIDAA OS' : 'Smart TV & VIDAA OS'}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {isDe
                          ? 'Fernseher anmelden & als TV-App installieren'
                          : 'Sign in your TV & install as a TV app'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSheet(null)}
                    className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* 1. Approve TV via 6-digit pairing code */}
                {currentUser ? (
                  <form
                    onSubmit={handleApproveTvByCode}
                    className="p-4 rounded-2xl bg-black/45 border border-white/10 space-y-3"
                  >
                    <label className="block text-xs font-bold text-white">
                      {isDe
                        ? '6-stelligen Kopplungs-Code vom Fernseher eingeben:'
                        : 'Enter 6-digit pairing code shown on your Smart TV:'}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={7}
                      value={tvCodeInput}
                      onChange={(e) => {
                        setTvCodeInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                        setTvApproveError(null);
                      }}
                      placeholder="000000"
                      className="w-full text-center font-mono tabular-nums tracking-[0.32em] text-xl font-bold py-3 px-4 rounded-xl bg-black/60 border border-white/20 focus:border-white text-white outline-none select-text"
                    />
                    <button
                      type="submit"
                      disabled={tvApproveBusy || tvCodeInput.length !== 6}
                      className="w-full py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-45"
                    >
                      {tvApproveBusy
                        ? isDe
                          ? 'Verbinde Fernseher...'
                          : 'Linking Smart TV...'
                        : isDe
                        ? 'Fernseher jetzt mit meinem Konto anmelden'
                        : 'Sign In Smart TV Now'}
                    </button>
                    {tvApproveError && (
                      <p className="text-xs font-semibold text-red-300 text-center">
                        {tvApproveError}
                      </p>
                    )}
                  </form>
                ) : (
                  <div className="p-4 rounded-2xl bg-black/40 border border-white/10 text-xs text-zinc-300">
                    {isDe
                      ? 'Bitte melde dich zuerst auf diesem Gerät an, um deinen Fernseher per 6-stelligem Code freizugeben.'
                      : 'Please sign in on this device first to approve a Smart TV code.'}
                  </div>
                )}

                {/* 2. Hisense 55U6KQ (VIDAA U6/U7) Direct 1-Click Installer & Setup Guide */}
                <div className="p-4 rounded-2xl bg-black/35 border border-white/[0.08] space-y-3 text-xs text-zinc-300">
                  <div className="font-bold text-white">
                    {isDe
                      ? 'Hisense 55U6KQ (VIDAA OS) — Direkt-Installer & TV-Steuerung:'
                      : 'Hisense 55U6KQ (VIDAA OS) — Direct Installer & TV Control:'}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveSheet(null);
                      window.dispatchEvent(new CustomEvent('mj:open-vidaa-guide'));
                    }}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-black font-black text-xs transition-colors cursor-pointer"
                  >
                    {isDe
                      ? '1-Klick Hisense TV-Installer & 55U6KQ Anleitung öffnen'
                      : 'Open 1-Click Hisense TV Installer & 55U6KQ Guide'}
                  </button>

                  <p className="text-zinc-400 leading-relaxed">
                    {isDe
                      ? 'Hinweis zum Hisense 55U6KQ: Auf neueren VIDAA U6/U7 Updates hat Hisense sowohl hisense://debug als auch den Store-Code ab Werk gesperrt (oder verlangt im Store das blinde Tippen der 7 Ziffern 2775379 auf der Fernbedienung, während die Lupe nur markiert, aber NICHT geöffnet ist).'
                      : 'Note for Hisense 55U6KQ: Newer VIDAA U6/U7 firmware blocks hisense://debug and store codes (or requires blindly pressing the 7 digits 2775379 while hovering over the Search icon without pressing OK).'}
                  </p>

                  {/* Copyable Short /tv URL */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10">
                      <code className="text-[11px] font-mono text-white truncate select-all">
                        {typeof window !== 'undefined'
                          ? `${window.location.origin}/tv`
                          : '/tv'}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          const url =
                            typeof window !== 'undefined'
                              ? `${window.location.origin}/tv`
                              : '/tv';
                          navigator.clipboard?.writeText(url);
                          onNotify(
                            isDe ? 'TV-Start-URL kopiert' : 'TV launch URL copied',
                            'success'
                          );
                        }}
                        className="px-2.5 py-1 rounded-lg bg-white text-black font-bold text-[11px] flex items-center gap-1 shrink-0"
                      >
                        <Copy size={11} />
                        <span>{isDe ? 'URL kopieren' : 'Copy URL'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
                    <div className="font-bold text-white">
                      {isDe
                        ? 'TV-Zeiger & Fernbedienungs-Steuerung:'
                        : 'TV Pointer & Remote Control Shortcuts:'}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px] text-zinc-400">
                      <div>• Oben links: „TV Menü“ (Klick / ▲)</div>
                      <div>• Rechter Rand: Scroll- & Vollbild-Dock</div>
                      <div>• Filmreihen: Sichtbare &lt; / &gt; Pfeile</div>
                      <div>• Rote Taste / Menü: TV-Burgermenü</div>
                      <div>• Grüne Taste: Suche öffnen</div>
                      <div>• Gelb: Watchlist · Blau: Shuffle</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sheet: Two-Factor Authentication (2FA) */}
            {activeSheet === 'twoFactor' && (
              <div className="overflow-y-auto no-scrollbar ios-touch-rail space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white">
                      <Shield size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {isDe ? 'Zwei-Faktor-Schutz (2FA)' : 'Two-Factor Protection'}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {isDe
                          ? 'Schützt Apple-, Google- & E-Mail-Anmeldungen'
                          : 'Protects Apple, Google & Email logins'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSheet(null)}
                    className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                  >
                    <X size={16} />
                  </button>
                </div>

                {twoFactorEnabled ? (
                  <div className="space-y-4 pt-2">
                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-emerald-300">
                          {isDe ? '2FA ist aktiv' : '2FA is Active'}
                        </div>
                        <div className="text-xs text-zinc-400 mt-0.5">
                          {isDe
                            ? `Verbleibende Notfall-Backup-Codes: ${remainingBackupCodes}`
                            : `Remaining emergency backup codes: ${remainingBackupCodes}`}
                        </div>
                      </div>
                      <Check size={20} className="text-emerald-400 shrink-0" />
                    </div>

                    <button
                      type="button"
                      disabled={twoFactorBusy}
                      onClick={handleDisableTwoFactor}
                      className="w-full py-3 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 font-bold text-sm transition-colors"
                    >
                      {twoFactorBusy
                        ? isDe
                          ? 'Deaktiviere...'
                          : 'Disabling...'
                        : isDe
                        ? 'Zwei-Faktor-Authentifizierung deaktivieren'
                        : 'Disable Two-Factor Authentication'}
                    </button>
                  </div>
                ) : !twoFactorSetupData ? (
                  <div className="space-y-4 pt-2">
                    <p className="text-xs text-zinc-300 leading-relaxed">
                      {isDe
                        ? 'Verknüpfe dein Konto mit Apple Passwörter, Google Authenticator oder 1Password. Nach der Aktivierung wird beim Login auf neuen Geräten zusätzlich dein 6-stelliger Sicherheitscode abgefragt.'
                        : 'Link your account with Apple Passwords, Google Authenticator, or 1Password. Once enabled, new devices will require your 6-digit security code.'}
                    </p>

                    <button
                      type="button"
                      disabled={twoFactorBusy}
                      onClick={handleStartTwoFactorSetup}
                      className="w-full py-3.5 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-200 transition-colors"
                    >
                      {twoFactorBusy
                        ? isDe
                          ? 'Erzeuge Sicherheitsschlüssel...'
                          : 'Generating security key...'
                        : isDe
                        ? 'Jetzt 2FA einrichten'
                        : 'Set Up 2FA Now'}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleConfirmEnableTwoFactor} className="space-y-4 pt-1">
                    {/* Step 1: QR Code & Manual Secret */}
                    <div className="p-4 rounded-2xl bg-black/50 border border-white/10 flex flex-col items-center text-center space-y-3">
                      <p className="text-xs text-zinc-300 font-medium">
                        {isDe
                          ? '1. Scanne diesen QR-Code mit deiner Authenticator-App oder kopiere den Setup-Schlüssel:'
                          : '1. Scan this QR code in your Authenticator app or copy the setup key:'}
                      </p>

                      {twoFactorSetupData.qrCodeSvg && (
                        <div
                          className="w-40 h-40 p-2 rounded-2xl bg-zinc-900 border border-white/15 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                          dangerouslySetInnerHTML={{ __html: twoFactorSetupData.qrCodeSvg }}
                        />
                      )}

                      <div className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10">
                        <code className="text-xs font-mono text-white truncate select-all">
                          {twoFactorSetupData.secret}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(twoFactorSetupData.secret);
                            onNotify(
                              isDe ? 'Setup-Schlüssel kopiert' : 'Setup key copied',
                              'info'
                            );
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white flex items-center gap-1 shrink-0"
                        >
                          <Copy size={12} />
                          <span>{isDe ? 'Kopieren' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Step 2: 8 Single-Use Backup Codes */}
                    <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">
                          {isDe ? '2. Deine 8 Notfall-Backup-Codes' : '2. Your 8 Backup Codes'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(
                              twoFactorSetupData.backupCodes.join('\n')
                            );
                            onNotify(
                              isDe ? 'Backup-Codes kopiert' : 'Backup codes copied',
                              'info'
                            );
                          }}
                          className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
                        >
                          <Copy size={12} />
                          <span>{isDe ? 'Alle kopieren' : 'Copy All'}</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 font-mono text-xs text-zinc-300">
                        {twoFactorSetupData.backupCodes.map((bc) => (
                          <div
                            key={bc}
                            className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-center select-all"
                          >
                            {bc}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step 3: Verify 6-Digit Code */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-zinc-300">
                        {isDe
                          ? '3. 6-stelligen Code zur Bestätigung eingeben:'
                          : '3. Enter 6-digit code to confirm:'}
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={twoFactorCodeInput}
                        onChange={(e) =>
                          setTwoFactorCodeInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
                        }
                        placeholder="000000"
                        className="w-full text-center font-mono tabular-nums tracking-[0.3em] text-lg font-bold py-3 px-4 rounded-xl bg-black/50 border border-white/20 focus:border-white text-white outline-none select-text"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={twoFactorBusy || twoFactorCodeInput.length !== 6}
                      className="w-full py-3.5 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-45"
                    >
                      {twoFactorBusy
                        ? isDe
                          ? 'Aktiviere 2FA...'
                          : 'Enabling 2FA...'
                        : isDe
                        ? '2FA verbindlich aktivieren'
                        : 'Confirm & Enable 2FA'}
                    </button>
                  </form>
                )}

                {twoFactorError && (
                  <p className="text-xs font-semibold text-red-300 text-center">
                    {twoFactorError}
                  </p>
                )}
              </div>
            )}

            {/* Sheet: TMDB Multi-Key Failover Pool (5-10 Keys + Universal Cache Metrics) */}
            {activeSheet === 'keyPool' && (
              <div className="overflow-y-auto no-scrollbar ios-touch-rail space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white">
                      <Key size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {isDe ? 'TMDB Multi-Key Failover-Pool' : 'TMDB Multi-Key Failover Pool'}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {isDe
                          ? 'AES-256-GCM verschlüsselter Server-Tresor'
                          : 'AES-256-GCM encrypted server key pool'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={refreshSecurityAndPoolInfo}
                      aria-label="Refresh pool status"
                      className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSheet(null)}
                      className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* High-Throughput 1,000-User Pipeline Summary */}
                {keyPoolStatus && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-3 rounded-2xl bg-black/40 border border-white/[0.08]">
                      <div className="text-lg font-bold text-white tabular-nums">
                        {keyPoolStatus.healthyCount}/{keyPoolStatus.poolSize}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {isDe ? 'Bereite Keys' : 'Healthy Keys'}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-black/40 border border-white/[0.08]">
                      <div className="text-lg font-bold text-emerald-400 tabular-nums">
                        {keyPoolStatus.cacheStats.hitRatePercent}%
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {isDe ? 'Cache-Quote' : 'Cache Hit Rate'}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-black/40 border border-white/[0.08]">
                      <div className="text-lg font-bold text-white tabular-nums">
                        ~{keyPoolStatus.estimatedRpsCapacity}/s
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {isDe ? 'Miss-Kapazität' : 'Miss Capacity'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Active Keys List */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
                    <span>
                      {isDe ? 'Aktive rotierende Server-Keys' : 'Active Rotating Server Keys'}
                    </span>
                    {keyPoolStatus && (
                      <span className="tabular-nums">
                        {keyPoolStatus.cacheStats.l1Entries} gecachte Antworten
                      </span>
                    )}
                  </div>

                  <div className="divide-y divide-white/[0.06] rounded-2xl bg-black/35 border border-white/[0.08] max-h-48 overflow-y-auto no-scrollbar">
                    {keyPoolStatus?.keys.map((k) => (
                      <div
                        key={k.keyId}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white">
                              #{k.slotNumber} · {k.maskedKey}
                            </span>
                            <span className="text-zinc-500">
                              · {k.source === 'env' ? '.env' : 'Tresor'}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-400 tabular-nums mt-0.5">
                            {k.status === 'healthy'
                              ? isDe
                                ? `Bereit · ${k.totalRequests} Req · ${k.lastLatencyMs || 18}ms`
                                : `Healthy · ${k.totalRequests} req · ${k.lastLatencyMs || 18}ms`
                              : k.status === 'cooldown'
                              ? isDe
                                ? `Cooldown (${k.cooldownRemainingSec}s) · Failovers: ${k.failoverCount}`
                                : `Cooldown (${k.cooldownRemainingSec}s)`
                              : isDe
                              ? 'Ungültig'
                              : 'Invalid'}
                          </div>
                        </div>

                        {k.source === 'vault' && (keyPoolStatus?.poolSize || 0) > 1 && (
                          <button
                            type="button"
                            disabled={keyPoolBusy}
                            onClick={() => handleRemoveKeyFromPool(k.keyId)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors"
                            aria-label="Remove key"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add 1-10 Keys Form */}
                <form onSubmit={handleAddKeysToPool} className="space-y-3 pt-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    {isDe
                      ? 'Weitere TMDB API-Schlüssel hinzufügen (1 bis 10 Keys, getrennt durch Komma oder Zeilenumbruch):'
                      : 'Add TMDB API keys (1 to 10 keys, comma or newline separated):'}
                  </label>
                  <textarea
                    rows={3}
                    value={newKeysInput}
                    onChange={(e) => setNewKeysInput(e.target.value)}
                    placeholder={
                      isDe
                        ? 'z.B. a1b2c3d4e5..., f6g7h8i9j0...'
                        : 'e.g. a1b2c3d4e5..., f6g7h8i9j0...'
                    }
                    className="w-full p-3 rounded-xl bg-black/50 border border-white/15 focus:border-white text-xs font-mono text-white placeholder-zinc-500 outline-none resize-none select-text"
                  />
                  <button
                    type="submit"
                    disabled={keyPoolBusy || !newKeysInput.trim()}
                    className="w-full py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-45"
                  >
                    <Plus size={16} />
                    <span>
                      {keyPoolBusy
                        ? isDe
                          ? 'Prüfe & verschlüssele Keys...'
                          : 'Testing & encrypting keys...'
                        : isDe
                        ? 'Im Server-Pool speichern & rotieren'
                        : 'Save & Rotate in Server Pool'}
                    </span>
                  </button>
                </form>

                {keyPoolError && (
                  <p className="text-xs font-semibold text-red-300 text-center">
                    {keyPoolError}
                  </p>
                )}
              </div>
            )}

            {/* Sheet: Streaming Subscriptions */}
            {activeSheet === 'providers' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {isDe ? 'Streaming-Dienste' : 'Streaming Services'}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {isDe
                        ? `Wähle deine aktiven Abos (${currentRegion})`
                        : `Select your active subscriptions (${currentRegion})`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSheet(null)}
                    className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="relative mb-3 shrink-0">
                  <Search
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={providerSearch}
                    onChange={(e) => setProviderSearch(e.target.value)}
                    placeholder={isDe ? 'Dienst suchen...' : 'Search service...'}
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/25"
                  />
                </div>

                <div className="overflow-y-auto no-scrollbar ios-touch-rail divide-y divide-white/[0.06] rounded-2xl bg-black/30 border border-white/[0.06] flex-1">
                  {filteredProviders.map((p) => {
                    const selected = userProviders.includes(p.provider_id);
                    return (
                      <button
                        key={p.provider_id}
                        type="button"
                        onClick={() => toggleProvider(p.provider_id)}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10">
                            <SafeImage
                              src={tmdb.getImageUrl(p.logo_path, 'w200')}
                              fallbackTitle={p.provider_name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-sm font-medium text-white truncate">
                            {p.provider_name}
                          </span>
                        </div>

                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                            selected
                              ? 'bg-accent text-white'
                              : 'border border-white/20 text-transparent'
                          }`}
                        >
                          <Check size={13} strokeWidth={3} />
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setActiveSheet(null)}
                  className="mt-4 w-full py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-200 transition-colors shrink-0"
                >
                  {isDe ? 'Fertig' : 'Done'}
                </button>
              </>
            )}

            {/* Sheet: Region Picker */}
            {activeSheet === 'region' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-lg font-bold text-white">
                    {isDe ? 'Streaming-Region' : 'Streaming Region'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveSheet(null)}
                    className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="overflow-y-auto no-scrollbar ios-touch-rail divide-y divide-white/[0.06] rounded-2xl bg-black/30 border border-white/[0.06]">
                  {REGIONS.map((reg) => {
                    const active = currentRegion === reg.code;
                    return (
                      <button
                        key={reg.code}
                        type="button"
                        onClick={() => {
                          setRegion(reg.code);
                          setActiveSheet(null);
                          onNotify(
                            isDe
                              ? `Region auf ${reg.nameDe} geändert`
                              : `Region set to ${reg.nameEn}`,
                            'success'
                          );
                        }}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{reg.flag}</span>
                          <span className="text-sm font-medium text-white">
                            {isDe ? reg.nameDe : reg.nameEn}
                          </span>
                        </div>
                        {active && <Check size={17} strokeWidth={3} className="text-accent" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Sheet: Language Picker */}
            {activeSheet === 'language' && (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-lg font-bold text-white">
                    {isDe ? 'Sprache' : 'Language'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveSheet(null)}
                    className="w-8 h-8 rounded-full bg-white/10 text-zinc-300 hover:text-white flex items-center justify-center"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="overflow-y-auto no-scrollbar ios-touch-rail divide-y divide-white/[0.06] rounded-2xl bg-black/30 border border-white/[0.06]">
                  {LANGUAGES.map((l) => {
                    const active = currentLanguage === l.code;
                    return (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => {
                          setLanguage(l.code);
                          setActiveSheet(null);
                          onNotify(
                            l.code.startsWith('de')
                              ? 'Sprache auf Deutsch gestellt'
                              : `Language set to ${l.name}`,
                            'success'
                          );
                        }}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left"
                      >
                        <div>
                          <div className="text-sm font-medium text-white">{l.name}</div>
                          <div className="text-xs text-zinc-500">{l.subtitle}</div>
                        </div>
                        {active && <Check size={17} strokeWidth={3} className="text-accent" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
