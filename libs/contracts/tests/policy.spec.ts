import { evaluatePolicies, MediaType, Policy, PolicyDecision, PolicySubject, RequestReason } from '../src';

const subject: PolicySubject = {
  media: {
    imdbId: 'tt0000001',
    type: MediaType.Movie,
    title: 'Test',
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: 2024,
    seasonNumber: null,
    episodeNumber: null,
    runtimeMinutes: 90,
  },
  metadata: null,
  requester: { userRef: 'user-1', reasons: [RequestReason.Watchlisted] },
};

const policy = (name: string, decision: PolicyDecision): Policy => ({ name, evaluate: () => decision });

describe('evaluatePolicies', () => {
  it('accepts when no policy objects', () => {
    expect(evaluatePolicies([policy('a', { verdict: 'accept' })], subject)).toEqual({ verdict: 'accept' });
    expect(evaluatePolicies([], subject)).toEqual({ verdict: 'accept' });
  });

  it('returns the first non-accepting verdict, in order', () => {
    const review: PolicyDecision = { verdict: 'review', rule: 'quota', reason: 'Quota atteint' };
    const reject: PolicyDecision = { verdict: 'reject', rule: 'adult', reason: 'Contenu adulte' };
    const policies = [policy('a', { verdict: 'accept' }), policy('b', review), policy('c', reject)];

    expect(evaluatePolicies(policies, subject)).toBe(review);
  });
});
