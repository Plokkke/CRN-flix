import { HydrackerApi } from '@/modules/indexer/hydracker/api';

describe('HydrackerApi.buildUserAgent', () => {
  it('appends the contact when one is configured', () => {
    expect(HydrackerApi.buildUserAgent('CRN-Flix', 'antoine@crn-tech.fr')).toBe('CRN-Flix (antoine@crn-tech.fr)');
  });

  it('falls back to the service name alone', () => {
    expect(HydrackerApi.buildUserAgent('CRN-Flix')).toBe('CRN-Flix');
  });

  it('never produces a generic client string the WAF would block', () => {
    expect(HydrackerApi.buildUserAgent('CRN-Flix')).not.toMatch(/^(axios|curl|python-requests|Go-http-client)\b/);
  });
});
