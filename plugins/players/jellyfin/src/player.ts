import { createLogger, MediaType, Player, PlayerAsset, ShowcaseItem, ShowcaseKind } from '@crn-flix/contracts';

import { JellyfinMedia, JellyfinMediaService } from './api';

const ITEM_TYPE_BY_KIND: Record<ShowcaseKind, JellyfinMedia['Type']> = {
  movie: 'Movie',
  show: 'Series',
  episode: 'Episode',
};

const KIND_BY_ITEM_TYPE: Record<JellyfinMedia['Type'], ShowcaseKind> = {
  Movie: 'movie',
  Series: 'show',
  Episode: 'episode',
};

/**
 * Episode-level `ProviderIds.Imdb` is the episode's own imdb, not the show's:
 * episodes are resolved through their series (falling back on their own imdb, as
 * the engine always did). Null when no identity is known.
 */
export function toPlayerAsset(media: JellyfinMedia, seriesImdbById: Map<string, string>): PlayerAsset | null {
  if (media.Type === 'Series') {
    return null;
  }
  const seriesImdb = media.Type === 'Episode' && media.SeriesId ? seriesImdbById.get(media.SeriesId) : undefined;
  const imdbId = seriesImdb ?? media.ProviderIds?.Imdb;
  if (!imdbId) {
    return null;
  }
  return {
    imdbId,
    type: media.Type === 'Movie' ? MediaType.Movie : MediaType.Episode,
    title: media.SeriesName ?? media.Name,
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: media.ProductionYear,
    seasonNumber: media.ParentIndexNumber ?? null,
    episodeNumber: media.IndexNumber ?? null,
    runtimeMinutes: null,
  };
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class JellyfinPlayer implements Player {
  private static readonly logger = createLogger(JellyfinPlayer.name);

  readonly name = 'jellyfin';

  constructor(private readonly jellyfin: JellyfinMediaService) {}

  get url(): string {
    return this.jellyfin.url;
  }

  async listAvailable(): Promise<PlayerAsset[]> {
    const medias = await this.jellyfin.listAssets();
    const seriesImdbById = new Map(
      medias.filter((m) => m.Type === 'Series' && m.ProviderIds?.Imdb).map((m) => [m.Id, m.ProviderIds.Imdb]),
    );
    const assets = medias.flatMap((media) => toPlayerAsset(media, seriesImdbById) ?? []);
    const playable = medias.filter((m) => m.Type !== 'Series').length;
    JellyfinPlayer.logger.log(
      `${assets.length}/${playable} Jellyfin assets identified (${seriesImdbById.size} series with an imdb id)`,
    );
    return assets;
  }

  refreshLibrary(): Promise<void> {
    return this.jellyfin.refreshLibrary();
  }

  async upsertAccount(userName: string, password: string, accountId: string | null): Promise<string> {
    if (accountId) {
      await this.jellyfin.resetUserPassword(accountId, password);
      return accountId;
    }
    const existing = await this.jellyfin.findUserByName(userName);
    if (!existing) {
      return this.jellyfin.registerUser(userName, password);
    }
    await this.jellyfin.resetUserPassword(existing.Id, password);
    return existing.Id;
  }

  async showcase(kind: ShowcaseKind, count: number): Promise<ShowcaseItem[]> {
    const medias = await this.jellyfin.listEntries([ITEM_TYPE_BY_KIND[kind]]);
    return shuffled(medias)
      .slice(0, count)
      .map((media) => {
        const itemId = media.Type === 'Episode' ? media.SeriesId! : media.Id;
        return {
          title: media.Type === 'Episode' ? media.SeriesName! : media.Name,
          imdbId: media.ProviderIds.Imdb!,
          type: KIND_BY_ITEM_TYPE[media.Type],
          posterUrl: `${this.url}/Items/${itemId}/Images/Primary?fillWidth=100`,
        };
      });
  }
}
