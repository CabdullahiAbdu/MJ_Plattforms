import { MediaItem, resolveMediaType } from '../types';
import { haptics } from './haptics';

/**
 * Native iOS Share Sheet & Deep-Link Recommendation Card Helper
 */
export async function shareMediaItem(
  item: MediaItem,
  options?: {
    providerNames?: string[];
    region?: string;
    onCopiedFallback?: (msg: string) => void;
  }
): Promise<boolean> {
  haptics.light();
  const title = item.title || item.name || 'MovieJournal Empfehlung';
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const rating =
    item.vote_average && item.vote_average > 0 ? `★ ${item.vote_average.toFixed(1)}` : '';
  const mType = resolveMediaType(item) === 'tv' ? 'Serie' : 'Film';
  const providersText =
    options?.providerNames && options.providerNames.length > 0
      ? ` · Streambar auf ${options.providerNames.slice(0, 3).join(', ')}`
      : '';

  const headerLine = [title, year ? `(${year})` : '', rating, `· ${mType}${providersText}`]
    .filter(Boolean)
    .join(' ');

  const shareText = item.overview
    ? `${headerLine}\n\n${item.overview.slice(0, 220)}${item.overview.length > 220 ? '…' : ''}`
    : headerLine;

  const tmdbUrl = `https://www.themoviedb.org/${resolveMediaType(item) === 'tv' ? 'tv' : 'movie'}/${item.id}`;

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({
        title,
        text: shareText,
        url: tmdbUrl,
      });
      haptics.success();
      return true;
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return false;
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${shareText}\n${tmdbUrl}`);
      haptics.success();
      options?.onCopiedFallback?.(`„${title}“ in die Zwischenablage kopiert`);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
