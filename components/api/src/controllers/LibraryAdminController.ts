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
import { Request, Response } from 'express';
import { z } from 'zod';

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
  LibraryRow,
  selectRows,
  SHELF_CHOICES,
  SHELF_LABELS,
  ShelfChoice,
} from '@/services/library/admin-view';
import { PolicyShelfResolver } from '@/services/library/resolver';
import { LibraryShelves } from '@/services/library/shelves';
import { PolicyService } from '@/services/policy/policy';
import { adminLibraryTemplate, libraryRow, viewInput } from '@/web/templates/admin-library';

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
    const { rows, users } = await this.view();
    return adminLibraryTemplate({
      serviceName: this.contextService.name,
      filter,
      unplaced: rows.filter((row) => row.unplaced).length,
      ...selectRows(rows, filter),
      users,
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
      await this.answer(req, res, imdbId, view, 'Étagère inconnue', true);
      return;
    }
    this.reshelve();
    await this.answer(req, res, imdbId, view, shelf === 'auto' ? 'Rendu aux règles' : `Placé : ${SHELF_LABELS[shelf]}`);
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
    if (!user || user.guest || (action !== 'grant' && action !== 'revoke')) {
      await this.answer(req, res, imdbId, view, 'Abonné ou action inconnus', true);
      return;
    }
    if (action === 'grant') {
      await this.exemptions.grantPersonal(user.id, imdbId, 'admin', this.actor(req));
    } else {
      await this.exemptions.revokePersonal(user.id, imdbId, this.actor(req));
    }
    this.reshelve();
    const done = action === 'grant' ? `Ajouté à l’étagère de ${user.name}` : `Retiré de l’étagère de ${user.name}`;
    await this.answer(req, res, imdbId, view, done);
  }

  /** Every title and where it is, from a handful of batched reads: nothing is assessed here. */
  private async view(): Promise<{ rows: LibraryRow[]; users: { id: string; name: string }[] }> {
    const stored = await this.titles.list();
    const titles = [...new Map(stored.map((title) => [title.imdbId, title])).values()];
    const [shelvesOf, overrides, grants, users, nameOf, placementOf] = await Promise.all([
      this.resolver.shelvesOf(stored, { assess: false }),
      this.overrides.listAll(),
      this.exemptions.listGrantedPersonal(),
      this.users.list(),
      this.medias.displayTitlesOf(titles.map((title) => title.imdbId)),
      this.policy.storedPlacements(),
    ]);
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
    const active = users
      .filter((user) => user.status === 'active' && !user.guest)
      .map((user) => ({ id: user.id, name: user.name }));
    return { rows, users: active };
  }

  /** A chip (JSON) gets the message and its title's new line; a plain form goes back to the list. */
  private async answer(
    req: Request,
    res: Response,
    imdbId: string,
    view: unknown,
    message: string,
    error = false,
  ): Promise<void> {
    if (!String(req.headers.accept ?? '').includes('application/json')) {
      back(res, view, message, error);
      return;
    }
    const { rows, users } = await this.view();
    const row = rows.find((candidate) => candidate.imdbId === imdbId);
    const filter = parseFilter(Object.fromEntries(new URLSearchParams(String(view ?? ''))));
    res.json({ message, error, row: row ? libraryRow(row, users, viewInput(filter)) : null });
  }

  private actor(req: Request): string {
    return `dashboard:${(req as Request & { adminUserId?: string }).adminUserId ?? 'unknown'}`;
  }

  /** The links follow in the background; the page shows the decision at once. */
  private reshelve(): void {
    this.shelves.reconcile().catch((error: unknown) => {
      LibraryAdminController.logger.warn(`Reshelving failed: ${describeError(error)}`);
    });
  }
}
