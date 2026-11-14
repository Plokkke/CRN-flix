import { Logger } from '@nestjs/common';

import { Placement } from '@crn-flix/policy';

import { LibraryTitle, ShelfOverridesRepository } from '@/services/database/library';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { PolicyService } from '@/services/policy/policy';
import { Profile, SHELVES } from '@/services/policy/shelves';

import { TitleShelves } from './links';
import { ShelfResolver } from './shelves';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const sees = (profile: Profile, shelf: string): boolean =>
  SHELVES.some((candidate) => candidate.key === shelf && candidate.profiles.includes(profile));

/**
 * Where each title of the store is shown. The admin's choice prevails; otherwise, once the
 * policy is enforced, its classification (restricted, kids, standard), and before that the
 * standard shelf as always. A personal exemption adds the title to its user's shelf, unless
 * the user already sees it on a shared shelf or is a guest (no personal shelf).
 */
export class PolicyShelfResolver implements ShelfResolver {
  private static readonly logger = new Logger(PolicyShelfResolver.name);

  readonly sharedShelves = SHELVES.map((shelf) => shelf.key);

  constructor(
    private readonly policy: PolicyService,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly overrides: ShelfOverridesRepository,
    private readonly users: UsersRepository,
  ) {}

  /**
   * `assess: false` (a page) only reads what is assessed already; otherwise (the reconciler) a
   * title not assessed under the current rules is assessed now.
   */
  async shelvesOf(titles: LibraryTitle[], { assess = true } = {}): Promise<(imdbId: string) => TitleShelves> {
    const [overrides, personalGrants, users] = await Promise.all([
      this.overrides.list(),
      this.exemptions.listGrantedPersonal(),
      this.users.list(),
    ]);
    const overrideOf = (imdbId: string): string | null => overrides.get(imdbId) ?? null;
    const stored = await this.policy.storedPlacements(overrideOf);
    const profileOf = new Map(users.filter((user) => !user.guest).map((user) => [user.id, user.profile]));
    const shared = new Map<string, string | null>();
    for (const imdbId of new Set(titles.map((title) => title.imdbId))) {
      shared.set(imdbId, await this.sharedShelfOf(imdbId, overrideOf(imdbId), stored.get(imdbId), assess));
    }
    return (imdbId) => {
      const shelf = shared.get(imdbId) ?? null;
      const personal = (personalGrants.get(imdbId) ?? []).filter((userId) => {
        const profile = profileOf.get(userId);
        return profile !== undefined && !(shelf && sees(profile, shelf));
      });
      return { shared: shelf, personal };
    };
  }

  /** A title that cannot be placed now (never assessed, source down) stays off the shared shelves until it can. */
  private async sharedShelfOf(
    imdbId: string,
    override: string | null,
    stored: Placement | undefined,
    assess: boolean,
  ): Promise<string | null> {
    try {
      const placement = stored ?? (assess ? await this.policy.placementOf(imdbId, override) : null);
      return placement?.kind === 'shelf' ? placement.shelf : null;
    } catch (error) {
      PolicyShelfResolver.logger.warn(`Cannot place ${imdbId} for now: ${describeError(error)}`);
      return null;
    }
  }
}
