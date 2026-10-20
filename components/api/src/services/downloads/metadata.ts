import { DownloadMetadata } from '@crn-flix/contracts';

import { displayTitle, MediaEntity } from '@/services/database/medias';

export function buildDownloadMetadata(requestId: string, media?: MediaEntity | null): DownloadMetadata {
  const metadata: DownloadMetadata = { 'crn-flix-request-id': requestId };
  if (!media) {
    return metadata;
  }

  if (media.imdbId) {
    metadata.imdbid = media.imdbId;
  }
  metadata.type = media.type;
  metadata.title = displayTitle(media);
  if (media.year !== null) {
    metadata.year = String(media.year);
  }
  if (media.seasonNumber !== null) {
    metadata.season = String(media.seasonNumber);
  }
  if (media.episodeNumber !== null) {
    metadata.episode = String(media.episodeNumber);
  }
  return metadata;
}
