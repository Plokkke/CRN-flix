import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';

import { MetadataSource, PersonCandidate, PolicyKind } from '@crn-flix/contracts';
import { EVERYONE, PolicyKinds } from '@crn-flix/policy';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { METADATA } from '@/providers/media-titles';
import { POLICY_KINDS } from '@/providers/policy';
import { ContextService } from '@/services/context';
import {
  PolicyAssessmentsRepository,
  PolicyExemptionsRepository,
  PolicyRulesRepository,
} from '@/services/database/policy';
import { describeValidationError, FormBody, valuesFromForm } from '@/services/policy/form';
import { buildPolicyOverview } from '@/services/policy/overview';
import { PolicyService, rulesFingerprint } from '@/services/policy/policy';
import { SHELVES } from '@/services/policy/shelves';
import { adminPoliciesTemplate, adminPolicyRuleTemplate } from '@/web/templates/admin-policies';

const AUDIENCES = [EVERYONE, ...SHELVES.map((shelf) => shelf.key)];

const ruleFormSchema = z.object({
  name: z.string().trim().min(1).max(128),
  audience: z.enum(AUDIENCES as [string, ...string[]]),
});

const flashQuery = (message: string, error = false): string =>
  `?message=${encodeURIComponent(message)}${error ? '&error=1' : ''}`;

