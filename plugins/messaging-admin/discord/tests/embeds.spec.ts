import { TicketEventKind } from '@crn-flix/contracts';

import { buildDownloadsEmbed, buildTicketButtons, formatTimelineEntry } from '../src/embeds';

describe('Discord admin embeds', () => {
  it('summarizes the downloads board with what was left out', () => {
    const embed = buildDownloadsEmbed({ active: 2, entries: [{ label: 'Silo S01E01', status: '42%' }], hidden: 3 });

    expect(embed.data.title).toBe('📥 Téléchargements — 2 en cours');
    expect(embed.data.fields).toEqual([{ name: 'Silo S01E01', value: '42%' }]);
    expect(embed.data.footer?.text).toBe('+ 3 autre(s)');
  });

  it('only turns button-shaped operations into buttons', () => {
    const rows = buildTicketButtons({
      title: 'T',
      tone: 'info',
      fields: [],
      footer: null,
      operations: ['approve', 'submitLink'],
    });

    expect(rows[0].components.map((button) => button.data)).toEqual([
      expect.objectContaining({ label: 'Accepter', custom_id: 'ticket-approve' }),
    ]);
  });

  it('prefixes timeline entries and credits human actors', () => {
    expect(formatTimelineEntry({ kind: TicketEventKind.Resolved, message: 'Fait', actor: 'dashboard:1' })).toBe(
      '✅ Fait (dashboard:1)',
    );
  });
});
