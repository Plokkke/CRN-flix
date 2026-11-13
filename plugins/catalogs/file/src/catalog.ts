import * as fs from 'fs/promises';

import { z } from 'zod';

import {
  Catalog,
  CatalogAccount,
  CatalogAccountSource,
  CatalogActivity,
  CatalogItem,
  LinkedCatalogAccount,
  MediaType,
  Playhead,
  RequestReason,
  START_OF_SHOW,
} from '@crn-flix/contracts';

const movieSchema = z.object({ type: z.literal('movie'), imdbId: z.string(), title: z.string(), year: z.number() });

/** A show is requested episode by episode: `episodes` lists the aired ones of `season`. */
const showSchema = z.object({
  type: z.literal('show'),
  imdbId: z.string(),
  title: z.string(),
  year: z.number(),
  season: z.number().int().min(1),
  episodes: z.array(z.number().int().min(1)),
});

const itemSchema = z.discriminatedUnion('type', [movieSchema, showSchema]);

export const catalogFileSchema = z.object({
  accounts: z.array(
    z.object({
      /** The user's player account id (users.jellyfin_id): how the engine ties the account to its user. */
      playerAccountId: z.string(),
      requests: z.partialRecord(z.enum(RequestReason), z.array(itemSchema)).default({}),
      /** Where the user stands in each show, by show imdb id; absent = never watched. */
      playheads: z
        .record(z.string(), z.object({ nextSeason: z.number().nullable(), nextEpisode: z.number().nullable() }))
        .default({}),
    }),
  ),
});

export type CatalogFile = z.infer<typeof catalogFileSchema>;
type FileItem = z.infer<typeof itemSchema>;

/** What the engine hands back as credentials: just which account of the file it is. */
type FileCredentials = { playerAccountId: string };

const titles = (item: FileItem) => ({
  title: item.title,
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: item.year,
  runtimeMinutes: null,
  catalogSlug: null,
});

function expand(item: FileItem): CatalogItem[] {
  if (item.type === 'movie') {
    return [{ ...titles(item), imdbId: item.imdbId, type: MediaType.Movie, seasonNumber: null, episodeNumber: null }];
  }
  return item.episodes.map((episodeNumber) => ({
    ...titles(item),
    imdbId: item.imdbId,
    type: MediaType.Episode,
    seasonNumber: item.season,
    episodeNumber,
  }));
}

/**
 * A catalog for the local sandbox, with no external service: every user's requests and
 * playheads come from one JSON file, read again on every call so an edit shows on the next
 * sync. It is also the account source (no player plugin holds catalog credentials here).
 * The file's modification time is every reason's last activity: the engine re-reads it
 * only when it changed.
 */
export class FileCatalog implements Catalog, CatalogAccountSource {
  readonly name = 'file';
  readonly reasons = [RequestReason.Watchlisted, RequestReason.Progress, RequestReason.HighRated] as const;

  constructor(private readonly path: string) {}

  private async read(): Promise<CatalogFile> {
    return catalogFileSchema.parse(JSON.parse(await fs.readFile(this.path, 'utf8')));
  }

  private async accountOf(account: CatalogAccount): Promise<CatalogFile['accounts'][number] | undefined> {
    const { playerAccountId } = account.credentials as FileCredentials;
    return (await this.read()).accounts.find((candidate) => candidate.playerAccountId === playerAccountId);
  }

  async listAccounts(): Promise<LinkedCatalogAccount[]> {
    return (await this.read()).accounts.map(({ playerAccountId }) => ({
      playerAccountId,
      credentials: { playerAccountId } satisfies FileCredentials,
    }));
  }

  async saveCredentials(): Promise<void> {}

  async enforceSettings(): Promise<number> {
    return 0;
  }

  async lastActivity(): Promise<CatalogActivity> {
    const { mtime } = await fs.stat(this.path);
    return Object.fromEntries(this.reasons.map((reason) => [reason, mtime]));
  }

  async listRequests(account: CatalogAccount, reason: RequestReason): Promise<CatalogItem[]> {
    return ((await this.accountOf(account))?.requests[reason] ?? []).flatMap(expand);
  }

  async playhead(account: CatalogAccount, showImdbId: string): Promise<Playhead> {
    return (await this.accountOf(account))?.playheads[showImdbId] ?? START_OF_SHOW;
  }

  async renewCredentials(): Promise<unknown> {
    return null;
  }
}
