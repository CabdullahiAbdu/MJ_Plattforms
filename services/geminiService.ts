import { MovieDetails, TvShowDetails } from '../types';

/**
 * Client-side service communicating exclusively with our server-side `/api/ai/*` routes
 * powered by `@google/genai` (`gemini-3.8-flash`).
 * Never exposes API keys or misuses the TMDB key in the browser.
 */
export const generateMovieInsights = async (
  media: MovieDetails | TvShowDetails,
  query?: string,
  language: string = 'en-US'
): Promise<string> => {
  const title = media.title || media.name || 'Untitled';
  const releaseYear = (media.release_date || media.first_air_date || '').substring(0, 4);
  const genres = media.genres?.map((g) => g.name) || [];

  try {
    const response = await fetch('/api/ai/insights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        overview: media.overview,
        releaseYear,
        genres,
        rating: media.vote_average ? Number(media.vote_average.toFixed(1)) : undefined,
        query,
        language,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return data.error || 'Unable to retrieve AI insights right now.';
    }
    return data.text || 'No insight available.';
  } catch (error) {
    console.error('AI Insights request failed:', error);
    return 'Unable to connect to the AI film critic right now.';
  }
};

export const chatWithMovieExpert = async (
  history: { role: 'user' | 'model' | 'ai'; text: string }[],
  newMessage: string,
  mediaContext?: string,
  language: string = 'en-US'
): Promise<string> => {
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        history,
        message: newMessage,
        mediaContext,
        language,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return data.error || 'AI film expert is currently unavailable.';
    }
    return data.text || 'No response received.';
  } catch (error) {
    console.error('AI Chat request failed:', error);
    return 'Unable to reach the AI film expert right now.';
  }
};