import * as nodemailer from 'nodemailer';

import { RequestNotice } from '@crn-flix/contracts';

import { catalogRelinkTemplate, EmailChannel, requestUpdateTemplate } from '../src';

jest.mock('nodemailer');

const identity = { serviceName: 'CRN-Flix', playerUrl: 'https://watch.test', userSpaceUrl: 'https://crn.test/me' };

const notice = (episodeNumber: number, outcome: RequestNotice['outcome']): RequestNotice => ({
  title: 'Silo',
  year: 2023,
  type: 'episode',
  seasonNumber: 1,
  episodeNumber,
  outcome,
  posterUrl: null,
});

describe('requestUpdateTemplate', () => {
  it('lists episodes in airing order with a watch link only for available ones', () => {
    const { subject, text } = requestUpdateTemplate(identity, [notice(2, 'rejected'), notice(1, 'fulfilled')]);

    expect(subject).toBe('📺 Mise à jour de vos demandes (2)');
    expect(text.indexOf('Episode 1')).toBeLessThan(text.indexOf('Episode 2'));
    expect(text.match(/Regarder sur CRN-Flix: https:\/\/watch.test/g)).toHaveLength(1);
    expect(text).toContain('votre espace: https://crn.test/me');
  });
});

describe('catalogRelinkTemplate', () => {
  it('names the catalog, says the requests are paused and links to the reconnection', () => {
    const { subject, html, text } = catalogRelinkTemplate('CRN-Flix', 'Zoé <b>', {
      catalogName: 'Trakt',
      linkUrl: 'https://flix.test/users/u1/trakt-link',
    });

    expect(subject).toBe('🔗 Reconnectez votre compte Trakt à CRN-Flix');
    expect(html).toContain('href="https://flix.test/users/u1/trakt-link"');
    expect(html).toContain('Zoé &lt;b&gt;');
    expect(text).toContain('en pause');
    expect(text).toContain('Reconnecter Trakt : https://flix.test/users/u1/trakt-link');
  });
});

describe('EmailChannel', () => {
  it('sends from the service to the recipient address and fails loudly', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as unknown as nodemailer.Transporter);
    const channel = new EmailChannel({ serviceName: 'CRN-Flix', gmailUser: 'bot@test', gmailPassword: 'x' }, identity);

    await channel.requestsUpdated({ name: 'antoine', address: 'antoine@test' }, [notice(1, 'fulfilled')]);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'CRN-Flix <bot@test>', to: 'antoine@test', subject: expect.any(String) }),
    );
    sendMail.mockRejectedValue(new Error('smtp down'));
    await expect(channel.error({ name: 'a', address: 'a@test' }, 'x')).rejects.toThrow('smtp down');
  });
});
