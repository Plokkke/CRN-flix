import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PolicyKind } from '@crn-flix/contracts';
import { PolicyKinds } from '@crn-flix/policy';
import { adultPolicy } from '@crn-flix/policy-adult';
import { attributesPolicy } from '@crn-flix/policy-attributes';
import { creditsPolicy } from '@crn-flix/policy-credits';
import { titlesPolicy } from '@crn-flix/policy-titles';

import { Config } from '@/app.module';
import { MediasRepository } from '@/services/database/medias';
import {
  PolicyAssessmentsRepository,
  PolicyExemptionsRepository,
  PolicyRulesRepository,
} from '@/services/database/policy';
import { MediaFactsService } from '@/services/media-facts';
import { PolicyService } from '@/services/policy/policy';

export const POLICY_KINDS = Symbol('PolicyKinds');

/** The kinds of rule this engine is composed with; concrete rules name one of them. */
const KINDS: PolicyKind[] = [creditsPolicy, adultPolicy, attributesPolicy, titlesPolicy] as PolicyKind[];

export const policyProviders: Provider[] = [
  {
    provide: POLICY_KINDS,
    useValue: new Map(KINDS.map((kind) => [kind.name, kind])) satisfies PolicyKinds,
  },
  {
    provide: PolicyService,
    inject: [
      ConfigService,
      POLICY_KINDS,
      PolicyRulesRepository,
      PolicyAssessmentsRepository,
      PolicyExemptionsRepository,
      MediaFactsService,
      MediasRepository,
    ],
    useFactory: (
      configService: ConfigService<Config, true>,
      kinds: PolicyKinds,
      rules: PolicyRulesRepository,
      assessments: PolicyAssessmentsRepository,
      exemptions: PolicyExemptionsRepository,
      facts: MediaFactsService,
      medias: MediasRepository,
    ): PolicyService =>
      new PolicyService(configService.get('policy'), kinds, rules, assessments, exemptions, facts, medias),
  },
];
