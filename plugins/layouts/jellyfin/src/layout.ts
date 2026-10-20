import { LibraryIdentity, LibraryLayout, LibraryPlacement } from '@crn-flix/contracts';

export function sanitizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '.')
    .replace(/[\s-]+/g, '.')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .replace(/\.{2,}/g, '.');
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `Title.(year).[imdbid-tt…]`, the tags Jellyfin uses to identify a folder without guessing. */
function tagged(identity: LibraryIdentity, ...middle: string[]): string {
  const parts = [sanitizeTitle(identity.title)];
  if (identity.year) {
    parts.push(`(${identity.year})`);
  }
  parts.push(...middle);
  if (identity.imdbId) {
    parts.push(`[imdbid-${identity.imdbId}]`);
  }
  return parts.join('.');
}

function episodeTag({ seasonNumber, episodeNumber, episodeNumberEnd }: LibraryIdentity): string {
  const episode = episodeNumber ?? 0;
  const tag = `S${pad(seasonNumber ?? 0)}E${pad(episode)}`;
  return episodeNumberEnd && episodeNumberEnd !== episode ? `${tag}-E${pad(episodeNumberEnd)}` : tag;
}

export class JellyfinLayout implements LibraryLayout {
  readonly name = 'jellyfin';

  place(identity: LibraryIdentity): LibraryPlacement {
    const folder = tagged(identity);
    if (identity.type === 'episode') {
      return {
        section: 'series',
        folders: [folder, `Season${pad(identity.seasonNumber ?? 0)}`],
        fileName: tagged(identity, episodeTag(identity)),
      };
    }
    return { section: 'movies', folders: [folder], fileName: folder };
  }
}
