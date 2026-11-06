import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PolicyKind } from '@crn-flix/contracts';
import { PolicyKinds } from '@crn-flix/policy';
import { adultPolicy } from '@crn-flix/policy-adult';
import { attributesPolicy } from '@crn-flix/policy-attributes';
import { creditsPolicy } from '@crn-flix/policy-credits';
import { titlesPolicy } from '@crn-flix/policy-titles';

import { Config } from '@/app.module';
import { ContextService } from '@/services/context';
import { ShelfOverridesRepository } from '@/services/database/library';
import { MediasRepository } from '@/services/database/medias';
import {
  PolicyAssessmentsRepository,
  PolicyExemptionsRepository,
  PolicyRefusalsRepository,
  PolicyRulesRepository,
} from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { LibraryShelves } from '@/services/library/shelves';
import { MediaFactsService } from '@/services/media-facts';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
import { PolicyAppealService } from '@/services/policy/appeal';
import { PolicyGate } from '@/services/policy/gate';
import { PolicyService } from '@/services/policy/policy';
import { PolicyRefusalNotices } from '@/services/policy/refusal-notices';
import { TicketService } from '@/services/tickets/ticket.service';

export const POLICY_KINDS = Symbol('PolicyKinds');

/** Where a subscriber appeals a refusal (login first when needed). */
export const appealUrl = (context: ContextService, imdbId: string): string =>
  `${context.userSpaceUrl}/policy/${encodeURIComponent(imdbId)}/appeal`;

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
      ShelfOverridesRepository,
    ],
    useFactory: (
      configService: ConfigService<Config, true>,
      kinds: PolicyKinds,
      rules: PolicyRulesRepository,
      assessments: PolicyAssessmentsRepository,
      exemptions: PolicyExemptionsRepository,
      facts: MediaFactsService,
      medias: MediasRepository,
      overrides: ShelfOverridesRepository,
    ): PolicyService =>
      new PolicyService(configService.get('policy'), kinds, rules, assessments, exemptions, facts, medias, (imdbId) =>
        overrides.get(imdbId),
      ),
  },
  {
    provide: PolicyGate,
    inject: [PolicyService, UsersRepository, PolicyRefusalsRepository],
    useFactory: (policy: PolicyService, users: UsersRepository, refusals: PolicyRefusalsRepository): PolicyGate =>
      new PolicyGate(policy, users, refusals),
  },
  {
    provide: PolicyRefusalNotices,
    inject: [
      PolicyService,
      PolicyRefusalsRepository,
      UsersRepository,
      MediasRepository,
      AllUserMessaging,
      ContextService,
    ],
    useFactory: (
      policy: PolicyService,
      refusals: PolicyRefusalsRepository,
      users: UsersRepository,
      medias: MediasRepository,
      messaging: AllUserMessaging,
      context: ContextService,
    ): PolicyRefusalNotices =>
      new PolicyRefusalNotices(policy, refusals, users, medias, messaging, (imdbId) => appealUrl(context, imdbId)),
  },
  {
    provide: PolicyAppealService,
    inject: [
      TicketService,
      PolicyExemptionsRepository,
      PolicyRefusalsRepository,
      UsersRepository,
      MediasRepository,
      AllUserMessaging,
      PlannerService,
      LibraryShelves,
    ],
    useFactory: (
      tickets: TicketService,
      exemptions: PolicyExemptionsRepository,
      refusals: PolicyRefusalsRepository,
      users: UsersRepository,
      medias: MediasRepository,
      messaging: AllUserMessaging,
      planner: PlannerService,
      shelves: LibraryShelves,
    ): PolicyAppealService =>
      new PolicyAppealService(tickets, exemptions, refusals, users, medias, messaging, planner, shelves),
  },
];
