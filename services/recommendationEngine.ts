import {
  MediaItem,
  MovieDetails,
  TvShowDetails,
  AppView,
  resolveMediaType,
  toMediaKey,
} from '../types';
import { TmdbService } from './tmdb';
import { RequestPriority } from './requestOrchestrator';

export interface UserTasteProfile {
  genreWeights: Record<number, number>;
  preferredEra: number;
  avgVoteThreshold: number;
  preferredRuntime: number;
  biasMediaType: 'movie' | 'tv' | 'balanced';
}

export interface BecauseYouWatchedRow {
  seedItem: MediaItem;
  seedTitle: string;
  items: MediaItem[];
}

export interface PersonalizedSearchHubData {
  forYouItems: Array<MediaItem & { matchPercent?: number }>;
  becauseYouWatchedRows: BecauseYouWatchedRow[];
  acclaimedGems: Array<MediaItem & { matchPercent?: number }>;
}

/**
 * Netflix & Apple TV+ Class Regional Recommendation & Search Ranking Engine
 * -------------------------------------------------------------------------
 * Synthesizes user taste profiles from Watchlist, Watched Progress, Preferred Genres,
 * and Active Streaming Subscriptions (`userProviders`) to power:
 * 1. Spotlight Hero Recommendations
 * 2. Zero-Query Personalized Search Rows ("Top Picks for You", "Because You Watched X")
 * 3. Live Multi-Search Taste-Weighted Ranking
 */
export class RecommendationEngine {
  private tmdb: TmdbService;
  private watchlist: MediaItem[];
  private excludeKeys: Set<string>;
  private userGenres: number[];
  private providerFilterIds?: number[];

  constructor(
    tmdb: TmdbService,
    watchlist: MediaItem[],
    watchedKeys: Set<string>,
    userGenres: number[] = [],
    providerFilterIds?: number[]
  ) {
    this.tmdb = tmdb;
    this.watchlist = watchlist || [];
    this.excludeKeys = watchedKeys || new Set<string>();
    this.userGenres = userGenres || [];
    this.providerFilterIds = providerFilterIds;
  }

  public getTasteProfile(): UserTasteProfile {
    return this.buildProfile();
  }

  /**
   * Computes a normalized 72% - 99% Match Score for a MediaItem against the user's taste profile.
   */
  public computeMatchPercentage(item: MediaItem, profile?: UserTasteProfile): number {
    const activeProfile = profile || this.buildProfile();
    const rawScore = this.calculateShallowScore(item, activeProfile);
    // Map rawScore (0..85) into a realistic streaming match percentage (74%..99%)
    const clamped = Math.max(0, Math.min(85, rawScore));
    return Math.min(99, Math.max(74, Math.round(74 + (clamped / 85) * 25)));
  }

  /**
   * Ranks live search results by combining exact/prefix title relevance with the user's personal Taste Profile.
   */
  public rankSearchResultsByTaste(
    results: MediaItem[],
    rawQuery: string
  ): Array<MediaItem & { matchPercent?: number }> {
    const cleanQuery = rawQuery.trim().toLowerCase();
    const profile = this.buildProfile();

    return [...results]
      .map((item) => {
        if (item.media_type === 'person') {
          return {
            item: { ...item },
            totalRank: (item.popularity || 0) * 1.2 + 25,
          };
        }

        const title = (item.title || item.name || '').toLowerCase();
        let textRelevance = 0;
        if (title === cleanQuery) textRelevance = 120;
        else if (title.startsWith(cleanQuery)) textRelevance = 75;
        else if (title.includes(cleanQuery)) textRelevance = 40;

        const tasteScore = this.calculateShallowScore(item, profile);
        const matchPercent = this.computeMatchPercentage(item, profile);
        const hasPosterBoost = item.poster_path || item.backdrop_path ? 20 : -30;

        return {
          item: { ...item, matchPercent },
          totalRank: textRelevance + tasteScore * 0.65 + hasPosterBoost,
        };
      })
      .sort((a, b) => b.totalRank - a.totalRank)
      .map((entry) => entry.item);
  }

