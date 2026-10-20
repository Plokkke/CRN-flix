import { MediaTitles, MediaType } from './media';

/** What a metadata source knows about a media beyond its catalog entry. */
export type MediaMetadata = Partial<MediaTitles> & {
  posterUrl: string | null;
};

export type IdentificationQuery = {
  type: MediaType;
  title: string;
  year: number | null;
};

export type IdentificationMatch = MediaTitles & {
  imdbId: string;
};

/**
 * DRAFT — not wired yet. A metadata source informs, it never holds requests
 * (that is the catalog's job): every title of a media, its artwork, and the
 * reverse lookup from a release name to a media identity.
 */
export interface MetadataSource {
  readonly name: string;
  describe(imdbId: string): Promise<MediaMetadata>;
  identify(query: IdentificationQuery): Promise<IdentificationMatch[]>;
}
