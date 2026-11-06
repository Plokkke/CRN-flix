import { z } from 'zod';

import { certificationKey, MESSAGE_FIELD, noticeOf, PolicyKind } from '@crn-flix/contracts';

export const adultParamsSchema = z.object({
  /** Certifications that mark adult content, `COUNTRY:RATING` (e.g. `FR:18`, `US:NC-17`). */
  certifications: z.array(z.string()).default([]),
  message: z.string().optional(),
});

export type AdultParams = z.infer<typeof adultParamsSchema>;

const HEADLINE = 'Contenu réservé aux adultes';

/** Refuses what the metadata source flags as adult, or what carries one of the listed certifications. */
export const adultPolicy: PolicyKind<AdultParams, never> = {
  name: 'adult',
  description: 'Refuse le contenu marqué « adulte » par la source et les certifications listées.',
  scope: 'content',
  params: {
    schema: adultParamsSchema,
    fields: [
      {
        name: 'certifications',
        label: 'Certifications adultes',
        type: 'list',
        optional: true,
        help: 'Une par ligne, PAYS:CLASSIFICATION (FR:18, US:NC-17).',
      },
      MESSAGE_FIELD,
    ],
  },
  entries: null,
  evaluate(subject, { params }) {
    const facts = subject.facts;
    if (!facts) {
      return null;
    }
    const listed = new Set(params.certifications.map((key) => key.toUpperCase()));
    const certified = facts.certifications.map(certificationKey).filter((key) => listed.has(key));
    const reasons = [
      ...(facts.adult ? ['Marqué « adulte » par la source'] : []),
      ...certified.map((key) => `Classé ${key}`),
    ];
    return reasons.length === 0
      ? []
      : [
          {
            summary: reasons.join(', '),
            notice: noticeOf(HEADLINE, params.message, [
              { type: 'facts', items: [{ label: 'Classification', value: reasons.join(', ') }] },
            ]),
          },
        ];
  },
};
