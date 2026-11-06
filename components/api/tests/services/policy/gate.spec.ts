import { Admission } from '@crn-flix/policy';

import { PolicyRefusalsRepository } from '@/services/database/policy';
import { PlannerStateRow, RequestStatus } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { keepAdmittedRequesters } from '@/services/planner/planner';
import { PolicyGate } from '@/services/policy/gate';
import { PolicyService } from '@/services/policy/policy';

const REFUSED: Admission = {
  admitted: false,
  refusals: [{ ruleId: 'r', ruleName: 'Politique', summary: 'non', notices: [] }],
};

function build(mode: 'off' | 'dry-run' | 'enforce', admissionsOf: jest.Mock) {
  const refusals = { record: jest.fn().mockResolvedValue(undefined), lift: jest.fn().mockResolvedValue(undefined) };
  const users = { get: jest.fn((id: string) => Promise.resolve({ id, profile: id === 'kid' ? 'kids' : 'adult' })) };
  const gate = new PolicyGate(
    { mode, admissionsOf } as unknown as PolicyService,
    users as unknown as UsersRepository,
    refusals as unknown as PolicyRefusalsRepository,
  );
  return { gate, refusals };
}

describe('PolicyGate', () => {
  it('lets every requester through until the policy is enforced', async () => {
    const admissionsOf = jest.fn();
    const { gate } = build('dry-run', admissionsOf);

    await expect(gate.admittedUserIds('tt1', ['a', 'b', 'a'])).resolves.toEqual(new Set(['a', 'b']));
    expect(admissionsOf).not.toHaveBeenCalled();
  });

  it('admits per profile, records the refusals and lifts the ones that no longer hold', async () => {
    const admissionsOf = jest.fn().mockResolvedValue(
      new Map<string, Admission>([
        ['adult', { admitted: true, via: 'shelf' }],
        ['kid', REFUSED],
      ]),
    );
    const { gate, refusals } = build('enforce', admissionsOf);

    await expect(gate.admittedUserIds('tt1', ['adult', 'kid'])).resolves.toEqual(new Set(['adult']));
    expect(admissionsOf).toHaveBeenCalledWith('tt1', [
      { id: 'adult', profile: 'adult' },
      { id: 'kid', profile: 'kids' },
    ]);
    expect(refusals.record).toHaveBeenCalledWith('kid', 'tt1', REFUSED.refusals);
    expect(refusals.lift).toHaveBeenCalledWith('adult', 'tt1');
  });

  it('admits nobody when the title cannot be assessed, so the next pass retries', async () => {
    const { gate } = build('enforce', jest.fn().mockRejectedValue(new Error('TMDB down')));

    await expect(gate.admittedUserIds('tt1', ['adult'])).resolves.toEqual(new Set());
  });
});

describe('keepAdmittedRequesters', () => {
  const row = (mediaId: string, userIds: string[]): PlannerStateRow => ({
    mediaId,
    imdbId: 'tt1',
    title: 'Show',
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: 2001,
    seasonNumber: 1,
    episodeNumber: Number(mediaId),
    runtimeMinutes: 45,
    status: RequestStatus.Missing,
    userIds,
  });

  it('drops refused requesters, so episodes only they want are no longer planned', async () => {
    const gate = { admittedUserIds: jest.fn().mockResolvedValue(new Set(['adult'])) };

    const state = await keepAdmittedRequesters(gate, [row('1', ['adult', 'kid']), row('2', ['kid'])]);

    expect(gate.admittedUserIds).toHaveBeenCalledWith('tt1', ['adult', 'kid', 'kid']);
    expect(state.map((r) => r.userIds)).toEqual([['adult'], []]);
  });
});
