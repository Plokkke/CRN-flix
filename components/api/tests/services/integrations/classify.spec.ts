import { z } from 'zod';

import { isIncompatibilityError } from '@/services/integrations/classify';

const httpError = (status: number): Error => Object.assign(new Error(`status ${status}`), { response: { status } });

describe('isIncompatibilityError', () => {
  it('flags answers that no longer match our schemas', () => {
    const result = z.object({ id: z.number() }).safeParse({ id: 'x' });

    expect(isIncompatibilityError(result.error)).toBe(true);
    expect(isIncompatibilityError(Object.assign(new Error('other zod copy'), { name: 'ZodError' }))).toBe(true);
  });

  it('flags requests the integration now rejects', () => {
    [400, 403, 405, 410, 415, 422].forEach((status) => expect(isIncompatibilityError(httpError(status))).toBe(true));
  });

  it('ignores unavailability, one account and one missing resource', () => {
    [401, 404, 429, 500, 502, 503].forEach((status) => expect(isIncompatibilityError(httpError(status))).toBe(false));
    expect(isIncompatibilityError(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }))).toBe(
      false,
    );
    expect(isIncompatibilityError('boom')).toBe(false);
  });
});
