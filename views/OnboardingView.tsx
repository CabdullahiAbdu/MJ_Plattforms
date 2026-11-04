import React, { useState, useEffect, useMemo } from 'react';
import { TmdbService } from '../services/tmdb';
import { WatchProvider, Genre } from '../types';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Globe,
  Tv,
  Film,
  Palette,
  Zap,
  Shield,
  Wifi,
} from '../components/Icons';
import { BrandLogo } from '../components/BrandLogo';
import { SafeImage } from '../components/SafeImage';
import { CinemaProjectorStage } from '../components/CinemaProjectorStage';
import { User } from '../services/firebase';

interface OnboardingViewProps {
  tmdb: TmdbService;
  onComplete: () => void;
  setLanguage: (lang: string) => void;
  setRegion: (reg: string) => void;
  setTheme: (theme: string) => void;
  setUserGenres: (genres: number[]) => void;
  setUserProviders: (providers: number[]) => void;
  setIncludeAdult: (val: boolean) => void;
  setAutoplay: (val: boolean) => void;
  setDataSaver: (val: boolean) => void;
  currentUser?: User | null;
  openAuthModal?: () => void;
}

const REGIONS = [
  { code: 'DE', nameDe: 'Deutschland', nameEn: 'Germany', flag: '🇩🇪', defaultLang: 'de-DE' },
  { code: 'AT', nameDe: 'Österreich', nameEn: 'Austria', flag: '🇦🇹', defaultLang: 'de-DE' },
  { code: 'CH', nameDe: 'Schweiz', nameEn: 'Switzerland', flag: '🇨🇭', defaultLang: 'de-DE' },
  { code: 'US', nameDe: 'USA', nameEn: 'United States', flag: '🇺🇸', defaultLang: 'en-US' },
  { code: 'GB', nameDe: 'Großbritannien', nameEn: 'United Kingdom', flag: '🇬🇧', defaultLang: 'en-GB' },
  { code: 'FR', nameDe: 'Frankreich', nameEn: 'France', flag: '🇫🇷', defaultLang: 'fr-FR' },
  { code: 'ES', nameDe: 'Spanien', nameEn: 'Spain', flag: '🇪🇸', defaultLang: 'es-ES' },
  { code: 'IT', nameDe: 'Italien', nameEn: 'Italy', flag: '🇮🇹', defaultLang: 'it-IT' },
  { code: 'JP', nameDe: 'Japan', nameEn: 'Japan', flag: '🇯🇵', defaultLang: 'ja-JP' },
];

const LANGUAGES = [
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'es-ES', name: 'Español' },
  { code: 'it-IT', name: 'Italiano' },
  { code: 'ja-JP', name: '日本語' },
];

const THEMES = [
  {
    id: 'indigo',
    nameDe: 'Kino Indigo',
    nameEn: 'Cinema Indigo',
    descDe: 'Klassisch, tief & atmosphärisch',
    descEn: 'Classic, deep & atmospheric',
    dot: 'bg-indigo-500',
    ring: 'ring-indigo-500/50 border-indigo-500',
    glow: 'from-indigo-500/25 via-indigo-500/5 to-transparent',
  },
  {
    id: 'crimson',
    nameDe: 'Premiere Rot',
    nameEn: 'Premiere Crimson',
    descDe: 'Warmes Lichtspielhaus-Rot',
    descEn: 'Warm theatre velvet',
    dot: 'bg-rose-500',
    ring: 'ring-rose-500/50 border-rose-500',
    glow: 'from-rose-500/25 via-rose-500/5 to-transparent',
  },
  {
    id: 'emerald',
    nameDe: 'Studio Smaragd',
    nameEn: 'Studio Emerald',
    descDe: 'Modern, kontrastreich & klar',
    descEn: 'Modern, crisp & high-contrast',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-500/50 border-emerald-500',
    glow: 'from-emerald-500/25 via-emerald-500/5 to-transparent',
  },
];

