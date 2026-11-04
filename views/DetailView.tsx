import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  X,
  ChevronLeft,
  ChevronRight,
  Star,
  Plus,
  Check,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from '../components/Icons';
import { Share2, Tag } from 'lucide-react';
import { TmdbService } from '../services/tmdb';
import { KinoCheckService } from '../services/kinoCheck';
import { haptics } from '../services/haptics';
import { shareMediaItem } from '../services/share';
import {
  MediaItem,
  MovieDetails,
  TvShowDetails,
  PersonDetails,
  AppView,
  MediaType,
  CastMember,
  Video,
  WatchProvider,
  WatchProviderCountryData,
  CreditsResponse,
  Review,
  Collection,
  Company,
  Keyword,
  TmdbImage,
  resolveMediaType,
} from '../types';
import { SmartRow } from '../components/SmartRow';
import { TetrisGrid } from '../components/TetrisGrid';
import { SafeImage } from '../components/SafeImage';

interface DetailViewProps {
  id: number;
  type: MediaType;
  view: AppView;
  tmdb: TmdbService;
  kinoCheckKey?: string;
  userProviders?: number[];
  seedItem?: MediaItem;
  autoPlayTrailer?: boolean;
  autoplay?: boolean;
  onBack?: () => void;
  navigate: (view: AppView, params?: any) => void;
  isInWatchlist: boolean;
  onToggleWatchlist: (item: MediaItem) => void;
  watchedEpisodes: number[];
  onToggleEpisode: (epId: number) => void;
  isOverlay?: boolean;
}

interface DetailState {
  item: MovieDetails | TvShowDetails | PersonDetails | Collection | Company | MediaItem | null;
  credits: CreditsResponse | null;
  videos: Video[];
  providers: WatchProviderCountryData | null;
  recommendations: MediaItem[];
  similar?: MediaItem[];
  reviews: Review[];
  keywords: Keyword[];
  combinedCredits?: MediaItem[];
  externalIds?: any;
  logoPath?: string | null;
  backdrops?: TmdbImage[];
  personProfiles?: TmdbImage[];
  certification?: string | null;
  loading: boolean;
  error: boolean;
  collectionParts?: MediaItem[];
  companyMovies?: MediaItem[];
  seasonDetails?: any;
  selectedSeasonNumber?: number;
  seasonProviders?: WatchProviderCountryData | null;
}

const getSmartProviderLink = (providerName: string, title: string, tmdbLink: string): string => {
  const encodedTitle = encodeURIComponent(title);
  const p = providerName.toLowerCase();

  if (p.includes('netflix')) return `https://www.netflix.com/search?q=${encodedTitle}`;
  if (p.includes('disney')) return `https://www.disneyplus.com/search?q=${encodedTitle}`;
  if (p.includes('amazon') || p.includes('prime'))
    return `https://www.amazon.com/s?k=${encodedTitle}&i=instant-video`;
  if (p.includes('apple')) return `https://tv.apple.com/search?term=${encodedTitle}`;
  if (p.includes('crunchyroll')) return `https://www.crunchyroll.com/search?q=${encodedTitle}`;
  if (p.includes('wow') || p.includes('sky'))
    return tmdbLink || `https://www.wowtv.de/suche?q=${encodedTitle}`;
  if (p.includes('paramount')) return `https://www.paramountplus.com/search/?q=${encodedTitle}`;
  if (p.includes('rtl')) return `https://plus.rtl.de/suche?term=${encodedTitle}`;
  if (p.includes('joyn')) return `https://www.joyn.de/suche?q=${encodedTitle}`;
  if (p.includes('youtube')) return `https://www.youtube.com/results?search_query=${encodedTitle}`;

  return tmdbLink;
};

function dedupProviders(list: WatchProvider[] = []): WatchProvider[] {
  const map = new Map<number, WatchProvider>();
  list.forEach((p) => {
    if (!map.has(p.provider_id)) {
      map.set(p.provider_id, p);
    }
  });
  return Array.from(map.values());
}

