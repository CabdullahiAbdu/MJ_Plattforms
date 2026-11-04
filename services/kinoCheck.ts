import { MediaType, Video } from '../types';
import { globalOrchestrator, RequestPriority } from './requestOrchestrator';

const BASE_URL = 'https://api.kinocheck.de';

export class KinoCheckService {
  private apiKey: string;
  private language: string;

  constructor(apiKey: string, language: string = 'en-US') {
    this.apiKey = apiKey;
    this.language = language;
  }

  async getTrailer(tmdbId: number, type: MediaType): Promise<Video | null> {
    const endpoint = type === 'tv' ? 'shows' : 'movies';
    const langParam = this.language.toLowerCase().startsWith('de') ? 'de' : 'en';
    const cacheKey = `kinocheck:${langParam}:${endpoint}:${tmdbId}`;

    try {
      return await globalOrchestrator.request<Video | null>({
        cacheKey,
        priority: RequestPriority.NORMAL,
        ttlMs: 15 * 60 * 1000,
        execute: async (signal) => {
          const url = new URL(`${BASE_URL}/${endpoint}`);
          url.searchParams.append('tmdb_id', tmdbId.toString());
          if (this.apiKey) {
            url.searchParams.append('apikey', this.apiKey);
          }
          url.searchParams.append('language', langParam);

          const response = await fetch(url.toString(), { signal });
          if (!response.ok) return null;

          const data = await response.json();
          let trailerData = data.trailer;

          if (!trailerData && data.videos && Array.isArray(data.videos)) {
            trailerData = data.videos.find((v: any) => v.type === 'Trailer') || data.videos[0];
          }

          if (trailerData && trailerData.youtube_video_id) {
            return {
              id: trailerData.id || `kc-${tmdbId}`,
              key: trailerData.youtube_video_id,
              name: trailerData.title || 'KinoCheck Trailer',
              site: 'YouTube',
              type: 'Trailer',
              official: true,
            };
          }

          return null;
        },
      });
    } catch {
      return null;
    }
  }
}
