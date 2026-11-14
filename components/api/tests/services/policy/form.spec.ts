import { FieldSpec } from '@crn-flix/contracts';
import { creditsParamsSchema, personEntrySchema } from '@crn-flix/policy-credits';

import { describeValidationError, formFromValues, valuesFromForm } from '@/services/policy/form';

const FIELDS: FieldSpec[] = [
  { name: 'departments', label: '', type: 'list', optional: true },
  { name: 'minEpisodes', label: '', type: 'number', optional: true },
  { name: 'message', label: '', type: 'textarea', optional: true },
  { name: 'sources', label: '', type: 'links' },
  { name: 'level', label: '', type: 'choice' },
];

describe('valuesFromForm', () => {
  it('turns lines into lists and links, numbers into numbers, and drops empty optional fields', () => {
    const values = valuesFromForm(FIELDS, {
      departments: ' Directing\r\n\r\nActing ',
      minEpisodes: '3',
      message: '  ',
      sources: 'Journal (2024-01-02) | https://example.org/a\nhttps://example.org/b',
      level: 'high',
    });

    expect(values).toEqual({
      departments: ['Directing', 'Acting'],
      minEpisodes: 3,
      sources: [
        { label: 'Journal (2024-01-02)', url: 'https://example.org/a' },
        { label: 'https://example.org/b', url: 'https://example.org/b' },
      ],
      level: 'high',
    });
  });

  it('produces what the kinds validate', () => {
    expect(creditsParamsSchema.parse(valuesFromForm(FIELDS.slice(0, 3), { minEpisodes: '' }))).toEqual({
      departments: [],
      jobs: [],
    });
  });
});

describe('formFromValues', () => {
  it('shows stored values back in the inputs', () => {
    expect(
      formFromValues(FIELDS, {
        departments: ['Directing', 'Acting'],
        minEpisodes: 3,
        sources: [{ label: 'Journal', url: 'https://example.org/a' }],
      }),
    ).toEqual({
      departments: 'Directing\nActing',
      minEpisodes: '3',
      message: '',
      sources: 'Journal | https://example.org/a',
      level: '',
    });
  });
});

describe('describeValidationError', () => {
  it('names the first invalid field', () => {
    let error: unknown;
    try {
      personEntrySchema.parse({ ref: 'r', name: 'n', allegations: 'x', sources: [] });
    } catch (caught) {
      error = caught;
    }
    expect(describeValidationError(error)).toMatch(/^sources : /);
  });
});