export const DetailView: React.FC<DetailViewProps> = ({
  id,
  type,
  view,
  tmdb,
  kinoCheckKey,
  userProviders = [],
  seedItem,
  autoPlayTrailer = false,
  autoplay = true,
  onBack,
  navigate,
  isInWatchlist,
  onToggleWatchlist,
  watchedEpisodes,
  onToggleEpisode,
  isOverlay,
}) => {
  const initialCached = tmdb.peekAggregateDetails(id, type, view);

  const [detailState, setDetailState] = useState<DetailState>(() => {
    if (initialCached) {
      return {
        item: initialCached.item,
        credits: initialCached.credits || null,
        videos: initialCached.videos || [],
        providers: initialCached.providers || null,
        recommendations: initialCached.recommendations || [],
        similar: initialCached.similar || [],
        reviews: initialCached.reviews || [],
        keywords: initialCached.keywords || [],
        combinedCredits: initialCached.combinedCredits,
        externalIds: initialCached.externalIds,
        logoPath: initialCached.logoPath ?? null,
        backdrops: initialCached.backdrops || [],
        personProfiles: initialCached.personProfiles || [],
        certification: initialCached.certification ?? null,
        collectionParts: initialCached.collectionParts,
        companyMovies: initialCached.companyMovies,
        seasonDetails: initialCached.seasonDetails,
        selectedSeasonNumber: initialCached.selectedSeasonNumber,
        seasonProviders: initialCached.seasonProviders ?? null,
        loading: false,
        error: false,
      };
    }
    return {
      item: seedItem || null,
      credits: null,
      videos: [],
      providers: null,
      recommendations: [],
      similar: [],
      reviews: [],
      keywords: [],
      logoPath: seedItem?.logo_path ?? null,
      backdrops: [],
      personProfiles: [],
      certification: seedItem?.certification ?? null,
      seasonProviders: null,
      loading: true,
      error: false,
    };
  });

  const [showPlayer, setShowPlayer] = useState(false);
  const [isTrailerImmersed, setIsTrailerImmersed] = useState(false);
  const [userStoppedTrailer, setUserStoppedTrailer] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [recTab, setRecTab] = useState<'recommendations' | 'similar'>('recommendations');
  const [isRatingOpen, setIsRatingOpen] = useState(false);
  const [userRating, setUserRating] = useState(7.5);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingSuccess, setRatingSuccess] = useState(false);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  // Endpoint #8: Interactive Keyword Explorer state
  const [activeKeyword, setActiveKeyword] = useState<Keyword | null>(null);
  const [keywordItems, setKeywordItems] = useState<MediaItem[]>([]);
  const [loadingKeyword, setLoadingKeyword] = useState(false);

  // Feature #2: Interactive iOS Left-Edge Swipe-Back & Top Pull-to-Dismiss
  const rootRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    active: boolean;
    mode: 'swipe-back' | 'pull-down' | null;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
  }>({
    active: false,
    mode: null,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
  });

  const castScrollRef = useRef<HTMLDivElement>(null);
  const reviewScrollRef = useRef<HTMLDivElement>(null);
  const stillsScrollRef = useRef<HTMLDivElement>(null);

  // Track scroll container for Progressive Blurred Sticky Header (Feature #4)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const scrollParent =
      (el.closest('[data-scroll-container]') as HTMLElement | null) ||
      (el.closest('main') as HTMLElement | null);
    if (!scrollParent) return;

    const handleScroll = () => {
      setShowStickyHeader(scrollParent.scrollTop > 230);
    };
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollParent.removeEventListener('scroll', handleScroll);
  }, [id]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!onBack || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const el = rootRef.current;
    const scrollParent =
      (el?.closest('[data-scroll-container]') as HTMLElement | null) ||
      (el?.closest('main') as HTMLElement | null);
    const currentScrollTop = scrollParent ? scrollParent.scrollTop : window.scrollY;

    if (touch.clientX <= 34) {
      gestureRef.current = {
        active: true,
        mode: 'swipe-back',
        startX: touch.clientX,
        startY: touch.clientY,
        dx: 0,
        dy: 0,
      };
    } else if (currentScrollTop <= 2 && touch.clientY < 340) {
      gestureRef.current = {
        active: true,
        mode: 'pull-down',
        startX: touch.clientX,
        startY: touch.clientY,
        dx: 0,
        dy: 0,
      };
    } else {
      gestureRef.current.active = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.active || !rootRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - g.startX;
    const dy = touch.clientY - g.startY;
    g.dx = dx;
    g.dy = dy;

    if (g.mode === 'swipe-back') {
      if (dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        const progress = Math.min(1, dx / 280);
        const scale = 1 - progress * 0.04;
        rootRef.current.style.transition = 'none';
        rootRef.current.style.transform = `translate3d(${dx.toFixed(1)}px, 0, 0) scale(${scale.toFixed(3)})`;
      } else if (Math.abs(dy) > 24 && dx < 15) {
        g.active = false;
        rootRef.current.style.transform = '';
      }
    } else if (g.mode === 'pull-down') {
      if (dy > 12 && dy > Math.abs(dx) * 1.3) {
        const dampenedY = Math.pow(dy, 0.85);
        const scale = Math.max(0.88, 1 - dy / 1200);
        rootRef.current.style.transition = 'none';
        rootRef.current.style.transform = `translate3d(0, ${dampenedY.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        rootRef.current.style.borderRadius = '2rem';
      } else if (dy < -5 || Math.abs(dx) > 25) {
        g.active = false;
        rootRef.current.style.transform = '';
        rootRef.current.style.borderRadius = '';
      }
    }
  };

  const handleTouchEnd = () => {
    const g = gestureRef.current;
    if (!g.active || !rootRef.current) return;
    g.active = false;

    const shouldDismiss =
      (g.mode === 'swipe-back' && g.dx > 95) || (g.mode === 'pull-down' && g.dy > 115);

    if (shouldDismiss) {
      haptics.light();
      rootRef.current.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease';
      rootRef.current.style.transform =
        g.mode === 'swipe-back' ? 'translate3d(100vw, 0, 0)' : 'translate3d(0, 65vh, 0) scale(0.86)';
      rootRef.current.style.opacity = '0';
      setTimeout(() => {
        handleBackClick();
      }, 160);
    } else {
      rootRef.current.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
      rootRef.current.style.transform = '';
      rootRef.current.style.borderRadius = '';
    }
  };

  const scrollHorizontally = (
    ref: React.RefObject<HTMLDivElement | null>,
    dir: 'left' | 'right'
  ) => {
    if (!ref.current) return;
    const distance = Math.max(240, Math.floor(ref.current.clientWidth * 0.75));
    ref.current.scrollBy({
      left: dir === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  const loadDetails = async () => {
    setDetailState((prev) => ({ ...prev, loading: true, error: false }));
    try {
      const data = await tmdb.getAggregateDetails(id, type, view);
      let enhancedVideos = data.videos || [];

      if ((type === 'movie' || type === 'tv') && kinoCheckKey) {
        try {
          const kino = new KinoCheckService(kinoCheckKey, tmdb.getLanguage());
          const kcTrailer = await kino.getTrailer(id, type);
          if (kcTrailer && !enhancedVideos.some((v) => v.key === kcTrailer.key)) {
            enhancedVideos = [kcTrailer, ...enhancedVideos];
          }
        } catch {
          // ignore optional KinoCheck error
        }
      }

      setDetailState({
        item: data.item,
        credits: data.credits || null,
        videos: enhancedVideos,
        providers: data.providers || null,
        recommendations: data.recommendations || [],
        similar: data.similar || [],
        reviews: data.reviews || [],
        keywords: data.keywords || [],
        combinedCredits: data.combinedCredits,
        externalIds: data.externalIds,
        logoPath: data.logoPath ?? null,
        backdrops: data.backdrops || [],
        personProfiles: data.personProfiles || [],
        certification: data.certification ?? null,
        collectionParts: data.collectionParts,
        companyMovies: data.companyMovies,
        seasonDetails: data.seasonDetails,
        selectedSeasonNumber: data.selectedSeasonNumber,
        seasonProviders: data.seasonProviders ?? null,
        loading: false,
        error: false,
      });
    } catch (e) {
      console.error('Detail load failed:', e);
      setDetailState((p) => ({ ...p, loading: false, error: true }));
    }
  };

  useEffect(() => {
    let mounted = true;
    setShowPlayer(false);
    setIsTrailerImmersed(false);
    setUserStoppedTrailer(false);
    setShowAllRecommendations(false);
    setRecTab('recommendations');
    setActiveKeyword(null);
    setLightboxIndex(null);

    const cached = tmdb.peekAggregateDetails(id, type, view);
    if (cached && !kinoCheckKey) {
      setDetailState({
        item: cached.item,
        credits: cached.credits || null,
        videos: cached.videos || [],
        providers: cached.providers || null,
        recommendations: cached.recommendations || [],
        similar: cached.similar || [],
        reviews: cached.reviews || [],
        keywords: cached.keywords || [],
        combinedCredits: cached.combinedCredits,
        externalIds: cached.externalIds,
        logoPath: cached.logoPath ?? null,
        backdrops: cached.backdrops || [],
        personProfiles: cached.personProfiles || [],
        certification: cached.certification ?? null,
        collectionParts: cached.collectionParts,
        companyMovies: cached.companyMovies,
        seasonDetails: cached.seasonDetails,
        selectedSeasonNumber: cached.selectedSeasonNumber,
        seasonProviders: cached.seasonProviders ?? null,
        loading: false,
        error: false,
      });
    } else {
      if (seedItem && seedItem.id === id) {
        setDetailState((prev) => ({
          ...prev,
          item: prev.item?.id === id ? prev.item : seedItem,
          logoPath: prev.item?.id === id ? prev.logoPath : seedItem.logo_path ?? null,
          certification: prev.item?.id === id ? prev.certification : seedItem.certification ?? null,
          loading: true,
          error: false,
        }));
      }
      loadDetails();
    }

    const loadUserRating = async () => {
      if (view === AppView.DETAILS) {
        try {
          const mType = type === 'tv' ? 'tv' : 'movie';
          const states = await tmdb.getAccountStates(id, mType);
          if (mounted && states.rated && typeof states.rated === 'object') {
            setExistingRating(states.rated.value);
            setUserRating(states.rated.value);
          }
        } catch {
          // ignore
        }
      }
    };
    loadUserRating();

    return () => {
      mounted = false;
    };
  }, [id, type, view, tmdb, kinoCheckKey]);

  // Keyboard navigation for scene stills lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const backdrops = detailState.backdrops || [];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
      } else if (e.key === 'ArrowRight' && backdrops.length > 0) {
        setLightboxIndex((prev) => (prev !== null ? (prev + 1) % backdrops.length : null));
      } else if (e.key === 'ArrowLeft' && backdrops.length > 0) {
        setLightboxIndex((prev) =>
          prev !== null ? (prev - 1 + backdrops.length) % backdrops.length : null
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, detailState.backdrops]);

  const trailer =
    detailState.videos?.find((v: Video) => v.site === 'YouTube' && v.type === 'Trailer') ||
    detailState.videos?.find((v: Video) => v.site === 'YouTube');
  const trailerKey = trailer?.key;
  const isMedia = view === AppView.DETAILS;

  useEffect(() => {
    if (!isMedia || detailState.loading || !trailerKey || userStoppedTrailer) {
      return;
    }

    if (autoPlayTrailer) {
      setShowPlayer(true);
      setIsTrailerImmersed(true);
      return;
    }

    if (!autoplay) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowPlayer(true);
      setIsTrailerImmersed(true);
    }, 10000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isMedia, detailState.loading, trailerKey, autoPlayTrailer, autoplay, userStoppedTrailer, id]);

  const handleStopTrailer = () => {
    setUserStoppedTrailer(true);
    setShowPlayer(false);
    setIsTrailerImmersed(false);
  };

  const handleBackClick = () => {
    haptics.light();
    setShowPlayer(false);
    setIsTrailerImmersed(false);
    if (onBack) onBack();
  };

  // Endpoint #2: Fetch season episodes AND season-specific watch providers simultaneously
  const changeSeason = async (seasonNum: number) => {
    if (!detailState.item) return;
    haptics.selection();
    setDetailState((prev) => ({ ...prev, selectedSeasonNumber: seasonNum }));
    try {
      const [seasonData, seasonProv] = await Promise.all([
        tmdb.getSeasonDetails(detailState.item.id, seasonNum),
        tmdb.getSeasonWatchProviders(detailState.item.id, seasonNum).catch(() => null),
      ]);
      setDetailState((prev) => ({
        ...prev,
        seasonDetails: seasonData,
        selectedSeasonNumber: seasonNum,
        seasonProviders: seasonProv,
      }));
    } catch (e) {
      console.error(e);
    }
  };

  // Endpoint #8: Open Keyword Explorer
  const handleOpenKeyword = async (kw: Keyword) => {
    haptics.light();
    setActiveKeyword(kw);
    setLoadingKeyword(true);
    try {
      const mType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
      const res = await tmdb.discoverByKeyword(kw.id, mType, 1);
      setKeywordItems(res.results || []);
    } catch {
      setKeywordItems([]);
    } finally {
      setLoadingKeyword(false);
    }
  };

  const handleNativeShare = async () => {
    if (!detailState.item) return;
    const res = await shareMediaItem(detailState.item as MediaItem);
    if (res === 'copied') {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2200);
    }
  };

  const handleRate = async () => {
    if (!detailState.item) return;
    setIsSubmittingRating(true);
    const item = detailState.item as any;
    const mType: 'movie' | 'tv' = resolveMediaType(item, type) === 'tv' ? 'tv' : 'movie';
    const success = await tmdb.rateMedia(item.id, mType, userRating);
    setIsSubmittingRating(false);
    if (success) {
      haptics.success();
      setExistingRating(userRating);
      setRatingSuccess(true);
      setTimeout(() => {
        setRatingSuccess(false);
        setIsRatingOpen(false);
      }, 1200);
    }
  };

  const handleNavigation = (newItem: MediaItem) => {
    haptics.light();
    setShowPlayer(false);
    setIsTrailerImmersed(false);
    setActiveKeyword(null);
    const resolvedType = resolveMediaType(newItem);
    const targetView =
      resolvedType === 'person'
        ? AppView.PERSON
        : resolvedType === 'collection'
        ? AppView.COLLECTION
        : resolvedType === 'company'
        ? AppView.COMPANY
        : AppView.DETAILS;

    navigate(targetView, {
      id: newItem.id,
      type: resolvedType,
      seedItem: newItem,
    });
  };

  if (detailState.loading && !detailState.item) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (detailState.error && !detailState.item) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-white p-6 text-center space-y-4">
        <h2 className="text-[length:var(--fluid-h2)] font-bold">Could not load details</h2>
        <p className="text-[length:var(--fluid-body)] text-zinc-400 max-w-md">
          The requested title could not be retrieved from TMDB right now.
        </p>
        <div className="flex gap-3">
          {onBack && (
            <button
              type="button"
              onClick={handleBackClick}
              className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm"
            >
              Go Back
            </button>
          )}
          <button
            type="button"
            onClick={loadDetails}
            className="px-6 py-3 rounded-xl bg-white text-black font-bold text-sm flex items-center gap-2"
          >
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!detailState.item) return null;

  const {
    item,
    credits,
    providers,
    recommendations,
    similar = [],
    keywords = [],
    combinedCredits,
    seasonDetails,
    selectedSeasonNumber,
    seasonProviders,
    collectionParts,
    companyMovies,
    reviews,
    backdrops = [],
  } = detailState;
  const i = item as any;

  const isCollection = view === AppView.COLLECTION;
  const isPerson = view === AppView.PERSON;
  const isCompany = view === AppView.COMPANY;

  const title = i.title || i.name || 'Untitled';
  const originalTitle = i.original_title || i.original_name || null;
  const backdrop = i.backdrop_path || i.profile_path || i.poster_path;
  const poster = i.poster_path || i.profile_path || i.logo_path || i.backdrop_path;
  const isTv = type === 'tv' || i.media_type === 'tv' || Boolean(i.first_air_date);
  const director = credits?.crew?.find((c: any) => c.job === 'Director');
  const creators: CastMember[] = i.created_by || [];
  const regionCode = tmdb.getRegion();

  const logoPath = detailState.logoPath || (!isCompany ? i.logo_path : null) || null;
  const certification = detailState.certification || i.certification || null;

  const studios: Company[] = [
    ...((i as TvShowDetails).networks || []),
    ...(i.production_companies || []),
  ].filter(
    (comp, idx, arr) => comp && comp.name && arr.findIndex((c) => c.id === comp.id) === idx
  );
  const primaryStudio = studios.find((s) => s.logo_path) || studios[0] || null;

  const userProviderSet = new Set(userProviders);
  const allFlatrate = dedupProviders([
    ...(providers?.flatrate || []),
    ...((providers as any)?.free || []),
    ...((providers as any)?.ads || []),
  ]);
  const matchedUserProviders = allFlatrate.filter((p) => userProviderSet.has(p.provider_id));
  const otherFlatrateProviders = allFlatrate.filter((p) => !userProviderSet.has(p.provider_id));
  const rentBuyProviders = dedupProviders([...(providers?.rent || []), ...(providers?.buy || [])]);

  const seasonFlatrate = dedupProviders([
    ...(seasonProviders?.flatrate || []),
    ...((seasonProviders as any)?.free || []),
  ]);
  const seasonRentBuy = dedupProviders([
    ...(seasonProviders?.rent || []),
    ...(seasonProviders?.buy || []),
  ]);

  const primaryMatchedProvider = matchedUserProviders[0] || null;
  const rawTmdbLink = providers?.link || '';
  const finalDeepLink = primaryMatchedProvider
    ? getSmartProviderLink(primaryMatchedProvider.provider_name, title, rawTmdbLink)
    : otherFlatrateProviders[0]
    ? getSmartProviderLink(otherFlatrateProviders[0].provider_name, title, rawTmdbLink)
    : rawTmdbLink;

  const year = (i.release_date || i.first_air_date || '').substring(0, 4);
  const runtimeMinutes = i.runtime || i.episode_run_time?.[0] || 0;
  const runtimeStr =
    runtimeMinutes > 0 ? `${Math.floor(runtimeMinutes / 60)}h ${runtimeMinutes % 60}m` : null;
  const genreNames: string[] = (i.genres || []).slice(0, 3).map((g: any) => g.name);
  const spokenLangs: string[] = (i.spoken_languages || [])
    .map((l: any) => l.name || l.english_name)
    .filter(Boolean);
  const prodCountries: string[] =
    (i.production_countries || []).map((c: any) => c.name).filter(Boolean).length > 0
      ? (i.production_countries || []).map((c: any) => c.name).filter(Boolean)
      : i.origin_country || [];

  const activeRelatedItems =
    recTab === 'similar' && similar.length > 0
      ? similar
      : recommendations.length > 0
      ? recommendations
      : similar;

  if (showAllRecommendations) {
    return (
      <div className="min-h-screen bg-black text-white px-[var(--fluid-page-px)] pb-32 animate-fade-in">
        <div
          style={{
            paddingTop: 'max(0.85rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))',
          }}
          className="flex items-center gap-4 mb-6 sticky top-0 bg-black/85 backdrop-blur-xl z-30 pb-3.5 border-b border-white/10"
        >
          <button
            type="button"
            onClick={() => setShowAllRecommendations(false)}
            className="min-w-[42px] min-h-[42px] flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <p className="text-xs text-zinc-400 font-medium">{title}</p>
            <h2 className="text-[length:var(--fluid-h2)] font-black text-white">
              {recTab === 'similar' ? 'Ähnliche Titel' : 'Empfehlungen'}
            </h2>
          </div>
        </div>
        <TetrisGrid
          items={activeRelatedItems}
          tmdb={tmdb}
          onClick={(recItem) => {
            setShowAllRecommendations(false);
            handleNavigation(recItem);
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative bg-black min-h-screen pb-36 overflow-x-hidden text-zinc-100 font-sans selection:bg-indigo-500/30 will-change-transform ${
        isOverlay ? 'pt-0' : 'animate-fade-in'
      }`}
    >
      {/* --- SAFE-AREA TOP NAV + PROGRESSIVE BLURRED STICKY HEADER (Feature #4) --- */}
      <div
        style={{
          paddingTop: 'max(0.75rem, calc(env(safe-area-inset-top) + 0.4rem))',
          paddingInline: 'var(--fluid-page-px)',
        }}
        className={`fixed top-0 left-0 w-full z-50 flex justify-between items-center pb-2.5 transition-all duration-300 ${
          showStickyHeader
            ? 'bg-black/80 backdrop-blur-2xl border-b border-white/10 shadow-xl'
            : 'pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={handleBackClick}
          aria-label="Go Back"
          className="pointer-events-auto min-w-[42px] min-h-[42px] flex items-center justify-center bg-black/60 backdrop-blur-xl p-2.5 rounded-full hover:bg-white/15 transition-all border border-white/15 text-white group shadow-lg active:scale-95"
        >
          <ChevronLeft size={22} className="group-hover:-translate-x-0.5 transition-transform" />
        </button>

        {showStickyHeader && (
          <div className="flex-1 px-3 text-center truncate">
            <span className="text-sm font-black text-white truncate">{title}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pointer-events-auto">
          {showPlayer && trailerKey && (
            <button
              type="button"
              onClick={handleStopTrailer}
              className="bg-black/70 backdrop-blur-xl px-4 py-2 rounded-full text-white hover:bg-white hover:text-black font-bold text-xs sm:text-sm transition-all border border-white/15 flex items-center gap-2 shadow-2xl"
            >
              <X size={15} /> Stop Trailer
            </button>
          )}

          {/* Feature #10: Native iOS Share Sheet Button */}
          <button
            type="button"
            onClick={handleNativeShare}
            aria-label="Teilen"
            title="Teilen"
            className="min-w-[42px] min-h-[42px] flex items-center justify-center bg-black/60 backdrop-blur-xl p-2.5 rounded-full hover:bg-white/15 transition-all border border-white/15 text-white shadow-lg active:scale-95"
          >
            <Share2 size={18} />
          </button>
        </div>
      </div>

      {/* --- HERO / VIDEO SECTION --- */}
      <div className="absolute inset-0 h-[76dvh] sm:h-[82dvh] overflow-hidden">
        {showPlayer && trailerKey ? (
          <div className="w-full h-full bg-black relative">
            <iframe
              className="w-full h-full"
              src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&rel=0&modestbranding=1`}
              title="Trailer"
              allow="autoplay; encrypted-media"
              allowFullScreen
              style={{ border: 0 }}
            />
            <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
          </div>
        ) : (
          <>
            <SafeImage
              src={tmdb.getImageUrl(backdrop, 'w1280')}
              fallbackTitle={title}
              className="w-full h-full object-cover object-top opacity-60 mask-image-b-fade"
              loading="eager"
            />
            <div className="absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60" />
          </>
        )}
        <div
          className={`absolute inset-0 bg-gradient-to-b from-transparent via-black to-black top-[48dvh] transition-opacity duration-700 pointer-events-none ${
            showPlayer && isTrailerImmersed ? 'opacity-20' : 'opacity-100'
          }`}
        />
      </div>

      {/* --- MAIN CONTENT --- */}
      <div className="relative z-10 px-[var(--fluid-page-px)] max-w-[1800px] mx-auto pt-[20dvh] sm:pt-[32dvh] md:pt-[40dvh]">
        {/* Hero Info Block */}
        <div
          className={`flex flex-col md:flex-row gap-6 md:gap-12 items-center md:items-end transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            showPlayer && isTrailerImmersed
              ? 'opacity-0 scale-[0.97] pointer-events-none select-none'
              : 'opacity-100 scale-100'
          }`}
        >
          {/* Fluid Poster */}
          <div
            id="detail-poster"
            style={{ width: 'clamp(124px, 32vw, 256px)' }}
            className="flex-shrink-0 aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-900 shadow-[0_35px_70px_-15px_rgba(0,0,0,0.85)] relative z-20 mx-auto md:mx-0"
          >
            <SafeImage
              src={tmdb.getImageUrl(poster, 'w500')}
              fallbackTitle={title}
              mediaType={type}
              className="w-full h-full object-cover"
              loading="eager"
            />
          </div>

          {/* Fluid Title & Metadata */}
          <div className="flex-1 w-full space-y-4 md:mb-2 text-center md:text-left">
            <div>
              {logoPath && !isPerson && !isCompany ? (
                <div className="mb-3 flex justify-center md:justify-start">
                  <img
                    src={tmdb.getImageUrl(logoPath, 'w500')}
                    alt={title}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    style={{
                      maxHeight: 'clamp(3.4rem, 12dvh, 7.5rem)',
                      maxWidth: 'min(84%, 460px)',
                    }}
                    className="w-auto object-contain drop-shadow-[0_14px_32px_rgba(0,0,0,0.95)] select-none"
                  />
                  <h1 className="sr-only">{title}</h1>
                </div>
              ) : (
                <h1
                  style={{
                    fontSize: 'var(--fluid-h1)',
                    textWrap: 'balance',
                  }}
                  className="font-black tracking-tight text-white leading-[1.05] drop-shadow-2xl mb-2.5 font-display"
                >
                  {title}
                </h1>
              )}

              {/* Metadata Line (Frameless Apple TV+ Editorial Row) */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-[clamp(0.75rem,2.1vw,0.875rem)] font-semibold text-zinc-300 tabular-nums">
                {isCollection && <span className="text-indigo-400">Film Collection</span>}
                {i.vote_average > 0 && (
                  <>
                    {isCollection && <span aria-hidden="true">·</span>}
                    <span className="inline-flex items-center gap-1 text-yellow-400 font-bold">
                      <Star size={13} fill="currentColor" /> {i.vote_average.toFixed(1)}
                    </span>
                  </>
                )}
                {year && (
                  <>
                    {(isCollection || i.vote_average > 0) && <span aria-hidden="true">·</span>}
                    <span>{year}</span>
                  </>
                )}
                {certification && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-zinc-100 font-bold">{certification}</span>
                  </>
                )}
                {runtimeStr && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{runtimeStr}</span>
                  </>
                )}
                {genreNames.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-zinc-400">{genreNames.join(' / ')}</span>
                  </>
                )}
                {primaryStudio && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigation({
                          id: primaryStudio.id,
                          name: primaryStudio.name,
                          logo_path: primaryStudio.logo_path,
                          media_type: 'company',
                        })
                      }
                      className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors"
                    >
                      {primaryStudio.logo_path ? (
                        <img
                          src={tmdb.getImageUrl(primaryStudio.logo_path, 'w200')}
                          alt={primaryStudio.name}
                          referrerPolicy="no-referrer"
                          className="h-3.5 sm:h-4 w-auto object-contain brightness-0 invert opacity-85 hover:opacity-100 transition-opacity"
                        />
                      ) : (
                        <span className="font-semibold">{primaryStudio.name}</span>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Fluid Action Bar */}
            {isMedia && (
              <div className="flex flex-wrap justify-center md:justify-start gap-2.5 pt-1">
                {trailerKey && (
                  <button
                    type="button"
                    onClick={() => {
                      haptics.medium();
                      setUserStoppedTrailer(false);
                      setShowPlayer(true);
                      setIsTrailerImmersed(true);
                    }}
                    style={{
                      height: 'clamp(2.6rem, 6dvh, 3.25rem)',
                      paddingInline: 'clamp(1rem, 3.5vw, 1.65rem)',
                      fontSize: 'clamp(0.75rem, 2.1vw, 0.9rem)',
                    }}
                    className="group bg-white text-black rounded-xl font-bold transition-all active:scale-95 flex items-center gap-2 shadow-xl whitespace-nowrap shrink-0"
                  >
                    <Play size={16} fill="currentColor" />
                    <span>Play Trailer</span>
                  </button>
                )}

                {finalDeepLink && (
                  <a
                    href={finalDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => haptics.light()}
                    style={{
                      height: 'clamp(2.6rem, 6dvh, 3.25rem)',
                      paddingInline: 'clamp(0.95rem, 3.2vw, 1.5rem)',
                      fontSize: 'clamp(0.75rem, 2.1vw, 0.9rem)',
                    }}
                    className={`group rounded-xl font-bold transition-all active:scale-95 flex items-center gap-2 backdrop-blur-md shadow-lg border whitespace-nowrap shrink-0 ${
                      primaryMatchedProvider
                        ? 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400'
                        : 'bg-white/10 border-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <ExternalLink size={16} />
                    <span>
                      {primaryMatchedProvider
                        ? `Stream in ${primaryMatchedProvider.provider_name}`
                        : otherFlatrateProviders[0]
                        ? `Stream on ${otherFlatrateProviders[0].provider_name}`
                        : 'Watch Options'}
                    </span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => {
                    haptics.medium();
                    onToggleWatchlist({ ...(item as MediaItem), media_type: isTv ? 'tv' : 'movie' });
                  }}
                  style={{
                    height: 'clamp(2.6rem, 6dvh, 3.25rem)',
                    paddingInline: 'clamp(0.9rem, 3vw, 1.35rem)',
                    fontSize: 'clamp(0.75rem, 2.1vw, 0.9rem)',
                  }}
                  className={`group rounded-xl font-bold border transition-all active:scale-95 flex items-center gap-2 backdrop-blur-md whitespace-nowrap shrink-0 ${
                    isInWatchlist
                      ? 'bg-green-500/20 border-green-500/50 text-green-300'
                      : 'bg-white/10 border-white/10 hover:bg-white/20 text-white'
                  }`}
                >
                  {isInWatchlist ? <Check size={16} /> : <Plus size={16} />}
                  <span>{isInWatchlist ? 'In Watchlist' : 'Watchlist'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptics.light();
                    setIsRatingOpen(true);
                  }}
                  aria-label="Rate title"
                  style={{
                    height: 'clamp(2.6rem, 6dvh, 3.25rem)',
                    width: 'clamp(2.6rem, 6dvh, 3.25rem)',
                  }}
                  className={`rounded-xl font-bold border flex items-center justify-center transition-all active:scale-95 backdrop-blur-md shrink-0 ${
                    existingRating
                      ? 'bg-yellow-500 text-black border-yellow-500'
                      : 'bg-white/10 border-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <Star size={16} fill={existingRating ? 'currentColor' : 'none'} />
                </button>

                {/* Feature #10: Native Share Action */}
                <button
                  type="button"
                  onClick={handleNativeShare}
                  aria-label="Share title"
                  style={{
                    height: 'clamp(2.6rem, 6dvh, 3.25rem)',
                    paddingInline: 'clamp(0.75rem, 2.5vw, 1.1rem)',
                  }}
                  className="rounded-xl font-bold border border-white/10 bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-1.5 transition-all active:scale-95 backdrop-blur-md shrink-0 text-xs"
                >
                  <Share2 size={15} />
                  {shareCopied && <span>Kopiert!</span>}
                </button>
              </div>
            )}

            {/* --- BORDERLESS SUBSCRIPTION STATUS --- */}
            {isMedia && !detailState.loading && (
              <div className="pt-1.5">
                {matchedUserProviders.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                    <div className="flex items-center gap-1.5 text-emerald-400 text-[clamp(0.75rem,2vw,0.875rem)] font-bold drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                      <Check size={15} strokeWidth={3.5} />
                      <span>In deinem Abo enthalten ({regionCode}):</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      {matchedUserProviders.map((p) => (
                        <a
                          key={p.provider_id}
                          href={getSmartProviderLink(p.provider_name, title, rawTmdbLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 transition-transform active:scale-95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
                        >
                          <SafeImage
                            src={tmdb.getImageUrl(p.logo_path, 'w200')}
                            fallbackTitle={p.provider_name}
                            className="w-5 h-5 sm:w-6 sm:h-6 rounded-md object-cover shadow-md"
                          />
                          <span className="text-[clamp(0.75rem,2vw,0.875rem)] font-bold text-white hover:text-emerald-300 transition-colors">
                            {p.provider_name}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : otherFlatrateProviders.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                    <span className="text-zinc-300 text-[clamp(0.75rem,2vw,0.875rem)] font-medium drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                      Streambar in <strong className="text-white font-bold">{regionCode}</strong> bei:
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      {otherFlatrateProviders.slice(0, 5).map((p) => (
                        <a
                          key={p.provider_id}
                          href={getSmartProviderLink(p.provider_name, title, rawTmdbLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 transition-transform active:scale-95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
                        >
                          <SafeImage
                            src={tmdb.getImageUrl(p.logo_path, 'w200')}
                            fallbackTitle={p.provider_name}
                            className="w-5 h-5 sm:w-6 sm:h-6 rounded-md object-cover shadow-md"
                          />
                          <span className="text-[clamp(0.75rem,2vw,0.875rem)] font-bold text-white hover:text-accent transition-colors">
                            {p.provider_name}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : rentBuyProviders.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                    <span className="text-zinc-300 text-[clamp(0.75rem,2vw,0.875rem)] font-medium drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                      Zum Leihen/Kaufen in <strong className="text-white">{regionCode}</strong> bei:
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      {rentBuyProviders.slice(0, 4).map((p) => (
                        <a
                          key={p.provider_id}
                          href={getSmartProviderLink(p.provider_name, title, rawTmdbLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 transition-transform active:scale-95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
                        >
                          <SafeImage
                            src={tmdb.getImageUrl(p.logo_path, 'w200')}
                            fallbackTitle={p.provider_name}
                            className="w-5 h-5 rounded-md object-cover shadow-md"
                          />
                          <span className="text-[clamp(0.75rem,2vw,0.875rem)] font-semibold text-white">
                            {p.provider_name}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 text-zinc-400 text-[clamp(0.75rem,2vw,0.875rem)] font-medium drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
                    <AlertCircle size={14} className="text-zinc-400" />
                    <span>
                      Derzeit bei keinem Streaming-Anbieter in{' '}
                      <strong className="text-zinc-200">{regionCode}</strong> gelistet.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="w-full h-px bg-white/10 my-8 md:my-12" />

        {/* Overview & Editorial Info Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 md:gap-16 min-w-0">
          <div className="lg:col-span-2 space-y-12 min-w-0">
            {/* Synopsis */}
            {(i.overview || i.biography || i.description) && (
              <div className="space-y-2.5">
                {i.tagline && (
                  <p className="text-zinc-400 italic text-sm sm:text-base font-medium">
                    „{i.tagline}“
                  </p>
                )}
                <h3 className="text-white font-bold text-[length:var(--fluid-h2)]">
                  {isPerson ? 'Biografie' : 'Handlung'}
                </h3>
                <p className="text-zinc-300 leading-relaxed text-[length:var(--fluid-body)] font-normal max-w-[72ch] whitespace-pre-line">
                  {i.overview || i.biography || i.description}
                </p>
              </div>
            )}

            {/* Cast Rail — Native 60fps iOS Touch Momentum Rail + Aggregate Episode Counts (Endpoint #3) */}
            {detailState.loading && !credits ? (
              <div className="space-y-3 min-w-0">
                <div className="h-6 w-32 cinema-shimmer rounded" />
                <div className="flex gap-3 overflow-hidden">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{ width: 'clamp(96px, 25vw, 144px)' }}
                      className="aspect-[2/3] rounded-2xl cinema-shimmer flex-shrink-0"
                    />
                  ))}
                </div>
              </div>
            ) : (
              credits &&
              credits.cast &&
              credits.cast.length > 0 && (
                <div className="space-y-4 min-w-0 pt-2 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between gap-4 pt-4">
                    <h3 className="text-white font-bold text-[length:var(--fluid-h2)]">
                      {isTv ? 'Gesamte Serien-Besetzung & Crew' : 'Besetzung & Crew'}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => scrollHorizontally(castScrollRef, 'left')}
                        aria-label="Scroll Cast Left"
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollHorizontally(castScrollRef, 'right')}
                        aria-label="Scroll Cast Right"
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div
                    ref={castScrollRef}
                    className="flex gap-[clamp(0.65rem,2.4vw,1rem)] overflow-x-auto pb-3 no-scrollbar ios-touch-rail ios-snap-rail w-full"
                  >
                    {credits.cast.slice(0, 24).map((person: CastMember) => (
                      <div
                        key={person.id}
                        onClick={() =>
                          handleNavigation({
                            id: person.id,
                            name: person.name,
                            profile_path: person.profile_path,
                            media_type: 'person',
                          })
                        }
                        onMouseEnter={() =>
                          tmdb.preloadDetails(person.id, 'person', AppView.PERSON)
                        }
                        style={{ width: 'clamp(96px, 25vw, 144px)' }}
                        className="flex-shrink-0 group cursor-pointer active:scale-[0.97] transition-transform duration-150 ios-snap-card"
                      >
                        <div className="w-full aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-900 mb-2 relative shadow-lg">
                          <SafeImage
                            src={tmdb.getImageUrl(person.profile_path, 'w500')}
                            fallbackTitle={person.name}
                            mediaType="person"
                            className="w-full h-full object-cover"
                          />
                          {person.total_episode_count && person.total_episode_count > 0 && (
                            <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-md border border-white/15 text-[9px] font-black text-amber-400 tabular-nums">
                              {person.total_episode_count} Flg.
                            </span>
                          )}
                        </div>
                        <div className="text-[clamp(0.75rem,2.1vw,0.875rem)] font-bold text-white group-hover:text-accent transition-colors truncate">
                          {person.name}
                        </div>
                        <div className="text-[clamp(0.68rem,1.8vw,0.75rem)] text-zinc-400 truncate">
                          {person.character}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* Szenenbilder / Star-Porträts (#9) / 4K Collection Key-Art (#10) */}
            {backdrops.length > 0 && (
              <div className="space-y-4 min-w-0 pt-2 border-t border-white/[0.08]">
                <div className="flex items-center justify-between gap-4 pt-4">
                  <div className="flex items-baseline gap-2.5 tabular-nums">
                    <h3 className="text-white font-bold text-[length:var(--fluid-h2)]">
                      {isPerson
                        ? 'Star-Porträts & Fotogalerie'
                        : isCollection
                        ? '4K Collection Key-Art'
                        : 'Szenenbilder & Einblicke'}
                    </h3>
                    <span className="text-xs font-semibold text-zinc-500">
                      {backdrops.length} Aufnahmen
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => scrollHorizontally(stillsScrollRef, 'left')}
                      aria-label="Scroll Stills Left"
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollHorizontally(stillsScrollRef, 'right')}
                      aria-label="Scroll Stills Right"
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div
                  ref={stillsScrollRef}
                  className="flex gap-3.5 md:gap-4 overflow-x-auto pb-3 no-scrollbar ios-touch-rail ios-snap-rail w-full"
                >
                  {backdrops.map((still, idx) => (
                    <button
                      type="button"
                      key={still.file_path}
                      onClick={() => {
                        haptics.light();
                        setLightboxIndex(idx);
                      }}
                      style={{
                        width: isPerson
                          ? 'clamp(130px, 34vw, 195px)'
                          : 'clamp(220px, 62vw, 360px)',
                      }}
                      className={`flex-shrink-0 ${
                        isPerson ? 'aspect-[2/3]' : 'aspect-video'
                      } rounded-2xl overflow-hidden bg-zinc-900 relative group cursor-pointer active:scale-[0.98] transition-transform shadow-lg ios-snap-card`}
                    >
                      <SafeImage
                        src={tmdb.getImageUrl(still.file_path, 'w780')}
                        fallbackTitle={`${title} ${idx + 1}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Seasons & Episodes — Frameless Apple TV+ Editorial List + Season Watch Providers (Endpoint #2) */}
            {isTv && (i as TvShowDetails).seasons && (
              <div className="space-y-4 pt-2 border-t border-white/[0.08]">
                <div className="flex items-center justify-between gap-3 pt-4">
                  <h3 className="text-white font-bold text-[length:var(--fluid-h2)]">Episoden</h3>

                  <div className="relative">
                    <select
                      value={selectedSeasonNumber}
                      onChange={(e) => changeSeason(Number(e.target.value))}
                      className="appearance-none bg-white/[0.06] border border-white/10 hover:bg-white/[0.12] text-white pl-3.5 pr-9 py-2 rounded-full font-bold text-[clamp(0.75rem,2.1vw,0.875rem)] focus:outline-none focus:border-white/30 cursor-pointer transition-colors"
                    >
                      {(i as TvShowDetails).seasons.map((s) => (
                        <option
                          key={s.id}
                          value={s.season_number}
                          className="bg-zinc-900 text-white"
                        >
                          {s.name} ({s.episode_count})
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                      size={15}
                    />
                  </div>
                </div>

                {/* Endpoint #2: Staffel-spezifische Streaming-Anbieter (/tv/{id}/season/{season_number}/watch/providers) */}
                {(seasonFlatrate.length > 0 || seasonRentBuy.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-2xl bg-white/[0.04] border border-white/10">
                    <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
                      Staffel {selectedSeasonNumber} in {regionCode}:
                    </span>
                    {seasonFlatrate.length > 0 ? (
                      <>
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                          Im Abo
                        </span>
                        {seasonFlatrate.slice(0, 6).map((p) => (
                          <a
                            key={`sp-flat-${p.provider_id}`}
                            href={getSmartProviderLink(p.provider_name, title, rawTmdbLink)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white hover:text-emerald-400 transition-colors"
                          >
                            <img
                              src={tmdb.getImageUrl(p.logo_path, 'w200')}
                              alt={p.provider_name}
                              className="w-5 h-5 rounded-md border border-white/15"
                            />
                            <span>{p.provider_name}</span>
                          </a>
                        ))}
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-md">
                          Kaufen / Leihen
                        </span>
                        {seasonRentBuy.slice(0, 5).map((p) => (
                          <a
                            key={`sp-buy-${p.provider_id}`}
                            href={getSmartProviderLink(p.provider_name, title, rawTmdbLink)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white"
                          >
                            <img
                              src={tmdb.getImageUrl(p.logo_path, 'w200')}
                              alt={p.provider_name}
                              className="w-5 h-5 rounded-md border border-white/15"
                            />
                            <span>{p.provider_name}</span>
                          </a>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {seasonDetails && seasonDetails.episodes && (
                  <div className="divide-y divide-white/[0.08]">
                    {seasonDetails.episodes.map((ep: any) => {
                      const isWatched = watchedEpisodes.includes(ep.id);
                      return (
                        <div
                          key={ep.id}
                          onClick={() => {
                            haptics.light();
                            onToggleEpisode(ep.id);
                          }}
                          className="flex gap-4 py-4 first:pt-1 last:pb-1 group cursor-pointer transition-opacity active:opacity-80"
                        >
                          <div
                            style={{ width: 'clamp(112px, 30vw, 168px)' }}
                            className="aspect-video bg-zinc-900 rounded-xl overflow-hidden flex-shrink-0 relative shadow-md"
                          >
                            <SafeImage
                              src={tmdb.getImageUrl(ep.still_path, 'w300')}
                              fallbackTitle={`Folge ${ep.episode_number}`}
                              mediaType="tv"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div
                              className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                isWatched
                                  ? 'bg-emerald-500 text-black shadow-md'
                                  : 'bg-black/60 text-white/70 border border-white/20 opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              <Check size={13} strokeWidth={3.5} />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex items-center gap-2 mb-0.5 tabular-nums text-xs text-zinc-400 font-semibold">
                              <span className="text-zinc-200 font-bold">
                                Folge {ep.episode_number}
                              </span>
                              {ep.runtime && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{ep.runtime} Min.</span>
                                </>
                              )}
                              {ep.air_date && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{ep.air_date.substring(0, 4)}</span>
                                </>
                              )}
                            </div>
                            <h4 className="text-[clamp(0.85rem,2.3vw,1rem)] font-bold text-white leading-snug mb-1 group-hover:text-zinc-200 transition-colors line-clamp-1">
                              {ep.name}
                            </h4>
                            <p className="text-[clamp(0.75rem,1.9vw,0.85rem)] text-zinc-400 line-clamp-2 leading-relaxed">
                              {ep.overview}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Frameless Apple TV+ "Informationen" Column */}
          <div className="space-y-6 min-w-0">
            <div className="pt-2 lg:pt-0">
              <h3 className="text-white font-bold text-[length:var(--fluid-h2)] mb-4">
                Informationen
              </h3>

              <dl className="divide-y divide-white/[0.08] border-t border-b border-white/[0.08] tabular-nums text-sm">
                {studios.length > 0 && (
                  <div className="py-3.5 flex flex-col gap-2">
                    <dt className="text-xs font-medium text-zinc-500">
                      {isTv ? 'Sender & Produktion' : 'Studio'}
                    </dt>
                    <dd className="flex flex-wrap items-center gap-4">
                      {studios.slice(0, 3).map((studio) => (
                        <button
                          key={studio.id}
                          type="button"
                          onClick={() =>
                            handleNavigation({
                              id: studio.id,
                              name: studio.name,
                              logo_path: studio.logo_path,
                              media_type: 'company',
                            })
                          }
                          className="inline-flex items-center gap-2 text-left text-white hover:text-zinc-300 transition-colors"
                        >
                          {studio.logo_path ? (
                            <img
                              src={tmdb.getImageUrl(studio.logo_path, 'w200')}
                              alt={studio.name}
                              referrerPolicy="no-referrer"
                              className="h-5 w-auto max-w-[110px] object-contain brightness-0 invert opacity-90 hover:opacity-100 transition-opacity"
                            />
                          ) : (
                            <span className="font-semibold text-zinc-200">{studio.name}</span>
                          )}
                        </button>
                      ))}
                    </dd>
                  </div>
                )}

                {director && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Regie</dt>
                    <dd className="text-zinc-200 font-semibold text-right">{director.name}</dd>
                  </div>
                )}

                {creators.length > 0 && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Schöpfer</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      {creators.map((c) => c.name).join(', ')}
                    </dd>
                  </div>
                )}

                {certification && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Altersfreigabe</dt>
                    <dd className="text-zinc-200 font-bold text-right">{certification}</dd>
                  </div>
                )}

                {originalTitle && originalTitle !== title && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Originaltitel</dt>
                    <dd className="text-zinc-200 font-semibold text-right truncate max-w-[65%]">
                      {originalTitle}
                    </dd>
                  </div>
                )}

                {(year || i.status) && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Veröffentlichung</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      {[year, i.status].filter(Boolean).join(' · ')}
                    </dd>
                  </div>
                )}

                {spokenLangs.length > 0 && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Sprachen</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      {spokenLangs.slice(0, 3).join(', ')}
                    </dd>
                  </div>
                )}

                {prodCountries.length > 0 && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Herkunft</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      {prodCountries.slice(0, 2).join(', ')}
                    </dd>
                  </div>
                )}

                {i.budget > 0 && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Budget</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      ${(i.budget / 1000000).toFixed(1)} Mio.
                    </dd>
                  </div>
                )}

                {i.revenue > 0 && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Einspielergebnis</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      ${(i.revenue / 1000000).toFixed(1)} Mio.
                    </dd>
                  </div>
                )}

                {isPerson && i.birthday && (
                  <div className="py-3.5 flex justify-between items-baseline gap-4">
                    <dt className="text-xs font-medium text-zinc-500 shrink-0">Geboren</dt>
                    <dd className="text-zinc-200 font-semibold text-right">
                      {i.birthday} {i.place_of_birth ? `· ${i.place_of_birth}` : ''}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Endpoint #8: Interactive Keyword Explorer Tags (/discover/{type}?with_keywords={id}) */}
              {keywords.length > 0 && (
                <div className="pt-5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 mb-2.5">
                    <Tag size={12} />
                    <span>Themen & Motive entdecken</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {keywords.slice(0, 12).map((kw) => (
                      <button
                        key={kw.id}
                        type="button"
                        onClick={() => handleOpenKeyword(kw)}
                        className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-amber-500/20 border border-white/10 hover:border-amber-500/40 text-xs font-semibold text-zinc-300 hover:text-amber-300 transition-all active:scale-95"
                      >
                        #{kw.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collection Banner */}
        {(i as MovieDetails).belongs_to_collection && (
          <div className="mt-12">
            <div
              onClick={() =>
                handleNavigation({
                  id: (i as MovieDetails).belongs_to_collection!.id,
                  name: (i as MovieDetails).belongs_to_collection!.name,
                  backdrop_path: (i as MovieDetails).belongs_to_collection!.backdrop_path,
                  poster_path: (i as MovieDetails).belongs_to_collection!.poster_path,
                  media_type: 'collection',
                })
              }
              onMouseEnter={() =>
                tmdb.preloadDetails(
                  (i as MovieDetails).belongs_to_collection!.id,
                  'collection',
                  AppView.COLLECTION
                )
              }
              style={{ height: 'clamp(190px, 32dvh, 280px)' }}
              className="cursor-pointer relative rounded-3xl overflow-hidden group shadow-2xl bg-zinc-900 active:scale-[0.99] transition-transform"
            >
              <SafeImage
                src={tmdb.getImageUrl(
                  (i as MovieDetails).belongs_to_collection!.backdrop_path,
                  'w1280'
                )}
                fallbackTitle={(i as MovieDetails).belongs_to_collection!.name}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/55 group-hover:bg-black/40 transition-colors flex flex-col items-center justify-center p-5 text-center">
                <span className="text-zinc-300 text-xs font-semibold mb-1.5">
                  Part of the Collection
                </span>
                <h3 className="text-[length:var(--fluid-h1)] font-black text-white mb-4 drop-shadow-xl">
                  {(i as MovieDetails).belongs_to_collection!.name}
                </h3>
                <div className="bg-white text-black px-5 py-2 rounded-xl font-bold text-xs sm:text-sm">
                  Explore Collection
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collection Parts / Known For / Studio Movies */}
        {((isCollection && collectionParts) ||
          (isPerson && combinedCredits) ||
          (isCompany && companyMovies)) && (
          <div className="mt-12 space-y-5">
            <h3 className="text-white font-bold text-[length:var(--fluid-h2)]">
              {isPerson
                ? 'Known For'
                : isCollection
                ? 'Movies in Collection'
                : 'Studio Releases'}
            </h3>
            <TetrisGrid
              items={collectionParts || combinedCredits || companyMovies || []}
              tmdb={tmdb}
              onClick={(subItem) => handleNavigation(subItem)}
            />
          </div>
        )}

        {/* Reviews — Frameless Editorial Quotes Rail */}
        {reviews && reviews.length > 0 && (
          <div className="mt-12 pt-8 border-t border-white/[0.08] space-y-5 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-[length:var(--fluid-h2)] flex items-center gap-2 tabular-nums">
                <span>Stimmen & Kritiken</span>
                <span className="text-sm font-semibold text-zinc-500">· {reviews.length}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollHorizontally(reviewScrollRef, 'left')}
                  aria-label="Scroll Reviews Left"
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollHorizontally(reviewScrollRef, 'right')}
                  aria-label="Scroll Reviews Right"
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div
              ref={reviewScrollRef}
              className="flex gap-6 md:gap-8 overflow-x-auto pb-4 no-scrollbar ios-touch-rail w-full"
            >
              {reviews.map((review) => {
                const isExpanded = expandedReviewId === review.id;
                return (
                  <div
                    key={review.id}
                    onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                    style={{ width: 'clamp(260px, 76vw, 400px)' }}
                    className={`flex-shrink-0 border-l border-white/15 pl-5 py-1 transition-all cursor-pointer ${
                      isExpanded ? 'h-auto' : 'h-48 flex flex-col justify-between'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-2 tabular-nums">
                        <div className="font-bold text-white text-sm truncate">
                          {review.author}
                        </div>
                        {review.author_details.rating && (
                          <div className="flex items-center gap-1 text-yellow-400 text-xs font-semibold shrink-0">
                            <Star size={11} fill="currentColor" /> {review.author_details.rating}/10
                          </div>
                        )}
                      </div>
                      <div
                        className={`text-zinc-300 text-[clamp(0.75rem,2.1vw,0.875rem)] leading-relaxed ${
                          isExpanded ? '' : 'line-clamp-4'
                        }`}
                      >
                        {review.content}
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-zinc-400 hover:text-white mt-2">
                      {isExpanded ? 'Weniger anzeigen' : 'Weiterlesen'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Endpoint #1: Recommendations vs. Similar Titles Segmented Rail (/{type}/{id}/similar) */}
        {(recommendations.length > 0 || similar.length > 0) && (
          <div className="mt-12 pt-8 border-t border-white/[0.08]">
            {recommendations.length > 0 && similar.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => {
                    haptics.selection();
                    setRecTab('recommendations');
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-black tracking-wide transition-all ${
                    recTab === 'recommendations'
                      ? 'bg-white text-black shadow-lg'
                      : 'bg-white/[0.06] text-zinc-400 hover:text-white'
                  }`}
                >
                  Empfehlungen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptics.selection();
                    setRecTab('similar');
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-black tracking-wide transition-all ${
                    recTab === 'similar'
                      ? 'bg-white text-black shadow-lg'
                      : 'bg-white/[0.06] text-zinc-400 hover:text-white'
                  }`}
                >
                  Ähnliche Titel
                </button>
              </div>
            )}
            <SmartRow
              title={recTab === 'similar' ? 'Thematisch ähnliche Titel' : 'Das könnte dir auch gefallen'}
              queryKey={`rec:${recTab}:${type}:${id}`}
              initialItems={activeRelatedItems}
              fetcher={() =>
                Promise.resolve({
                  page: 1,
                  results: activeRelatedItems,
                  total_pages: 1,
                  total_results: activeRelatedItems.length,
                })
              }
              tmdb={tmdb}
              onClick={handleNavigation}
              onSeeAll={() => setShowAllRecommendations(true)}
            />
          </div>
        )}
      </div>

      {/* Endpoint #8: Interactive Keyword Explorer Modal (/discover/{type}?with_keywords={id}) */}
      {activeKeyword && (
        <div
          onClick={() => setActiveKeyword(null)}
          className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-2xl overflow-y-auto px-[var(--fluid-page-px)] pb-24 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-6xl mx-auto pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))]"
          >
            <div className="flex items-center justify-between gap-4 pb-4 mb-6 border-b border-white/10 sticky top-0 bg-black/80 backdrop-blur-xl z-20 pt-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Tag size={16} />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                    Themen-Explorer
                  </span>
                  <h3 className="text-lg sm:text-xl font-black text-white">
                    #{activeKeyword.name}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveKeyword(null)}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X size={18} />
              </button>
            </div>

            {loadingKeyword ? (
              <div className="py-20 flex justify-center">
                <div className="w-9 h-9 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : keywordItems.length > 0 ? (
              <TetrisGrid
                items={keywordItems}
                tmdb={tmdb}
                onClick={(kwItem) => {
                  setActiveKeyword(null);
                  handleNavigation(kwItem);
                }}
              />
            ) : (
              <p className="text-center text-zinc-400 py-16">
                Keine weiteren Titel für dieses Schlagwort gefunden.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox for Scene Stills (Szenenbilder) */}
      {lightboxIndex !== null && backdrops[lightboxIndex] && (
        <div
          onClick={() => setLightboxIndex(null)}
          className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-4 sm:p-8 animate-fade-in select-none"
        >
          <div
            style={{
              top: 'max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.65rem))',
            }}
            className="absolute right-5 left-5 flex items-center justify-between z-20 pointer-events-none"
          >
            <span className="text-xs sm:text-sm font-semibold text-zinc-400 tabular-nums">
              {lightboxIndex + 1} / {backdrops.length}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(null);
              }}
              aria-label="Close Lightbox"
              className="pointer-events-auto w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl aspect-video flex items-center justify-center"
          >
            <img
              src={tmdb.getImageUrl(backdrops[lightboxIndex].file_path, 'w1280')}
              alt={`${title} Szene ${lightboxIndex + 1}`}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[82dvh] rounded-2xl object-contain shadow-2xl"
            />

            {backdrops.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setLightboxIndex((lightboxIndex - 1 + backdrops.length) % backdrops.length)
                  }
                  aria-label="Previous Scene"
                  className="absolute left-3 sm:left-5 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white flex items-center justify-center backdrop-blur-xl transition-all active:scale-95"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxIndex((lightboxIndex + 1) % backdrops.length)}
                  aria-label="Next Scene"
                  className="absolute right-3 sm:right-5 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white flex items-center justify-center backdrop-blur-xl transition-all active:scale-95"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Rating Modal */}
      {isRatingOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl p-6 sm:p-8 w-full max-w-md text-center relative shadow-2xl">
            <button
              type="button"
              onClick={() => setIsRatingOpen(false)}
              className="absolute top-5 right-5 text-zinc-500 hover:text-white"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-bold text-white mb-1">Rate This Title</h3>
            <p className="text-zinc-400 text-sm mb-6 line-clamp-1">{title}</p>

            {ratingSuccess ? (
              <div className="py-8 flex flex-col items-center animate-fade-in">
                <div className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center text-black mb-3">
                  <Check size={28} strokeWidth={4} />
                </div>
                <span className="text-lg font-bold text-white">Saved</span>
              </div>
            ) : (
              <>
                <div className="text-5xl sm:text-6xl font-black text-accent mb-6 font-mono tabular-nums">
                  {userRating.toFixed(1)}
                </div>

                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.5"
                  value={userRating}
                  onChange={(e) => setUserRating(parseFloat(e.target.value))}
                  className="w-full h-3 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 mb-7"
                />

                <button
                  type="button"
                  onClick={handleRate}
                  disabled={isSubmittingRating}
                  className="w-full bg-white text-black font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all"
                >
                  {isSubmittingRating ? 'Saving...' : 'Submit Rating'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        .mask-image-b-fade {
          mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
          -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
        }
      `}</style>
    </div>
  );
};
