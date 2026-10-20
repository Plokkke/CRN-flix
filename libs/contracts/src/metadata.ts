import { MediaTitles } from './media';

/**
 * What a metadata source knows about a media beyond its catalog entry; every field is
 * null when unknown. `title` is the English one, the engine's canonical title.
 */
export type MediaMetadata = { [K in keyof MediaTitles]: MediaTitles[K] | null } & {
  posterUrl: string | null;
};

/**
 * A metadata source informs, it never holds requests (that is the catalog's job):
 * every title of a media and its artwork. It never throws: an unknown or unreachable
 * media is described with nulls.
 */
export interface MetadataSource {
  readonly name: string;
  describe(imdbId: string): Promise<MediaMetadata>;
}