// Official TMDB provider fallback catalogue so logos always render reliably
const CURATED_POPULAR_PROVIDERS: WatchProvider[] = [
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
  { provider_id: 1899, provider_name: 'Max', logo_path: '/fksCUZ9QDWZMUwL2LgMtLckROUN.jpg', display_priority: 11 },
  { provider_id: 188, provider_name: 'YouTube Premium', logo_path: '/rMb93u1tBeErSYLv79zSTR07UdO.jpg', display_priority: 12 },
];

const DEFAULT_GENRES_DE: Genre[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Abenteuer' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Komödie' },
  { id: 80, name: 'Krimi' },
  { id: 99, name: 'Dokumentarfilm' },
  { id: 18, name: 'Drama' },
  { id: 14, name: 'Fantasy' },
  { id: 27, name: 'Horror' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Liebesfilm' },
  { id: 878, name: 'Science Fiction' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'Kriegsfilm' },
];

const DEFAULT_GENRES_EN: Genre[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 14, name: 'Fantasy' },
  { id: 27, name: 'Horror' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
];

const TOTAL_STEPS = 5;

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  tmdb,
  onComplete,
  setLanguage,
  setRegion,
  setTheme,
  setUserGenres,
  setUserProviders,
  setIncludeAdult,
  setAutoplay,
  setDataSaver,
  currentUser,
}) => {
  const [step, setStep] = useState(0);

  const [selectedRegion, setSelectedRegion] = useState<string>(tmdb.getRegion() || 'DE');
  const [selectedLang, setSelectedLang] = useState<string>(tmdb.getLanguage() || 'de-DE');
  const [selectedTheme, setSelectedTheme] = useState<string>('indigo');
  const [selectedProviders, setSelectedProviders] = useState<number[]>([8, 9, 337]);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([28, 18, 878, 53]);

  const [autoplayChoice, setAutoplayChoice] = useState<boolean>(true);
  const [dataSaverChoice, setDataSaverChoice] = useState<boolean>(false);
  const [adultChoice, setAdultChoice] = useState<boolean>(false);

  const [liveProviders, setLiveProviders] = useState<WatchProvider[]>([]);
  const [liveGenres, setLiveGenres] = useState<Genre[]>([]);
  const [loadingProviders, setLoadingProviders] = useState<boolean>(false);

  const isDe = selectedLang.toLowerCase().startsWith('de');

  useEffect(() => {
    tmdb.setRegion(selectedRegion);
    tmdb.setLanguage(selectedLang);

    let active = true;
    setLoadingProviders(true);

    Promise.all([
      tmdb.getWatchProviderList('movie').catch(() => [] as WatchProvider[]),
      tmdb.getGenres('movie').catch(() => [] as Genre[]),
    ])
      .then(([provList, genreList]) => {
        if (!active) return;
        if (Array.isArray(provList) && provList.length > 0) {
          setLiveProviders(provList);
        }
        if (Array.isArray(genreList) && genreList.length > 0) {
          setLiveGenres(genreList);
        }
      })
      .finally(() => {
        if (active) setLoadingProviders(false);
      });

    return () => {
      active = false;
    };
  }, [selectedRegion, selectedLang, tmdb]);

  const displayProviders = useMemo(() => {
    const map = new Map<number, WatchProvider>();
    if (liveProviders.length > 0) {
      for (const p of liveProviders) {
        if (p && p.provider_id && p.logo_path) {
          map.set(p.provider_id, p);
        }
      }
    }
    for (const fallback of CURATED_POPULAR_PROVIDERS) {
      if (!map.has(fallback.provider_id)) {
        map.set(fallback.provider_id, fallback);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
      .slice(0, 18);
  }, [liveProviders]);

  const displayGenres = useMemo(() => {
    if (liveGenres.length > 0) return liveGenres;
    return isDe ? DEFAULT_GENRES_DE : DEFAULT_GENRES_EN;
  }, [liveGenres, isDe]);

  const toggleProvider = (id: number) => {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleGenre = (id: number) => {
    setSelectedGenres((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleFinish = () => {
    setRegion(selectedRegion);
    setLanguage(selectedLang);
    setTheme(selectedTheme);
    setUserProviders(selectedProviders);
    setUserGenres(selectedGenres);
    setAutoplay(autoplayChoice);
    setDataSaver(dataSaverChoice);
    setIncludeAdult(adultChoice);
    onComplete();
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (step > 0) {
      setStep((s) => s - 1);
    }
  };

  const userFirstName =
    currentUser?.displayName?.split(' ')[0] ||
    currentUser?.email?.split('@')[0] ||
    null;

  return (
    <div
      className="fixed inset-0 z-[220] bg-zinc-950 text-white font-sans flex flex-col justify-between overflow-hidden select-none"
      data-theme={selectedTheme}
    >
      {/* Ambient Movie Backdrop */}
      <CinemaProjectorStage tmdb={tmdb} />

      {/* Top Header Bar */}
      <header className="relative z-20 w-full max-w-4xl mx-auto px-[var(--fluid-page-px)] pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandLogo size="sm" phase="complete" />
        </div>

        {/* Clean Step Progress Dots */}
        <div className="flex items-center gap-1.5 sm:gap-2" aria-label="Progress">
          {Array.from({ length: TOTAL_STEPS }).map((_, idx) => {
            const isActive = idx === step;
            const isPast = idx < step;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setStep(idx)}
                aria-label={`Step ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  isActive
                    ? 'w-6 sm:w-7 bg-white'
                    : isPast
                    ? 'w-2.5 sm:w-3 bg-white/50 hover:bg-white/70'
                    : 'w-2 bg-white/20 hover:bg-white/35'
                }`}
              />
            );
          })}
        </div>
      </header>

      {/* Main Scrollable Step Content Container */}
      <main className="relative z-20 flex-1 w-full max-w-4xl mx-auto px-[var(--fluid-page-px)] overflow-y-auto no-scrollbar ios-touch-rail flex flex-col justify-center py-3 sm:py-5">
        {/* STEP 0: Welcome */}
        {step === 0 && (
          <div className="w-full max-w-xl mx-auto text-center space-y-[clamp(1.25rem,3.5dvh,2rem)] animate-fade-in my-auto py-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-[clamp(0.7rem,2vw,0.8rem)] font-semibold text-zinc-200 backdrop-blur-md">
              <Sparkles size={14} className="text-accent" />
              <span>
                {userFirstName
                  ? isDe
                    ? `Willkommen, ${userFirstName}`
                    : `Welcome, ${userFirstName}`
                  : isDe
                  ? 'Persönliche Einrichtung'
                  : 'Personal Setup'}
              </span>
            </div>

            <div className="space-y-3">
              <h1
                style={{ fontSize: 'clamp(1.65rem, 5.4vw, 3rem)' }}
                className="font-black tracking-tight text-white leading-[1.08] font-display"
              >
                {isDe
                  ? 'Dein Kino. Deine Streaming-Dienste.'
                  : 'Your Cinema. Your Streaming Services.'}
              </h1>
              <p
                style={{ fontSize: 'clamp(0.8125rem, 2.3vw, 1rem)' }}
                className="text-zinc-300 leading-relaxed max-w-lg mx-auto"
              >
                {isDe
                  ? 'Richte MovieJournal in wenigen Sekunden auf dein Land, deine Streaming-Abos und deinen Filmgeschmack ein.'
                  : 'Tailor MovieJournal to your country, streaming subscriptions, and film taste in seconds.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 text-left max-w-lg sm:max-w-2xl mx-auto pt-1">
              <div className="p-[clamp(0.85rem,2.8vw,1.1rem)] rounded-2xl bg-zinc-900/75 border border-white/10 backdrop-blur-xl">
                <Tv size={18} className="text-accent mb-1.5" />
                <div className="text-[clamp(0.78rem,2.2vw,0.875rem)] font-bold text-white">
                  {isDe ? 'Deine Abos im Blick' : 'Your Subscriptions'}
                </div>
                <p className="text-[clamp(0.7rem,1.9vw,0.78rem)] text-zinc-400 mt-1 leading-relaxed">
                  {isDe
                    ? 'Sieh sofort, wo Filme & Serien in deinem Abo enthalten sind.'
                    : 'Instantly see where movies & series stream in your subscriptions.'}
                </p>
              </div>

              <div className="p-[clamp(0.85rem,2.8vw,1.1rem)] rounded-2xl bg-zinc-900/75 border border-white/10 backdrop-blur-xl">
                <Film size={18} className="text-accent mb-1.5" />
                <div className="text-[clamp(0.78rem,2.2vw,0.875rem)] font-bold text-white">
                  {isDe ? 'Persönliche Watchlist' : 'Personal Watchlist'}
                </div>
                <p className="text-[clamp(0.7rem,1.9vw,0.78rem)] text-zinc-400 mt-1 leading-relaxed">
                  {isDe
                    ? 'Behalte gesehene Episoden, Filme und kommende Starts fest im Griff.'
                    : 'Track watched episodes, movies, and upcoming premieres.'}
                </p>
              </div>

              <div className="p-[clamp(0.85rem,2.8vw,1.1rem)] rounded-2xl bg-zinc-900/75 border border-white/10 backdrop-blur-xl">
                <Globe size={18} className="text-accent mb-1.5" />
                <div className="text-[clamp(0.78rem,2.2vw,0.875rem)] font-bold text-white">
                  {isDe ? 'Cloud-Synchronisation' : 'Cloud Synced'}
                </div>
                <p className="text-[clamp(0.7rem,1.9vw,0.78rem)] text-zinc-400 mt-1 leading-relaxed">
                  {isDe
                    ? 'Deine Auswahl wird automatisch in deinem Konto gespeichert.'
                    : 'Your preferences are automatically saved to your account.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 1: Region & Language */}
        {step === 1 && (
          <div className="w-full space-y-5 animate-fade-in my-auto">
            <div className="space-y-1">
              <span className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-widest text-accent">
                {isDe ? 'Schritt 1 von 4' : 'Step 1 of 4'}
              </span>
              <h2
                style={{ fontSize: 'clamp(1.45rem, 4.8vw, 2.5rem)' }}
                className="font-black tracking-tight text-white font-display leading-tight"
              >
                {isDe ? 'Region & Sprache' : 'Region & Language'}
              </h2>
              <p className="text-[clamp(0.75rem,2.1vw,0.875rem)] text-zinc-400">
                {isDe
                  ? 'Bestimmt die lokale Streaming-Verfügbarkeit, Kinostarts und Beschreibungstexte.'
                  : 'Determines regional streaming availability, release dates, and descriptions.'}
              </p>
            </div>

            {/* Region Grid — Fluid auto-fit so long country names like Großbritannien/Deutschland never clip */}
            <div className="space-y-2">
              <label className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-wider text-zinc-400 block">
                {isDe ? 'Streaming-Land wählen' : 'Select Streaming Country'}
              </label>
              <div
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(clamp(132px, 38vw, 185px), 1fr))',
                }}
                className="grid gap-2.5"
              >
                {REGIONS.map((reg) => {
                  const active = selectedRegion === reg.code;
                  return (
                    <button
                      key={reg.code}
                      type="button"
                      onClick={() => {
                        setSelectedRegion(reg.code);
                        setSelectedLang(reg.defaultLang);
                      }}
                      className={`flex items-center gap-2.5 p-[clamp(0.65rem,2.2vw,0.9rem)] rounded-2xl border text-left transition-all ${
                        active
                          ? 'bg-white text-black border-white shadow-lg scale-[1.01]'
                          : 'bg-zinc-900/75 text-white border-white/10 hover:bg-zinc-800/80 hover:border-white/20'
                      }`}
                    >
                      <span className="text-[clamp(1.15rem,3.6vw,1.5rem)] leading-none shrink-0">
                        {reg.flag}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold truncate">
                          {isDe ? reg.nameDe : reg.nameEn}
                        </div>
                        <div
                          className={`text-[10px] font-mono ${
                            active ? 'text-zinc-600' : 'text-zinc-400'
                          }`}
                        >
                          {reg.code}
                        </div>
                      </div>
                      {active && <Check size={15} className="shrink-0 text-black" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Language Pills */}
            <div className="space-y-2 pt-1">
              <label className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-wider text-zinc-400 block">
                {isDe ? 'App- & Inhaltssprache' : 'App & Content Language'}
              </label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => {
                  const active = selectedLang === l.code;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => setSelectedLang(l.code)}
                      className={`px-3.5 py-2 rounded-xl text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold border transition-all ${
                        active
                          ? 'bg-white text-black border-white shadow-md'
                          : 'bg-zinc-900/75 text-zinc-300 border-white/10 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Streaming Providers */}
        {step === 2 && (
          <div className="w-full space-y-4 animate-fade-in my-auto">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div className="space-y-1">
                <span className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-widest text-accent">
                  {isDe ? 'Schritt 2 von 4' : 'Step 2 of 4'}
                </span>
                <h2
                  style={{ fontSize: 'clamp(1.45rem, 4.8vw, 2.5rem)' }}
                  className="font-black tracking-tight text-white font-display leading-tight"
                >
                  {isDe ? 'Deine Streaming-Dienste' : 'Your Streaming Services'}
                </h2>
                <p className="text-[clamp(0.75rem,2.1vw,0.875rem)] text-zinc-400">
                  {isDe
                    ? `Wähle deine aktiven Abos in ${selectedRegion}, damit wir verfügbare Filme direkt hervorheben.`
                    : `Select your active subscriptions in ${selectedRegion} to highlight included titles.`}
                </p>
              </div>
              <div className="text-[clamp(0.7rem,1.9vw,0.78rem)] font-bold text-zinc-300 bg-white/10 px-3 py-1 rounded-full self-start sm:self-auto shrink-0">
                {selectedProviders.length} {isDe ? 'ausgewählt' : 'selected'}
              </div>
            </div>

            {loadingProviders && displayProviders.length === 0 ? (
              <div
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(clamp(88px, 25vw, 126px), 1fr))',
                }}
                className="grid gap-2.5"
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-24 rounded-2xl bg-zinc-900/70 border border-white/5 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(clamp(88px, 25vw, 126px), 1fr))',
                }}
                className="grid gap-2.5 max-h-[50dvh] overflow-y-auto no-scrollbar ios-touch-rail pr-1 py-1"
              >
                {displayProviders.map((provider) => {
                  const isSelected = selectedProviders.includes(provider.provider_id);
                  const logoUrl = tmdb.getImageUrl(provider.logo_path, 'w200');
                  return (
                    <button
                      key={provider.provider_id}
                      type="button"
                      onClick={() => toggleProvider(provider.provider_id)}
                      className={`group relative flex flex-col items-center justify-center p-[clamp(0.6rem,2vw,0.85rem)] rounded-2xl border transition-all duration-200 ${
                        isSelected
                          ? 'bg-white/15 border-white ring-2 ring-white/40 shadow-xl scale-[1.01]'
                          : 'bg-zinc-900/75 border-white/10 hover:bg-zinc-800/80 hover:border-white/25 opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div
                        style={{
                          width: 'clamp(2.75rem, 11vw, 3.75rem)',
                          height: 'clamp(2.75rem, 11vw, 3.75rem)',
                        }}
                        className="relative rounded-2xl overflow-hidden bg-zinc-800 shadow-md mb-1.5 shrink-0"
                      >
                        <SafeImage
                          src={logoUrl}
                          alt={provider.provider_name}
                          fallbackTitle={provider.provider_name}
                          className="w-full h-full object-cover"
                          loading="eager"
                        />
                      </div>
                      <span className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold text-white text-center line-clamp-1 w-full">
                        {provider.provider_name}
                      </span>

                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-emerald-400 text-black flex items-center justify-center shadow-md">
                          <Check size={11} strokeWidth={3.5} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Favorite Genres */}
        {step === 3 && (
          <div className="w-full space-y-4 animate-fade-in my-auto">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div className="space-y-1">
                <span className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-widest text-accent">
                  {isDe ? 'Schritt 3 von 4' : 'Step 3 of 4'}
                </span>
                <h2
                  style={{ fontSize: 'clamp(1.45rem, 4.8vw, 2.5rem)' }}
                  className="font-black tracking-tight text-white font-display leading-tight"
                >
                  {isDe ? 'Lieblings-Genres' : 'Favorite Genres'}
                </h2>
                <p className="text-[clamp(0.75rem,2.1vw,0.875rem)] text-zinc-400">
                  {isDe
                    ? 'Wähle mindestens 2–3 Genres für persönliche Empfehlungen auf deinem Startbildschirm.'
                    : 'Pick at least 2–3 genres for personalized recommendations on your home screen.'}
                </p>
              </div>
              <div className="text-[clamp(0.7rem,1.9vw,0.78rem)] font-bold text-zinc-300 bg-white/10 px-3 py-1 rounded-full self-start sm:self-auto shrink-0">
                {selectedGenres.length} {isDe ? 'ausgewählt' : 'selected'}
              </div>
            </div>

            <div
              style={{
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(clamp(128px, 38vw, 185px), 1fr))',
              }}
              className="grid gap-2.5"
            >
              {displayGenres.map((genre) => {
                const isSelected = selectedGenres.includes(genre.id);
                return (
                  <button
                    key={genre.id}
                    type="button"
                    onClick={() => toggleGenre(genre.id)}
                    className={`flex items-center justify-between px-3.5 py-3 rounded-2xl border font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] transition-all ${
                      isSelected
                        ? 'bg-white text-black border-white shadow-lg scale-[1.01]'
                        : 'bg-zinc-900/75 text-zinc-200 border-white/10 hover:bg-zinc-800/80 hover:border-white/20'
                    }`}
                  >
                    <span className="truncate pr-2">{genre.name}</span>
                    {isSelected ? (
                      <Check size={15} className="shrink-0 text-black" strokeWidth={3} />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-white/25 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 4: Appearance & Playback */}
        {step === 4 && (
          <div className="w-full space-y-5 animate-fade-in my-auto">
            <div className="space-y-1">
              <span className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-widest text-accent">
                {isDe ? 'Schritt 4 von 4' : 'Step 4 of 4'}
              </span>
              <h2
                style={{ fontSize: 'clamp(1.45rem, 4.8vw, 2.5rem)' }}
                className="font-black tracking-tight text-white font-display leading-tight"
              >
                {isDe ? 'Darstellung & Wiedergabe' : 'Appearance & Playback'}
              </h2>
              <p className="text-[clamp(0.75rem,2.1vw,0.875rem)] text-zinc-400">
                {isDe
                  ? 'Wähle deine Akzentfarbe und lege fest, wie Trailer abgespielt werden sollen.'
                  : 'Choose your accent color and configure how trailers and images load.'}
              </p>
            </div>

            {/* Theme Selection */}
            <div className="space-y-2">
              <label className="text-[clamp(0.68rem,1.9vw,0.75rem)] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Palette size={14} />
                <span>{isDe ? 'Farbakzent' : 'Accent Theme'}</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                {THEMES.map((t) => {
                  const active = selectedTheme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTheme(t.id)}
                      className={`relative overflow-hidden p-3.5 rounded-2xl border text-left transition-all ${
                        active
                          ? `bg-zinc-900 ${t.ring} ring-2 shadow-xl`
                          : 'bg-zinc-900/70 border-white/10 hover:bg-zinc-800/80'
                      }`}
                    >
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${t.glow} pointer-events-none`}
                      />
                      <div className="relative z-10 flex items-center justify-between mb-1.5">
                        <span className={`w-4 h-4 rounded-full ${t.dot} shadow-md`} />
                        {active && <Check size={15} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="relative z-10 text-[clamp(0.8rem,2.2vw,0.9rem)] font-bold text-white">
                        {isDe ? t.nameDe : t.nameEn}
                      </div>
                      <div className="relative z-10 text-[clamp(0.7rem,1.9vw,0.78rem)] text-zinc-400 mt-0.5">
                        {isDe ? t.descDe : t.descEn}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Playback Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => setAutoplayChoice((v) => !v)}
                className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2.5 ${
                  autoplayChoice
                    ? 'bg-white/15 border-white/30 text-white'
                    : 'bg-zinc-900/70 border-white/10 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <Zap size={17} className={autoplayChoice ? 'text-amber-400' : 'text-zinc-500'} />
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      autoplayChoice ? 'bg-emerald-400 text-black' : 'bg-white/10 text-zinc-400'
                    }`}
                  >
                    {autoplayChoice ? (isDe ? 'Aktiv' : 'On') : isDe ? 'Aus' : 'Off'}
                  </span>
                </div>
                <div>
                  <div className="text-[clamp(0.78rem,2.2vw,0.875rem)] font-bold text-white">
                    {isDe ? 'Trailer-Autoplay' : 'Trailer Autoplay'}
                  </div>
                  <p className="text-[clamp(0.68rem,1.9vw,0.75rem)] text-zinc-400 mt-0.5">
                    {isDe
                      ? 'Spielt Trailer auf Detailseiten automatisch ab.'
                      : 'Automatically plays trailers on detail pages.'}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDataSaverChoice((v) => !v)}
                className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2.5 ${
                  dataSaverChoice
                    ? 'bg-white/15 border-white/30 text-white'
                    : 'bg-zinc-900/70 border-white/10 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <Wifi size={17} className={dataSaverChoice ? 'text-sky-400' : 'text-zinc-500'} />
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      dataSaverChoice ? 'bg-emerald-400 text-black' : 'bg-white/10 text-zinc-400'
                    }`}
                  >
                    {dataSaverChoice ? (isDe ? 'Aktiv' : 'On') : isDe ? 'Aus' : 'Off'}
                  </span>
                </div>
                <div>
                  <div className="text-[clamp(0.78rem,2.2vw,0.875rem)] font-bold text-white">
                    {isDe ? 'Datensparmodus' : 'Data Saver'}
                  </div>
                  <p className="text-[clamp(0.68rem,1.9vw,0.75rem)] text-zinc-400 mt-0.5">
                    {isDe
                      ? 'Komprimiert Poster & Hintergründe für mobiles Netz.'
                      : 'Loads lighter images on cellular connections.'}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAdultChoice((v) => !v)}
                className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2.5 ${
                  adultChoice
                    ? 'bg-white/15 border-white/30 text-white'
                    : 'bg-zinc-900/70 border-white/10 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <Shield size={17} className={adultChoice ? 'text-rose-400' : 'text-zinc-500'} />
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      adultChoice ? 'bg-rose-500 text-white' : 'bg-white/10 text-zinc-400'
                    }`}
                  >
                    {adultChoice ? '18+' : isDe ? 'Aus' : 'Off'}
                  </span>
                </div>
                <div>
                  <div className="text-[clamp(0.78rem,2.2vw,0.875rem)] font-bold text-white">
                    {isDe ? 'FSK-18 Inhalte' : 'Adult Titles'}
                  </div>
                  <p className="text-[clamp(0.68rem,1.9vw,0.75rem)] text-zinc-400 mt-0.5">
                    {isDe
                      ? 'Inhalte für Erwachsene in der Suche einbeziehen.'
                      : 'Include adult-rated titles in search results.'}
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Safe-Area Bottom Action Bar */}
      <footer className="relative z-20 w-full max-w-4xl mx-auto px-[var(--fluid-page-px)] pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-3 flex items-center justify-between gap-3 border-t border-white/10 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        {step > 0 ? (
          <button
            type="button"
            onClick={handlePrev}
            className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] transition-all"
          >
            <ChevronLeft size={16} />
            <span>{isDe ? 'Zurück' : 'Back'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            className="text-[clamp(0.72rem,2vw,0.8rem)] font-semibold text-zinc-400 hover:text-white transition-colors px-2 py-2"
          >
            {isDe ? 'Standard übernehmen' : 'Use defaults'}
          </button>
        )}

        <button
          type="button"
          onClick={handleNext}
          className="inline-flex items-center gap-2 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-white text-black hover:bg-zinc-100 font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] shadow-[0_0_35px_-5px_rgba(255,255,255,0.5)] active:scale-[0.98] transition-all ml-auto"
        >
          <span>
            {step === 0
              ? isDe
                ? 'Einrichtung starten'
                : 'Start Setup'
              : step === TOTAL_STEPS - 1
              ? isDe
                ? 'Fertigstellen'
                : 'Finish Setup'
              : isDe
              ? 'Weiter'
              : 'Continue'}
          </span>
          {step === TOTAL_STEPS - 1 ? <Check size={16} strokeWidth={3} /> : <ChevronRight size={16} />}
        </button>
      </footer>
    </div>
  );
};