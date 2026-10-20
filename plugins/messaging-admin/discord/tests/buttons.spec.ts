import { parseButtonOperation } from '../src/buttons';

describe('parseButtonOperation', () => {
  it('maps the ticket button ids to operations', () => {
    expect(parseButtonOperation('ticket-approve')).toEqual({ kind: 'approve' });
    expect(parseButtonOperation('ticket-reject')).toEqual({ kind: 'reject' });
    expect(parseButtonOperation('ticket-restore')).toEqual({ kind: 'restore' });
    expect(parseButtonOperation('ticket-resolve')).toMatchObject({ kind: 'resolveManually' });
    expect(parseButtonOperation('unknown')).toBeNull();
  });
});
