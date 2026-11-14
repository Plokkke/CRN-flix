import { z } from 'zod';

import { certificationKey, FieldSpec, MediaFacts, MESSAGE_FIELD, noticeOf, PolicyKind } from '@crn-flix/contracts';

const list = z.array(z.string()).default([]);

export const attributesParamsSchema = z.object({
  /** Allowed certifications, `COUNTRY:RATING`; only the countries listed are looked at. */
  certifications: list,
  genresAnyOf: list,
  genresNoneOf: list,
  minRuntime: z.number().optional(),
  maxRuntime: z.number().optional(),
  minYear: z.number().optional(),
  maxYear: z.number().optional(),
  languagesAnyOf: list,
  languagesNoneOf: list,
  countriesAnyOf: list,
  countriesNoneOf: list,
  message: z.string().optional(),
});

export type AttributesParams = z.infer<typeof attributesParamsSchema>;

/** A criterion passes, fails with what it saw, or cannot be judged (the fact is unknown). */
type Outcome = { failed: { label: string; value: string } } | 'passed' | 'unknown';

const lower = (values: string[]): string[] => values.map((value) => value.toLowerCase());

function certifications(facts: MediaFacts, allowed: string[]): Outcome {
  if (allowed.length === 0) {
    return 'passed';
  }
  const allowedKeys = new Set(allowed.map((key) => key.toUpperCase()));
  const countries = new Set([...allowedKeys].map((key) => key.split(':')[0]));
  const considered = facts.certifications.map(certificationKey).filter((key) => countries.has(key.split(':')[0]));
  if (considered.length === 0) {
    return 'unknown';
  }
  const refused = considered.filter((key) => !allowedKeys.has(key));
  return refused.length === 0 ? 'passed' : { failed: { label: 'Classification', value: refused.join(', ') } };
}

function membership(label: string, values: string[] | null, anyOf: string[], noneOf: string[]): Outcome {
  if (anyOf.length === 0 && noneOf.length === 0) {
    return 'passed';
  }
  if (values === null || (values.length === 0 && anyOf.length > 0)) {
    return 'unknown';
  }
  const actual = lower(values);
  const excluded = actual.filter((value) => lower(noneOf).includes(value));
  const missing = anyOf.length > 0 && !actual.some((value) => lower(anyOf).includes(value));
  return excluded.length > 0 || missing ? { failed: { label, value: values.join(', ') || '—' } } : 'passed';
}

function range(label: string, value: number | null, min: number | undefined, max: number | undefined): Outcome {
  if (min === undefined && max === undefined) {
    return 'passed';
  }
  if (value === null) {
    return 'unknown';
  }
  const inRange = (min === undefined || value >= min) && (max === undefined || value <= max);
  return inRange ? 'passed' : { failed: { label, value: String(value) } };
}

function outcomes(facts: MediaFacts, p: AttributesParams): Outcome[] {
  return [
    certifications(facts, p.certifications),
    membership('Genres', facts.genres, p.genresAnyOf, p.genresNoneOf),
    range('Durée (min)', facts.runtimeMinutes, p.minRuntime, p.maxRuntime),
    range('Année', facts.year, p.minYear, p.maxYear),
    membership(
      'Langue originale',
      facts.originalLanguage ? [facts.originalLanguage] : null,
      p.languagesAnyOf,
      p.languagesNoneOf,
    ),
    membership('Pays d’origine', facts.originCountries, p.countriesAnyOf, p.countriesNoneOf),
  ];
}

const listField = (name: string, label: string, help: string): FieldSpec => ({
  name,
  label,
  type: 'list',
  optional: true,
  help,
});

const numberField = (name: string, label: string): FieldSpec => ({ name, label, type: 'number', optional: true });

const FIELDS: FieldSpec[] = [
  listField('certifications', 'Classifications autorisées', 'Une par ligne, PAYS:CLASSIFICATION (FR:U, FR:10).'),
  listField('genresAnyOf', 'Au moins un de ces genres', 'Noms anglais de la source (Animation, Family).'),
  listField('genresNoneOf', 'Aucun de ces genres', 'Noms anglais de la source (Horror, War).'),
  numberField('minRuntime', 'Durée minimale (min)'),
  numberField('maxRuntime', 'Durée maximale (min)'),
  numberField('minYear', 'Année minimale'),
  numberField('maxYear', 'Année maximale'),
  listField('languagesAnyOf', 'Langue originale parmi', 'Codes ISO 639-1 (fr, en).'),
  listField('languagesNoneOf', 'Langue originale hors de', 'Codes ISO 639-1.'),
  listField('countriesAnyOf', 'Pays d’origine parmi', 'Codes ISO 3166-1 (FR, US).'),
  listField('countriesNoneOf', 'Pays d’origine hors de', 'Codes ISO 3166-1.'),
  MESSAGE_FIELD,
];

/**
 * Refuses a title outside the criteria the admin filled in (every empty criterion is ignored).
 * Also defines what a shelf admits: a kids shelf is a set of such rules.
 */
export const attributesPolicy: PolicyKind<AttributesParams, never> = {
  name: 'attributes',
  description: 'Refuse les titres hors des critères renseignés : classification, genres, durée, année, langue, pays.',
  scope: 'content',
  params: { schema: attributesParamsSchema, fields: FIELDS },
  entries: null,
  evaluate(subject, { params }) {
    if (!subject.facts) {
      return null;
    }
    const results = outcomes(subject.facts, params);
    const failed = results.flatMap((outcome) => (typeof outcome === 'object' ? [outcome.failed] : []));
    if (failed.length === 0) {
      return results.includes('unknown') ? null : [];
    }
    return [
      {
        summary: failed.map(({ label, value }) => `${label} : ${value}`).join(' · '),
        notice: noticeOf('Ce titre ne remplit pas les critères demandés', params.message, [
          { type: 'facts', items: failed },
        ]),
      },
    ];
  },
};
