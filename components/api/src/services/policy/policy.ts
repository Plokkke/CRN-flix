import { createHash } from 'crypto';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import {
  admit,
  Admission,
  assess,
  classify,
  Placement,
  PolicyKinds,
  PolicyRuleRecord,
  RuleOutcome,
  ShelfOverride,
} from '@crn-flix/policy';

import { MediasRepository } from '@/services/database/medias';
import {
  PolicyAssessmentsRepository,
  PolicyExemptionsRepository,
  PolicyRulesRepository,
} from '@/services/database/policy';
import { FACTS_SCHEMA_VERSION, MediaFactsService } from '@/services/media-facts';

import { Profile, SHELVES } from './shelves';

export const policyConfigSchema = z.object({ mode: z.enum(['off', 'dry-run', 'enforce']) });

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/** Bump when the assessment logic changes: every title is assessed again. */
const ASSESSMENT_VERSION = 1;
const REFRESH_BATCH = 200;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Identifies the rules (and their entries) an assessment was computed with. */
export function rulesFingerprint(rules: PolicyRuleRecord[]): string {
  const payload = JSON.stringify({ version: ASSESSMENT_VERSION, facts: FACTS_SCHEMA_VERSION, rules });
  return createHash('sha256').update(payload).digest('hex');
}

function describePlacement(placement: Placement): string {
  if (placement.kind === 'restricted') {
    return `restricted (${placement.refusals.map((refusal) => `${refusal.ruleName}: ${refusal.summary}`).join(' | ')})`;
  }
  return placement.kind === 'held' ? 'held by the admin' : `shelf ${placement.shelf}`;
}

/**
 * Judges every title against the enabled rules on its content alone, once per title and
 * rule set (persisted in `policy_assessments`), then derives where the title goes and whether
 * a requester gets it from that assessment, the exemptions and the requester's profile.
 */
export class PolicyService {
  private static readonly logger = new Logger(PolicyService.name);

  constructor(
    private readonly config: PolicyConfig,
    private readonly kinds: PolicyKinds,
    private readonly rules: PolicyRulesRepository,
    private readonly assessments: PolicyAssessmentsRepository,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly facts: MediaFactsService,
    private readonly medias: MediasRepository,
    private readonly overrideOf: (imdbId: string) => Promise<ShelfOverride> = async () => null,
  ) {}

  get mode(): PolicyConfig['mode'] {
    return this.config.mode;
  }

  /** The title's outcomes under the current rules, assessed now when stale; null when the title is unknown. */
  async outcomesOf(imdbId: string): Promise<RuleOutcome[] | null> {
    const rules = await this.rules.listEnabled();
    const fingerprint = rulesFingerprint(rules);
    const stored = await this.assessments.get(imdbId);
    if (stored?.fingerprint === fingerprint) {
      return stored.outcomes;
    }
    return this.assessAndStore(imdbId, rules, fingerprint);
  }

  async placementOf(imdbId: string, override: ShelfOverride = null): Promise<Placement | null> {
    const outcomes = await this.outcomesOf(imdbId);
    return outcomes && this.classify(imdbId, outcomes, override);
  }

  async admissionOf(userId: string, profile: Profile, imdbId: string): Promise<Admission | null> {
    const admissions = await this.admissionsOf(imdbId, [{ id: userId, profile }]);
    return admissions?.get(userId) ?? null;
  }

  /** Each requester's admission, from one assessment; null when the title is unknown. */
  async admissionsOf(
    imdbId: string,
    requesters: { id: string; profile: Profile }[],
  ): Promise<Map<string, Admission> | null> {
    const outcomes = await this.outcomesOf(imdbId);
    if (!outcomes) {
      return null;
    }
    const [exemptions, override] = await Promise.all([this.exemptions.listGranted(imdbId), this.overrideOf(imdbId)]);
    return new Map(
      requesters.map(({ id, profile }) => {
        const theirs = exemptions.filter((exemption) => exemption.userId === null || exemption.userId === id);
        return [id, admit(outcomes, SHELVES, profile, theirs, override)];
      }),
    );
  }

  /** Hourly-ish pass: assesses the stale titles, logging where each one goes. */
  async refresh(): Promise<void> {
    const rules = await this.rules.listEnabled();
    const fingerprint = rulesFingerprint(rules);
    const imdbIds = await this.assessments.listStale(fingerprint, REFRESH_BATCH);
    let failed = 0;
    for (const imdbId of imdbIds) {
      try {
        const outcomes = await this.assessAndStore(imdbId, rules, fingerprint);
        if (outcomes) {
          this.logPlacement(imdbId, await this.classify(imdbId, outcomes));
        }
      } catch (error) {
        failed += 1;
        PolicyService.logger.warn(`Policy assessment failed for ${imdbId}: ${describeError(error)}`);
      }
    }
    if (imdbIds.length > 0) {
      PolicyService.logger.log(`Assessed ${imdbIds.length - failed}/${imdbIds.length} title(s) (${this.mode})`);
    }
  }

  private async assessAndStore(
    imdbId: string,
    rules: PolicyRuleRecord[],
    fingerprint: string,
  ): Promise<RuleOutcome[] | null> {
    const titles = await this.medias.titlesOf(imdbId);
    if (!titles) {
      return null;
    }
    const facts = await this.facts.ensure(imdbId);
    const outcomes = assess(this.kinds, rules, { imdbId, titles, facts, requester: null });
    await this.assessments.save(imdbId, outcomes, fingerprint);
    return outcomes;
  }

  private async classify(imdbId: string, outcomes: RuleOutcome[], override: ShelfOverride = null): Promise<Placement> {
    const globals = (await this.exemptions.listGranted(imdbId)).filter((exemption) => exemption.userId === null);
    return classify(outcomes, SHELVES, globals, override);
  }

  /** Standard is where nearly everything goes: only the other placements are worth a line. */
  private logPlacement(imdbId: string, placement: Placement): void {
    if (!(placement.kind === 'shelf' && placement.shelf === 'standard')) {
      PolicyService.logger.log(`Policy (${this.mode}): ${imdbId} → ${describePlacement(placement)}`);
    }
  }
}