  /**
   * Generates the Netflix / Apple TV+ Zero-Query Personalized Discovery Hub for SearchView:
   * - Row 1: "Für dich empfohlen" (Top Picks for You with Match %)
   * - Row 2 & 3: "Weil du [Seed] auf deiner Liste hast / gesehen hast"
   * - Row 4: "Kritiker-Favoriten in deiner Region"
   */
  public async getPersonalizedSearchHub(
    mediaCategory: 'movies' | 'shows' = 'movies'
  ): Promise<PersonalizedSearchHubData> {
    const profile = this.buildProfile();
    const targetType: 'movie' | 'tv' = mediaCategory === 'shows' ? 'tv' : 'movie';
    const watchlistKeys = new Set(
      this.watchlist.map((w) => toMediaKey(w.id, resolveMediaType(w)))
    );

    // Determine top 2 genres from profile weights or userGenres
    const sortedGenreIds = Object.entries(profile.genreWeights)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0);

    const topGenreQuery =
      sortedGenreIds.slice(0, 2).join('|') ||
      this.userGenres.slice(0, 2).join('|') ||
      (targetType === 'movie' ? '28|878|18' : '18|10765');

    // Pick up to 2 distinct seed items from Watchlist
    const seedCandidates = this.watchlist
      .filter((w) => w && w.id > 0 && (w.title || w.name))
      .slice(0, 2);

