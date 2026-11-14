import { Logger } from '@nestjs/common';

import { TicketOperationKind } from '@crn-flix/contracts';

import { ShelfOverridesRepository } from '@/services/database/library';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { PolicyService } from '@/services/policy/policy';

import { LibraryShelves } from './shelves';

export type ManualDestination = 'standard' | 'kids' | 'personal';

export const DESTINATION_BY_OPERATION: Partial<Record<TicketOperationKind, ManualDestination>> = {
  shelveStandard: 'standard',
  shelveKids: 'kids',
  shelvePersonal: 'personal',
};

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Where an admin's manual download goes, never blocked by the rules. A shared shelf is the
 * admin's choice and lets the title through every rule for everyone; the admin's collection
 * keeps it off the shared shelves (until a subscriber's admitted request publishes it).
 * Without a choice the rules place the title, and a title they restrict goes to the admin's
 * collection: never blocked, never exposed.
 */
export class ManualDestinations {
  private static readonly logger = new Logger(ManualDestinations.name);

  constructor(
    private readonly overrides: ShelfOverridesRepository,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly users: UsersRepository,
    private readonly policy: PolicyService,
    private readonly shelves: LibraryShelves,
    /** The admin's own account (`users.name`), whose collection takes personal downloads. */
    private readonly adminUserName: string | null,
  ) {}

  /** Null when applied, the reason otherwise. */
  async apply(imdbId: string, destination: ManualDestination, actor: string): Promise<string | null> {
    if (destination === 'personal') {
      const admin = this.adminUserName ? await this.users.getByName(this.adminUserName) : null;
      if (!admin) {
        return 'Collection de l’admin introuvable : ADMIN_USER_NAME doit nommer son compte';
      }
      await this.overrides.set({ imdbId, shelf: 'none', origin: 'manual-download' }, actor);
      await this.exemptions.grantPersonal(admin.id, imdbId, 'manual-download', actor);
    } else {
      await this.overrides.set({ imdbId, shelf: destination, origin: 'manual-download' }, actor);
      await this.exemptions.grantGlobal(imdbId, [null], 'manual-download', actor);
    }
    await this.shelves.reconcile().catch((error: unknown) => {
      ManualDestinations.logger.warn(`Shelves after manual destination on ${imdbId}: ${describeError(error)}`);
    });
    return null;
  }

  /** No choice made: what the rules restrict goes to the admin's collection, the rest where the rules put it. */
  async applyDefault(imdbId: string, actor: string): Promise<void> {
    const placement = await this.policy.placementOf(imdbId).catch(() => null);
    if (this.policy.mode === 'enforce' && placement?.kind === 'restricted') {
      const problem = await this.apply(imdbId, 'personal', actor);
      if (problem) {
        ManualDestinations.logger.warn(`Restricted manual download ${imdbId} left off the shelves: ${problem}`);
      }
    }
  }
}
