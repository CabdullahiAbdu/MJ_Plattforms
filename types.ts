export type MediaType = 'movie' | 'tv' | 'person' | 'collection' | 'company';

/**
 * Deterministic composite key preventing ID collisions between TMDB movies and TV shows.
 * Format: "movie:12345" or "tv:12345"
 */
export type MediaKey = `${MediaType}:${number}`;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type ExpandHandler = (item: MediaItem, rect: Rect, options?: { autoPlayTrailer?: boolean }) => void;

export interface TmdbImage {
  file_path: string;
  width: number;
  height: number;
  aspect_ratio: number;
  iso_639_1: string | null;
  vote_average: number;
}

export interface MediaItem {
  id: number;
  media_type?: MediaType;
  title?: string; // Movie
  name?: string; // TV or Person
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  profile_path?: string | null; // Person
  backdrop_path?: string | null;
  logo_path?: string | null;
  certification?: string | null;
  release_date?: string; // Movie
  first_air_date?: string; // TV
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  known_for_department?: string; // Person
  display_role?: string; // For "Known For" credits (e.g. "Director • Writer")
  job?: string;
  character?: string;
  department?: string;
}

export interface MovieDetails extends MediaItem {
  genres: Genre[];
  runtime: number;
  tagline: string;
  status: string;
  revenue: number;
  budget: number;
  imdb_id?: string;
  belongs_to_collection?: Collection | null;
  production_companies: Company[];
  production_countries: { iso_3166_1: string; name: string }[];
  spoken_languages: { iso_639_1: string; name: string }[];
  homepage?: string;
}

export interface TvShowDetails extends MediaItem {
  genres: Genre[];
  episode_run_time: number[];
  tagline: string;
  status: string;
  number_of_seasons: number;
  number_of_episodes: number;
  seasons: Season[];
  production_companies: Company[];
  networks?: Company[];
  origin_country?: string[];
  spoken_languages?: { iso_639_1: string; name: string }[];
  created_by: CastMember[];
  homepage?: string;
  next_episode_to_air?: {
    id: number;
    name: string;
    overview: string;
    air_date: string;
    episode_number: number;
    season_number: number;
    still_path: string | null;
  } | null;
}

export interface PersonDetails extends MediaItem {
  biography: string;
  birthday: string;
  deathday: string | null;
  place_of_birth: string;
  also_known_as: string[];
}

export interface Collection {
  id: number;
  name: string;
  overview?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts?: MediaItem[]; // For details
}

export interface Company {
  id: number;
  name: string;
  description?: string;
  headquarters?: string;
  homepage?: string;
  logo_path: string | null;
  origin_country: string;
}

export interface Review {
  id: string;
  author: string;
  content: string;
  created_at: string;
  author_details: {
    avatar_path: string | null;
    rating: number | null;
  };
}

export interface Keyword {
  id: number;
  name: string;
}

export interface Season {
  id: number;
  name: string;
  episode_count: number;
  season_number: number;
  poster_path: string | null;
  air_date: string;
  overview: string;
}

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  job?: string; // Crew
  department?: string;
  profile_path: string | null;
  media_type?: MediaType;
  total_episode_count?: number;
}

export interface CombinedCredits {
  cast: MediaItem[];
  crew: MediaItem[];
}

export interface Video {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
}

export interface WatchProviderCountryData {
  link: string;
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

export interface WatchProvidersResponse {
  results: {
    [countryCode: string]: WatchProviderCountryData;
  };
}

export interface TmdbResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface CreditsResponse {
  id: number;
  cast: CastMember[];
  crew: CastMember[];
}

export interface ExternalIds {
  imdb_id?: string;
  facebook_id?: string;
  instagram_id?: string;
  twitter_id?: string;
}

export enum AppView {
  HOME = 'HOME',
  WATCHLIST = 'WATCHLIST',
  SEARCH = 'SEARCH',
  DETAILS = 'DETAILS',
  PERSON = 'PERSON',
  COLLECTION = 'COLLECTION',
  COMPANY = 'COMPANY',
  SETTINGS = 'SETTINGS',
  CALENDAR = 'CALENDAR',
  PROVIDER = 'PROVIDER',
}

export interface Genre {
  id: number;
  name: string;
}

export interface AggregateDetailsResult {
  item: MovieDetails | TvShowDetails | PersonDetails | Collection | Company;
  credits?: CreditsResponse | null;
  videos?: Video[];
  providers?: WatchProviderCountryData | null;
  recommendations?: MediaItem[];
  similar?: MediaItem[];
  reviews?: Review[];
  keywords?: Keyword[];
  combinedCredits?: MediaItem[];
  externalIds?: ExternalIds;
  logoPath?: string | null;
  backdrops?: TmdbImage[];
  personProfiles?: TmdbImage[];
  certification?: string | null;
  loading: boolean;
  collectionParts?: MediaItem[];
  companyMovies?: MediaItem[];
  seasonDetails?: any;
  seasonProviders?: WatchProviderCountryData | null;
  selectedSeasonNumber?: number;
}

/**
 * Helper to resolve a MediaItem's canonical MediaType
 */
export function resolveMediaType(
  item?: Partial<MediaItem> | null,
  fallback: MediaType = 'movie'
): MediaType {
  if (!item || typeof item !== 'object') return fallback;
  if (item.media_type) return item.media_type;
  if (item.first_air_date && !item.release_date) return 'tv';
  return fallback;
}

/**
 * Helper to construct a collision-free composite MediaKey
 */
export function toMediaKey(id: number, type?: MediaType | string): MediaKey {
  const normalized: MediaType =
    type === 'tv' || type === 'person' || type === 'collection' || type === 'company' ? type : 'movie';
  return `${normalized}:${Number(id) || 0}`;
}