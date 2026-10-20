import { MediaTitles } from './media';

/** A title as a metadata source classifies it: one movie, or a show (whose episodes are requested). */
export type MediaKind = 'movie' | 'show';

/**
 * What a metadata source knows about a media beyond its catalog entry; every field is
 * null when unknown. `title` is the English one, the engine's canonical title.
 */
export type MediaMetadata = { [K in keyof MediaTitles]: MediaTitles[K] | null } & {
  kind: MediaKind | null;
  posterUrl: string | null;
};

/** What a release name tells about its media (parsed from a file name). */
export type IdentificationQuery = {
  kind: MediaKind;
  title: string;
  year: number | null;
};

export type IdentifiedMedia = {
  imdbId: string;
  kind: MediaKind;
  /** As the source matched it (possibly localized); `describe` gives the canonical titles. */
  title: string;
  originalTitle: string | null;
  year: number | null;
};

/**
 * A metadata source informs, it never holds requests (that is the catalog's job): every
 * title of a media, its artwork, and the reverse lookup from a release name to a media.
 */
export interface MetadataSource {
  readonly name: string;
  /** Never throws: an unknown or unreachable media is described with nulls. */
  describe(imdbId: string): Promise<MediaMetadata>;
  /** Null when nothing matches (or the match has no imdb id); throws when the source fails. */
  identify(query: IdentificationQuery): Promise<IdentifiedMedia | null>;
}
