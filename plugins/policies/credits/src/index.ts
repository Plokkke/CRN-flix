import { z } from 'zod';

import { MediaCredit, MESSAGE_FIELD, noticeOf, PolicyKind, PolicyMatch } from '@crn-flix/contracts';

export const creditsParamsSchema = z.object({
  /** Source departments that count (`Acting`, `Directing`, `Writing`, `Production`, `Creator`); empty = all. */
  departments: z.array(z.string()).default([]),
  /** Source jobs that count (`Director`, `Producer`…); empty = all. */
  jobs: z.array(z.string()).default([]),
  /** Cast only: ignore actors billed after this rank (0 = top billing). */
  maxBillingOrder: z.number().int().min(0).optional(),
  /** Shows only: ignore people credited on fewer episodes (guests). */
  minEpisodes: z.number().int().min(1).optional(),
  message: z.string().optional(),
});

export const personEntrySchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  /** What the person did, as the sources report it: the reason of the house's policy, not a verdict. */
  allegations: z.string().min(1),
  sources: z.array(z.object({ label: z.string().min(1), url: z.url() })).min(1),
});

export type CreditsParams = z.infer<typeof creditsParamsSchema>;
export type PersonEntry = z.infer<typeof personEntrySchema>;

const JOB_LABELS: Record<string, string> = {
  Actor: 'Interprétation',
  Creator: 'Création',
  Director: 'Réalisation',
  Writer: 'Scénario',
  Screenplay: 'Scénario',
  Producer: 'Production',
  'Executive Producer': 'Production exécutive',
};

const isIn = (allowed: string[], value: string): boolean =>
  allowed.length === 0 || allowed.some((item) => item.toLowerCase() === value.toLowerCase());

function counts(credit: MediaCredit, params: CreditsParams): boolean {
  const billed =
    params.maxBillingOrder === undefined ||
    credit.billingOrder === null ||
    credit.billingOrder <= params.maxBillingOrder;
  const regular =
    params.minEpisodes === undefined || credit.episodeCount === null || credit.episodeCount >= params.minEpisodes;
  return isIn(params.departments, credit.department) && isIn(params.jobs, credit.job) && billed && regular;
}

function roleLabel(credit: MediaCredit): string {
  const job = JOB_LABELS[credit.job] ?? credit.job;
  return credit.character ? `${job} (${credit.character})` : job;
}

function matchOf(person: PersonEntry, credits: MediaCredit[], message: string | undefined): PolicyMatch {
  const roles = [...new Set(credits.map(roleLabel))].join(', ');
  return {
    summary: `${person.name} (${roles})`,
    notice: noticeOf(`Ce titre implique ${person.name}`, message, [
      {
        type: 'facts',
        items: [
          { label: 'Rôle', value: roles },
          { label: 'Faits', value: person.allegations },
        ],
      },
      { type: 'links', title: 'Sources', links: person.sources },
    ]),
  };
}

/**
 * Refuses the titles that credit a listed person in a role the rule targets. People are
 * matched by the metadata source's reference, never by name, so namesakes are left alone;
 * the notice only states what the entry holds (facts, dated sources).
 */
export const creditsPolicy: PolicyKind<CreditsParams, PersonEntry> = {
  name: 'credits',
  description: 'Refuse les titres où une personne de la liste tient un des rôles visés.',
  scope: 'content',
  params: {
    schema: creditsParamsSchema,
    fields: [
      {
        name: 'departments',
        label: 'Départements visés',
        type: 'list',
        optional: true,
        help: 'Acting, Directing, Writing, Production, Creator ; vide = tous.',
      },
      { name: 'jobs', label: 'Postes visés', type: 'list', optional: true, help: 'Director, Producer… ; vide = tous.' },
      {
        name: 'maxBillingOrder',
        label: 'Rang d’affiche maximal (interprètes)',
        type: 'number',
        optional: true,
        help: '0 = tête d’affiche ; vide = tous.',
      },
      {
        name: 'minEpisodes',
        label: 'Épisodes minimum (séries)',
        type: 'number',
        optional: true,
        help: 'Ignore les invités ; vide = tous.',
      },
      MESSAGE_FIELD,
    ],
  },
  entries: {
    key: 'person',
    schema: personEntrySchema,
    fields: [
      { name: 'allegations', label: 'Faits (tels que les sources les rapportent)', type: 'textarea' },
      { name: 'sources', label: 'Sources datées', type: 'links', help: 'Une par ligne : libellé (date) | URL.' },
    ],
  },
  evaluate(subject, { params, entries }) {
    const credits = subject.facts?.credits;
    if (!credits) {
      return null;
    }
    const counted = credits.filter((credit) => counts(credit, params));
    return entries.flatMap((person) => {
      const theirs = counted.filter((credit) => credit.person.ref === person.ref);
      return theirs.length > 0 ? [matchOf(person, theirs, params.message)] : [];
    });
  },
};
