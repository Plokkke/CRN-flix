import * as fsPromises from 'fs/promises';

import { AccountPolicy, LibrarySection, PlayerLibrary } from '@crn-flix/contracts';

import { UserEntity } from '@/services/database/users';
import { SHELVES } from '@/services/policy/shelves';

import { LibraryConfig, LibraryPaths, SECTIONS } from './paths';

const SECTION_LABELS: Record<LibrarySection, string> = { movies: 'Films', series: 'Séries' };

const SHELF_LABELS: Record<string, string> = { standard: '', kids: 'enfants' };

const sharedName = (shelf: string, section: LibrarySection): string =>
  [SECTION_LABELS[section], SHELF_LABELS[shelf] ?? shelf].filter(Boolean).join(' ');

type Fs = Pick<typeof fsPromises, 'mkdir' | 'stat'>;

/**
 * Which player libraries exist and who sees them, with the shelves layout: every shared
 * shelf is a pair of libraries (movies, series) seen by the profiles it lists, every personal
 * shelf a pair seen by its owner only, once it holds something. Kids accounts also get the
 * player's parental limit, a safety net under the kids shelf's own rules.
 */
export class LibraryAccess {
  constructor(
    private readonly config: LibraryConfig & { kidsMaxParentalRating: number },
    private readonly paths: LibraryPaths,
    private readonly fs: Fs = fsPromises,
  ) {}

  get enabled(): boolean {
    return this.config.layout === 'shelves';
  }

  /** Every library the shelves need; their folders are created so the player can serve them. */
  async libraries(users: UserEntity[]): Promise<PlayerLibrary[]> {
    const shared = SHELVES.flatMap(({ key }) =>
      SECTIONS.map((section) => ({ name: sharedName(key, section), section, folder: this.paths.shelf(key, section) })),
    );
    const personal = (
      await Promise.all(users.map(async (user) => ((await this.hasPersonalShelf(user.id)) ? [user] : [])))
    )
      .flat()
      .flatMap((user) =>
        SECTIONS.map((section) => ({
          name: `${SECTION_LABELS[section]} · ${user.name}`,
          section,
          folder: this.paths.personal(user.id, section),
        })),
      );
    const all = [...shared, ...personal];
    await Promise.all(all.map(({ folder }) => this.fs.mkdir(folder, { recursive: true })));
    return all.map(({ name, section, folder }) => ({ name, section, path: this.paths.forPlayer(folder) }));
  }

  /** What the account sees; nothing to decide with the legacy layout. */
  async policyOf(user: UserEntity): Promise<Pick<AccountPolicy, 'libraries' | 'maxParentalRating'>> {
    if (!this.enabled) {
      return {};
    }
    const shared = SHELVES.filter((shelf) => shelf.profiles.includes(user.profile)).flatMap(({ key }) =>
      SECTIONS.map((section) => this.paths.shelf(key, section)),
    );
    const personal = (await this.hasPersonalShelf(user.id))
      ? SECTIONS.map((section) => this.paths.personal(user.id, section))
      : [];
    return {
      libraries: {
        paths: [...shared, ...personal].map((folder) => this.paths.forPlayer(folder)),
        managedRoot: this.config.playerRoot,
      },
      maxParentalRating: user.profile === 'kids' ? this.config.kidsMaxParentalRating : null,
    };
  }

  private async hasPersonalShelf(userId: string): Promise<boolean> {
    const found = await Promise.all(
      SECTIONS.map((section) =>
        this.fs.stat(this.paths.personal(userId, section)).then(
          () => true,
          () => false,
        ),
      ),
    );
    return found.some(Boolean);
  }
}
