import {
  Body,
  Controller,
  Get,
  Header,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { z } from 'zod';

import { Config } from '@/app.module';
import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { ContextService } from '@/services/context';
import { LibraryTitlesRepository, ShelfOverridesRepository } from '@/services/database/library';
import { MediasRepository } from '@/services/database/medias';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import {
  buildLibraryView,
  filterQuery,
  LIBRARY_SHELF_FILTERS,
  LIBRARY_SORTS,
  LIBRARY_STATES,
  LibraryFilter,
  selectRows,
  SHELF_CHOICES,
  SHELF_LABELS,
  ShelfChoice,
} from '@/services/library/admin-view';
import { PolicyShelfResolver } from '@/services/library/resolver';
import { LibraryShelves } from '@/services/library/shelves';
import { PolicyService } from '@/services/policy/policy';
import { adminLibraryTemplate } from '@/web/templates/admin-library';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isShelfChoice = (value: unknown): value is ShelfChoice => SHELF_CHOICES.includes(value as ShelfChoice);

/** Any unknown or malformed value falls back to "no filter", never to an error page. */
const filterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .catch(undefined)
    .transform((value) => value || undefined),
  type: z.enum(['movies', 'series']).optional().catch(undefined),
  shelf: z.enum(LIBRARY_SHELF_FILTERS).optional().catch(undefined),
  state: z.enum(LIBRARY_STATES).optional().catch(undefined),
  sort: z.enum(LIBRARY_SORTS).catch('attention'),
  page: z.coerce.number().int().min(1).catch(1),
});

const parseFilter = (query: unknown): LibraryFilter => filterSchema.parse(query ?? {});

/** Back to the list as it was filtered (the query is parsed again: a form field never becomes a redirect). */
const back = (res: Response, view: unknown, message: string, error = false): void => {
  const kept = filterQuery(parseFilter(Object.fromEntries(new URLSearchParams(String(view ?? '')))));
  res.redirect(
    `/admin/library?${kept ? `${kept}&` : ''}message=${encodeURIComponent(message)}${error ? '&error=1' : ''}`,
  );
};

/** Every title of the store and where it is shown; the admin moves it between shelves. */
@Controller('admin/library')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class LibraryAdminController {
  private static readonly logger = new Logger(LibraryAdminController.name);

  constructor(
    private readonly config: ConfigService<Config, true>,
    private readonly contextService: ContextService,
    private readonly titles: LibraryTitlesRepository,
    private readonly overrides: ShelfOverridesRepository,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly medias: MediasRepository,
    private readonly users: UsersRepository,
    private readonly policy: PolicyService,
    private readonly resolver: PolicyShelfResolver,
    private readonly shelves: LibraryShelves,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async list(
    @Query() query: Record<string, unknown>,
    @Query('message') message?: string,
    @Query('error') error?: string,
  ): Promise<string> {
    const filter = parseFilter(query);
    const stored = await this.titles.list();
    const titles = [...new Map(stored.map((title) => [title.imdbId, title])).values()];
    const imdbIds = titles.map((title) => title.imdbId);
    const [shelvesOf, overrides, grants, users, names, computed] = await Promise.all([
      this.resolver.shelvesOf(stored),
      this.overrides.listAll(),
      this.exemptions.listGrantedPersonal(),
      this.users.list(),
      Promise.all(imdbIds.map(async (imdbId) => [imdbId, await this.medias.titlesOf(imdbId)] as const)),
      Promise.all(
        imdbIds.map(async (imdbId) => [imdbId, await this.policy.placementOf(imdbId).catch(() => null)] as const),
      ),
    ]);
    const nameOf = new Map(names.map(([imdbId, known]) => [imdbId, known?.frenchTitle ?? known?.title ?? imdbId]));
    const placementOf = new Map(computed);
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    const rows = buildLibraryView({
      titles,
      titleOf: (imdbId) => nameOf.get(imdbId) ?? imdbId,
      computedOf: (imdbId) => placementOf.get(imdbId) ?? null,
      overrides,
      sharedOf: (imdbId) => shelvesOf(imdbId).shared,
      grantsOf: (imdbId) => grants.get(imdbId) ?? [],
      userNameOf: (userId) => userNames.get(userId) ?? userId,
    });
    return adminLibraryTemplate({
      serviceName: this.contextService.name,
      layout: this.config.get('library').layout,
      mode: this.policy.mode,
      filter,
      unplaced: rows.filter((row) => row.unplaced).length,
      ...selectRows(rows, filter),
      users: users.filter((user) => user.status === 'active').map((user) => ({ id: user.id, name: user.name })),
      flashMessage: message,
      flashError: error === '1',
    });
  }

  @Post(':imdbId/shelf')
  async place(
    @Param('imdbId') imdbId: string,
    @Body('shelf') shelf: string | undefined,
    @Body('view') view: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (shelf === 'auto') {
      await this.overrides.clear(imdbId);
    } else if (isShelfChoice(shelf)) {
      await this.overrides.set({ imdbId, shelf, origin: 'admin' }, this.actor(req));
    } else {
      back(res, view, 'Étagère inconnue', true);
      return;
    }
    this.reshelve();
    back(res, view, shelf === 'auto' ? 'Rendu aux règles' : `Placé : ${SHELF_LABELS[shelf]}`);
  }

  @Post(':imdbId/personal')
  async personal(
    @Param('imdbId') imdbId: string,
    @Body('userId') userId: string | undefined,
    @Body('action') action: string | undefined,
    @Body('view') view: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = userId ? await this.users.get(userId) : null;
    if (!user || (action !== 'grant' && action !== 'revoke')) {
      back(res, view, 'Abonné ou action inconnus', true);
      return;
    }
    if (action === 'grant') {
      await this.exemptions.grantPersonal(user.id, imdbId, 'admin', this.actor(req));
    } else {
      await this.exemptions.revokePersonal(user.id, imdbId, this.actor(req));
    }
    this.reshelve();
    back(res, view, action === 'grant' ? `Ajouté à l’étagère de ${user.name}` : `Retiré de l’étagère de ${user.name}`);
  }

  private actor(req: Request): string {
    return `dashboard:${(req as Request & { adminUserId?: string }).adminUserId ?? 'unknown'}`;
  }

  /** The links follow in the background (shelves layout only: legacy has no links); the page shows the decision at once. */
  private reshelve(): void {
    if (this.config.get('library').layout !== 'shelves') {
      return;
    }
    this.shelves.reconcile().catch((error: unknown) => {
      LibraryAdminController.logger.warn(`Reshelving failed: ${describeError(error)}`);
    });
  }
}