    try {
      const [forYouRes, acclaimedRes, ...seedResponses] = await Promise.all([
        this.tmdb
          .discoverRegional(
            targetType,
            {
              with_genres: topGenreQuery,
              'vote_count.gte': '120',
              sort_by: 'popularity.desc',
            },
            1,
            {
              providerIds: this.providerFilterIds,
              priority: RequestPriority.HIGH,
            }
          )
          .catch(() => ({ results: [] as MediaItem[] })),

        this.tmdb
          .discoverRegional(
            targetType,
            {
              'vote_average.gte': '7.5',
              'vote_count.gte': '350',
              sort_by: 'vote_average.desc',
            },
            1,
            {
              providerIds: this.providerFilterIds,
              priority: RequestPriority.NORMAL,
            }
          )
          .catch(() => ({ results: [] as MediaItem[] })),

        ...seedCandidates.map(async (seed) => {
          const seedType = resolveMediaType(seed) === 'tv' ? 'tv' : 'movie';
          try {
            const [recRes, simRes] = await Promise.all([
              this.tmdb
                .getRecommendations(seed.id, seedType, 1, RequestPriority.NORMAL)
                .catch(() => ({ results: [] as MediaItem[] })),
              this.tmdb
                .getSimilarMedia(seed.id, seedType, 1, RequestPriority.LOW)
                .catch(() => ({ results: [] as MediaItem[] })),
            ]);
            const combined = [...(recRes.results || []), ...(simRes.results || [])];
            const seen = new Set<number>([seed.id]);
            const deduped = combined
              .filter((item) => {
                if (!item || !item.id || seen.has(item.id)) return false;
                if (!item.poster_path && !item.backdrop_path) return false;
                const key = toMediaKey(item.id, resolveMediaType(item, seedType));
                if (this.excludeKeys.has(key)) return false;
                seen.add(item.id);
                return true;
              })
              .map((item) => ({
                ...item,
                media_type: resolveMediaType(item, seedType),
                matchPercent: this.computeMatchPercentage(item, profile),
              }))
              .sort(
                (a, b) =>
                  this.calculateShallowScore(b, profile) -
                  this.calculateShallowScore(a, profile)
              )
              .slice(0, 14);

            return {
              seedItem: seed,
              seedTitle: seed.title || seed.name || 'Highlight',
              items: deduped,
            } as BecauseYouWatchedRow;
          } catch {
            return {
              seedItem: seed,
              seedTitle: seed.title || seed.name || 'Highlight',
              items: [],
            } as BecauseYouWatchedRow;
          }
        }),
      ]);

      const forYouItems = (forYouRes.results || [])
        .filter((item) => {
          const key = toMediaKey(item.id, targetType);
          return (
            !this.excludeKeys.has(key) &&
            !watchlistKeys.has(key) &&
            Boolean(item.poster_path || item.backdrop_path)
          );
        })
        .map((item) => ({
          ...item,
          media_type: targetType,
          matchPercent: this.computeMatchPercentage(item, profile),
        }))
        .sort(
          (a, b) =>
            this.calculateShallowScore(b, profile) - this.calculateShallowScore(a, profile)
        )
        .slice(0, 16);

      const acclaimedGems = (acclaimedRes.results || [])
        .filter((item) => {
          const key = toMediaKey(item.id, targetType);
          return !this.excludeKeys.has(key) && Boolean(item.poster_path || item.backdrop_path);
        })
        .map((item) => ({
          ...item,
          media_type: targetType,
          matchPercent: this.computeMatchPercentage(item, profile),
        }))
        .slice(0, 16);

      const becauseYouWatchedRows = seedResponses.filter((r) => r.items.length >= 3);

      return {
        forYouItems,
        becauseYouWatchedRows,
        acclaimedGems,
      };
    } catch {
      return {
        forYouItems: [],
        becauseYouWatchedRows: [],
        acclaimedGems: [],
      };
    }
  }

  public async getSpotlightRecommendation(): Promise<MediaItem | null> {
    if (
      !this.watchlist ||
      this.watchlist.length === 0 ||
      (this.providerFilterIds && this.providerFilterIds.length > 0)
    ) {
      return this.getColdStartRecommendation();
    }

    const profile = this.buildProfile();

    const recentCount = Math.max(1, Math.min(this.watchlist.length, 5));
    const recentItems = this.watchlist.slice(0, recentCount);
    const seedItem = recentItems[0];

    if (!seedItem) return this.getColdStartRecommendation();

    try {
      const type = resolveMediaType(seedItem);
      const seedAggregate = await this.tmdb.getAggregateDetails(
        seedItem.id,
        type,
        AppView.DETAILS,
        RequestPriority.NORMAL
      );

      const seedDirector = seedAggregate.credits?.crew?.find((c) => c.job === 'Director')?.id;
      const seedCastIds = new Set(seedAggregate.credits?.cast?.slice(0, 5).map((c) => c.id));
      const seedCompanies = new Set(
        (seedAggregate.item as MovieDetails).production_companies?.map((c) => c.id)
      );

      let rawCandidates = seedAggregate.recommendations || [];

      if (rawCandidates.length === 0) {
        const genreIds =
          seedItem.genre_ids?.join(',') || this.userGenres.slice(0, 3).join(',') || '';
        const discoverRes = await this.tmdb.discoverRegional(
          type === 'tv' ? 'tv' : 'movie',
          { with_genres: genreIds },
          1,
          { providerIds: this.providerFilterIds, priority: RequestPriority.NORMAL }
        );
        rawCandidates = discoverRes.results || [];
      }

      const watchlistKeys = new Set(
        this.watchlist.map((w) => toMediaKey(w.id, resolveMediaType(w)))
      );

      const preScored = rawCandidates
        .filter((c) => {
          const key = toMediaKey(c.id, resolveMediaType(c, type));
          return (
            !this.excludeKeys.has(key) &&
            !watchlistKeys.has(key) &&
            (c.backdrop_path || c.poster_path)
          );
        })
        .map((c) => ({
          item: c,
          score: this.calculateShallowScore(c, profile),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      if (preScored.length === 0) {
        return this.getColdStartRecommendation();
      }

      const deepCandidates = await Promise.all(
        preScored.map(async (candidateObj) => {
          const c = candidateObj.item;
          const cType = resolveMediaType(c, type);
          try {
            const details = await this.tmdb.getAggregateDetails(
              c.id,
              cType,
              AppView.DETAILS,
              RequestPriority.NORMAL
            );
            let deepScore = candidateObj.score;

            if (
              details.providers &&
              (details.providers.flatrate?.length ||
                details.providers.rent?.length ||
                details.providers.buy?.length)
            ) {
              deepScore += 15;
            }

            const director = details.credits?.crew?.find((crew) => crew.job === 'Director');
            if (director && director.id === seedDirector) {
              deepScore += 30;
            }

            let sharedActors = 0;
            details.credits?.cast?.slice(0, 5).forEach((actor) => {
              if (seedCastIds.has(actor.id)) sharedActors++;
            });
            if (sharedActors > 0) {
              deepScore += sharedActors * 10;
            }

            const companyMatch = (details.item as MovieDetails).production_companies?.some((comp) =>
              seedCompanies.has(comp.id)
            );
            if (companyMatch) {
              deepScore += 10;
            }

            const runtime =
              (details.item as MovieDetails).runtime ||
              (details.item as TvShowDetails).episode_run_time?.[0];
            if (runtime && profile.preferredRuntime > 0) {
              const diff = Math.abs(runtime - profile.preferredRuntime);
              if (diff < 15) deepScore += 10;
              else if (diff > 45) deepScore -= 5;
            }

            return { item: c, score: deepScore };
          } catch {
            return { item: c, score: candidateObj.score };
          }
        })
      );

      deepCandidates.sort((a, b) => b.score - a.score);
      return deepCandidates[0]?.item || preScored[0]?.item || null;
    } catch (error) {
      console.error('Recommendation Engine fallback:', error);
      return this.getColdStartRecommendation();
    }
  }

  private async getColdStartRecommendation(): Promise<MediaItem | null> {
    try {
      const topGenres = this.userGenres.slice(0, 2).join(',');
      const params: Record<string, string> = {
        'vote_count.gte': '200',
        sort_by: 'popularity.desc',
      };
      if (topGenres) {
        params.with_genres = topGenres;
      }

      const discovered = await this.tmdb.discoverRegional('movie', params, 1, {
        providerIds: this.providerFilterIds,
        priority: RequestPriority.NORMAL,
      });

      const match = (discovered.results || []).find(
        (i) => !this.excludeKeys.has(toMediaKey(i.id, 'movie')) && Boolean(i.backdrop_path)
      );
      if (match) return match;

      const fallback = await this.tmdb.discoverRegional(
        'movie',
        { sort_by: 'popularity.desc' },
        1,
        { providerIds: this.providerFilterIds, priority: RequestPriority.NORMAL }
      );
      if (fallback.results && fallback.results.length > 0) {
        return (
          fallback.results.find(
            (i) => !this.excludeKeys.has(toMediaKey(i.id, resolveMediaType(i)))
          ) || fallback.results[0]
        );
      }
      return null;
    } catch {
      return null;
    }
  }

  private buildProfile(): UserTasteProfile {
    const genreCounts: Record<number, number> = {};
    let totalItems = 0;
    let totalYear = 0;
    let validYearCount = 0;
    let totalVote = 0;
    let movieCount = 0;
    let tvCount = 0;

    this.userGenres.forEach((genreId) => {
      genreCounts[genreId] = (genreCounts[genreId] || 0) + 1.5;
      totalItems += 0.5;
    });

    this.watchlist.forEach((item, index) => {
      const weight = 1 / (1 + index * 0.05);
      totalItems += weight;

      item.genre_ids?.forEach((id) => {
        genreCounts[id] = (genreCounts[genreId_or_id(id)] || 0) + weight;
      });

      const date = item.release_date || item.first_air_date;
      if (date) {
        const year = parseInt(date.substring(0, 4), 10);
        if (!isNaN(year)) {
          totalYear += year * weight;
          validYearCount += weight;
        }
      }

      if (item.vote_average) {
        totalVote += item.vote_average * weight;
      }

      if (resolveMediaType(item) === 'tv') tvCount += weight;
      else movieCount += weight;
    });

    const genreWeights: Record<number, number> = {};
    const normDivisor = Math.max(1, totalItems);
    Object.keys(genreCounts).forEach((k) => {
      const key = Number(k);
      genreWeights[key] = genreCounts[key] / normDivisor;
    });

    return {
      genreWeights,
      preferredEra: validYearCount > 0 ? totalYear / validYearCount : new Date().getFullYear(),
      avgVoteThreshold: totalItems > 0 ? totalVote / normDivisor : 7.0,
      preferredRuntime: 115,
      biasMediaType:
        movieCount > tvCount * 1.5 ? 'movie' : tvCount > movieCount * 1.5 ? 'tv' : 'balanced',
    };
  }

  private calculateShallowScore(item: MediaItem, profile: UserTasteProfile): number {
    let score = 0;

    let genreScore = 0;
    let matches = 0;
    item.genre_ids?.forEach((id) => {
      if (profile.genreWeights[id]) {
        genreScore += profile.genreWeights[id];
        matches++;
      }
    });
    if (matches > 0) score += Math.min(40, genreScore * 25);

    const itemRating = item.vote_average || 0;
    const ratingDelta = itemRating - (profile.avgVoteThreshold - 1.0);
    if (ratingDelta >= 0) score += Math.min(20, ratingDelta * 5);

    const date = item.release_date || item.first_air_date;
    if (date) {
      const year = parseInt(date.substring(0, 4), 10);
      if (!isNaN(year)) {
        const diff = Math.abs(year - profile.preferredEra);
        if (diff < 5) score += 15;
        else if (diff < 10) score += 10;
        else if (diff < 20) score += 5;
      }
    }

    if (item.popularity) score += Math.min(10, Math.log10(item.popularity) * 2);

    const isTv = resolveMediaType(item) === 'tv';
    if (profile.biasMediaType === 'balanced') score += 5;
    else if (profile.biasMediaType === 'tv' && isTv) score += 10;
    else if (profile.biasMediaType === 'movie' && !isTv) score += 10;

    return score;
  }
}

function genreId_or_id(id: number): number {
  return id;
}