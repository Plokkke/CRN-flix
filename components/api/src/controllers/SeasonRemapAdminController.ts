import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { ContextService } from '@/services/context';
import { Assignment } from '@/services/library/episode-remap';
import { RemapRefusedError, SeasonRemapService } from '@/services/library/season-remap';
import { adminSeasonRemapTemplate } from '@/web/templates/admin-season-remap';

const seasonSchema = z.coerce.number().int().min(0).max(999);

/** One value or several: a form repeats a field once per line. */
const repeated = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (value === undefined ? [] : [value].flat()));

const applySchema = z
  .object({ season: seasonSchema, file: repeated, start: repeated, end: repeated })
  .refine((form) => form.file.length === form.start.length && form.file.length === form.end.length, {
    message: 'Formulaire incomplet',
  });

/** A line without a first episode is left alone; a missing last episode means a single one. */
const assignmentsOf = ({ file, start, end }: z.infer<typeof applySchema>): Assignment[] =>
  file.flatMap((relativePath, index) => {
    const first = Number(start[index]);
    if (!start[index]?.trim() || !Number.isFinite(first)) {
      return [];
    }
    return [{ relativePath, start: first, end: end[index]?.trim() ? Number(end[index]) : first }];
  });

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One season of a show at a time: which episodes each of its files holds. */
@Controller('admin/library/:imdbId/episodes')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class SeasonRemapAdminController {
  constructor(
    private readonly contextService: ContextService,
    private readonly remap: SeasonRemapService,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async show(
    @Param('imdbId') imdbId: string,
    @Query('season') season?: string,
    @Query('message') message?: string,
    @Query('error') error?: string,
  ): Promise<string> {
    const parsed = seasonSchema.safeParse(season);
    const page = await this.remap.page(imdbId, parsed.success ? parsed.data : null);
    if (!page) {
      throw new NotFoundException(`Aucun fichier de série pour ${imdbId}`);
    }
    return adminSeasonRemapTemplate({
      serviceName: this.contextService.name,
      page,
      flashMessage: message,
      flashError: error === '1',
    });
  }

  @Post('apply')
  async apply(@Param('imdbId') imdbId: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const form = applySchema.safeParse(body);
    if (!form.success) {
      back(res, imdbId, null, 'Formulaire invalide', true);
      return;
    }
    try {
      const moved = await this.remap.apply(imdbId, form.data.season, assignmentsOf(form.data));
      const done = moved > 0 ? `${moved} fichier(s) renommé(s), Jellyfin réanalyse la bibliothèque` : 'Rien à renommer';
      back(res, imdbId, form.data.season, done);
    } catch (error) {
      const refused = error instanceof RemapRefusedError;
      back(
        res,
        imdbId,
        form.data.season,
        refused ? error.message : `Échec, renommages annulés : ${describeError(error)}`,
        true,
      );
    }
  }

  @Post('refresh')
  refresh(@Param('imdbId') imdbId: string, @Body('season') season: string | undefined, @Res() res: Response): void {
    this.remap.refreshInBackground();
    const parsed = seasonSchema.safeParse(season);
    back(res, imdbId, parsed.success ? parsed.data : null, 'Réanalyse de la bibliothèque Jellyfin demandée');
  }
}

function back(res: Response, imdbId: string, season: number | null, message: string, error = false): void {
  const query = new URLSearchParams({ ...(season === null ? {} : { season: String(season) }), message });
  if (error) {
    query.set('error', '1');
  }
  res.redirect(`/admin/library/${encodeURIComponent(imdbId)}/episodes?${query}`);
}