/** Concrete rules and their entries; every change marks the assessments stale and starts a pass. */
@Controller('admin/policies')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class PoliciesAdminController {
  private static readonly logger = new Logger(PoliciesAdminController.name);

  constructor(
    private readonly contextService: ContextService,
    @Inject(POLICY_KINDS) private readonly kinds: PolicyKinds,
    @Inject(METADATA) private readonly metadata: MetadataSource,
    private readonly rules: PolicyRulesRepository,
    private readonly assessments: PolicyAssessmentsRepository,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly policy: PolicyService,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async list(@Query('message') message?: string, @Query('error') error?: string): Promise<string> {
    const [rules, enabled, assessments, globals] = await Promise.all([
      this.rules.list(),
      this.rules.listEnabled(),
      this.assessments.listWithTitles(),
      this.exemptions.listGrantedGlobal(),
    ]);
    return adminPoliciesTemplate({
      serviceName: this.contextService.name,
      rules,
      kinds: [...this.kinds.values()],
      audiences: AUDIENCES,
      overview: buildPolicyOverview(assessments, rulesFingerprint(enabled), SHELVES, globals),
      flashMessage: message,
      flashError: error === '1',
    });
  }

  @Post()
  async create(@Body() body: FormBody, @Res() res: Response): Promise<void> {
    const kind = this.kinds.get(String(body.kind ?? ''));
    const form = ruleFormSchema.safeParse(body);
    if (!kind || !form.success) {
      res.redirect(`/admin/policies${flashQuery('Nom, type ou public invalide', true)}`);
      return;
    }
    const params = kind.params.schema.parse({});
    const position = (await this.rules.list()).length;
    const id = await this.rules.create({ ...form.data, kind: kind.name, params, enabled: true, position });
    this.reassess();
    res.redirect(`/admin/policies/${id}${flashQuery('Règle créée : renseignez ses paramètres')}`);
  }

  @Get(':id')
  @Header('content-type', 'text/html')
  async show(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('person') personQuery = '',
    @Query('message') message?: string,
    @Query('error') error?: string,
  ): Promise<string | void> {
    const rule = await this.rules.get(id);
    if (!rule) {
      res.redirect(`/admin/policies${flashQuery('Règle introuvable', true)}`);
      return;
    }
    return adminPolicyRuleTemplate({
      serviceName: this.contextService.name,
      rule,
      kind: this.kinds.get(rule.kind) ?? null,
      audiences: AUDIENCES,
      entries: await this.rules.listEntries(id),
      personQuery,
      candidates: await this.searchPeople(personQuery),
      flashMessage: message,
      flashError: error === '1',
    });
  }

  @Post(':id')
  async update(@Param('id') id: string, @Body() body: FormBody, @Res() res: Response): Promise<void> {
    const rule = await this.rules.get(id);
    const kind = rule && this.kinds.get(rule.kind);
    if (!rule || !kind) {
      res.redirect(`/admin/policies${flashQuery('Règle introuvable ou de type inconnu', true)}`);
      return;
    }
    try {
      const form = ruleFormSchema.parse(body);
      const params = kind.params.schema.parse(valuesFromForm(kind.params.fields, body));
      const position = Number.parseInt(String(body.position ?? rule.position), 10) || 0;
      await this.rules.update(id, { ...form, params, position, enabled: body.enabled === 'on' });
    } catch (error) {
      res.redirect(`/admin/policies/${id}${flashQuery(`Refusé : ${describeValidationError(error)}`, true)}`);
      return;
    }
    this.reassess();
    res.redirect(`/admin/policies/${id}${flashQuery('Règle enregistrée : réévaluation lancée')}`);
  }

  @Post(':id/delete')
  async delete(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.rules.delete(id);
    this.reassess();
    res.redirect(`/admin/policies${flashQuery('Règle supprimée')}`);
  }

  @Post(':id/entries')
  async addEntry(@Param('id') id: string, @Body() body: FormBody, @Res() res: Response): Promise<void> {
    const rule = await this.rules.get(id);
    const kind = rule && this.kinds.get(rule.kind);
    if (!rule || !kind?.entries) {
      res.redirect(`/admin/policies${flashQuery('Cette règle n’a pas de liste', true)}`);
      return;
    }
    try {
      const subject = await this.entrySubject(kind, body);
      await this.rules.addEntry(
        id,
        kind.entries.schema.parse({ ...subject, ...valuesFromForm(kind.entries.fields, body) }),
      );
    } catch (error) {
      res.redirect(`/admin/policies/${id}${flashQuery(`Entrée refusée : ${describeValidationError(error)}`, true)}`);
      return;
    }
    this.reassess();
    res.redirect(`/admin/policies/${id}${flashQuery('Entrée ajoutée : réévaluation lancée')}`);
  }

  @Post(':id/entries/:entryId/delete')
  async deleteEntry(@Param('id') id: string, @Param('entryId') entryId: string, @Res() res: Response): Promise<void> {
    await this.rules.deleteEntry(id, entryId);
    this.reassess();
    res.redirect(`/admin/policies/${id}${flashQuery('Entrée retirée : réévaluation lancée')}`);
  }

  /** What identifies the entry: the person picked among namesakes, or the title by its imdb id. */
  private async entrySubject(kind: PolicyKind, body: FormBody): Promise<Record<string, unknown>> {
    if (kind.entries?.key === 'person') {
      const picked = String(body.person ?? '');
      const separator = picked.indexOf('|');
      if (separator < 0) {
        throw new Error('choisissez une personne parmi les résultats de la recherche');
      }
      return { ref: picked.slice(0, separator), name: picked.slice(separator + 1) };
    }
    if (kind.entries?.key === 'media') {
      const imdbId = String(body.imdbId ?? '').trim();
      const typed = String(body.title ?? '').trim();
      const known = typed ? null : await this.metadata.describe(imdbId);
      const title = typed || known?.frenchTitle || known?.title;
      if (!title) {
        throw new Error('la source ne connaît pas ce titre : renseignez-le');
      }
      return { imdbId, title };
    }
    return {};
  }

  private async searchPeople(query: string): Promise<PersonCandidate[]> {
    if (!query.trim()) {
      return [];
    }
    return this.metadata.searchPeople(query.trim()).catch((error: unknown) => {
      PoliciesAdminController.logger.warn(`People search failed: ${describeValidationError(error)}`);
      return [];
    });
  }

  private reassess(): void {
    void this.policy.refresh().catch((error: unknown) => {
      PoliciesAdminController.logger.warn(`Policy reassessment failed: ${describeValidationError(error)}`);
    });
  }
}
