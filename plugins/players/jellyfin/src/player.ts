import {
  AccountPolicy,
  createLogger,
  MediaType,
  Player,
  PlayerAsset,
  PlayerLibrary,
  ShowcaseItem,
  ShowcaseKind,
} from '@crn-flix/contracts';

import {
  COLLECTION_TYPES,
  JellyfinMedia,
  JellyfinMediaService,
  JellyfinUserPolicy,
  JellyfinVirtualFolder,
} from './api';

/**
 * Viewers watch from anywhere, without managing the server; there is no live TV so its
 * access costs nothing. Audio may be transcoded and containers remuxed, video is never
 * re-encoded (the server cannot afford it).
 */
const VIEWER_POLICY = {
  IsAdministrator: false,
  EnableRemoteAccess: true,
  EnableLiveTvAccess: true,
  EnableLiveTvManagement: false,
  EnableAudioPlaybackTranscoding: true,
  EnablePlaybackRemuxing: true,
  EnableVideoPlaybackTranscoding: false,
  EnableMediaConversion: false,
} as const;

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()) : a === b;

/**
 * The account's policy with the viewer rules applied, or null when it already complies.
 * `enabledFolders` (library ids) replaces "every library" when the engine decides the access.
 */
export function viewerPolicy(
  current: JellyfinUserPolicy,
  policy: AccountPolicy,
  enabledFolders?: string[],
): JellyfinUserPolicy | null {
  const wanted: Record<string, unknown> = {
    ...VIEWER_POLICY,
    ...(policy.maxStreams !== undefined && { MaxActiveSessions: policy.maxStreams }),
    ...(enabledFolders && { EnableAllFolders: false, EnabledFolders: [...enabledFolders].sort() }),
    ...(policy.maxParentalRating !== undefined && { MaxParentalRating: policy.maxParentalRating }),
  };
  const complies = Object.entries(wanted).every(([key, value]) => sameValue(current[key], value));
  return complies ? null : { ...current, ...wanted };
}

const withoutTrailingSlash = (folder: string): string => folder.replace(/\/+$/, '');

const isUnder = (folder: string, root: string): boolean => {
  const base = withoutTrailingSlash(root);
  return withoutTrailingSlash(folder) === base || folder.startsWith(`${base}/`);
};

/** The libraries an account sees: the ones it is given, plus every library outside the engine's root. */
export function enabledFolderIds(
  folders: JellyfinVirtualFolder[],
  access: NonNullable<AccountPolicy['libraries']>,
): string[] {
  const given = new Set(access.paths.map(withoutTrailingSlash));
  return folders
    .filter(
      (folder) =>
        folder.Locations.some((location) => given.has(withoutTrailingSlash(location))) ||
        folder.Locations.every((location) => !isUnder(location, access.managedRoot)),
    )
    .map((folder) => folder.ItemId);
}

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

  async listAccountIds(): Promise<string[]> {
    return (await this.jellyfin.listUsers()).map((user) => user.Id);
  }

  async accountMaxStreams(accountId: string): Promise<number | null> {
    const policy = await this.jellyfin.getUserPolicy(accountId);
    return policy.IsAdministrator ? null : policy.MaxActiveSessions;
  }

  /** Administrators are the owner's own accounts: never touched. */
  async ensureLibraries(libraries: PlayerLibrary[]): Promise<number> {
    const folders = await this.jellyfin.listVirtualFolders();
    const served = new Set(folders.flatMap((folder) => folder.Locations.map(withoutTrailingSlash)));
    const missing = libraries.filter((library) => !served.has(withoutTrailingSlash(library.path)));
    for (const library of missing) {
      await this.jellyfin.addVirtualFolder(library.name, COLLECTION_TYPES[library.section], library.path);
      JellyfinPlayer.logger.log(`Library "${library.name}" created on ${library.path}`);
    }
    return missing.length;
  }

  async applyAccountPolicy(accountId: string, policy: AccountPolicy): Promise<boolean> {
    const current = await this.jellyfin.getUserPolicy(accountId);
    if (current.IsAdministrator) {
      return false;
    }
    const enabled = policy.libraries && enabledFolderIds(await this.jellyfin.listVirtualFolders(), policy.libraries);
    const next = viewerPolicy(current, policy, enabled);
    if (!next) {
      return false;
    }
    await this.jellyfin.setUserPolicy(accountId, next);
    const streams = policy.maxStreams === undefined ? 'stream limit kept' : `${policy.maxStreams} stream(s)`;
    JellyfinPlayer.logger.log(`Viewer policy applied to account ${accountId} (${streams})`);
    return true;
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
