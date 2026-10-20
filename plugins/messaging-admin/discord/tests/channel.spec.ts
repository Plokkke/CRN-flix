import { ChannelType, DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';

import { DiscordService } from '@crn-flix/discord';

import { DiscordAdminChannel } from '../src';

const unknownMessage = new DiscordAPIError(
  { code: RESTJSONErrorCodes.UnknownMessage, message: 'Unknown Message' },
  RESTJSONErrorCodes.UnknownMessage,
  404,
  'GET',
  '/channels/c/messages/m',
  {},
);

function build(fetchMessage: jest.Mock) {
  const textChannel = {
    type: ChannelType.GuildText,
    threads: { fetch: jest.fn().mockRejectedValue(new Error('Unknown Channel')) },
    messages: { fetch: fetchMessage },
  };
  const discord = { getChannel: jest.fn().mockResolvedValue(textChannel) };
  const channel = new DiscordAdminChannel({ channelId: 'c', adminIds: [] }, discord as unknown as DiscordService);
  return { channel, discord };
}

describe('DiscordAdminChannel', () => {
  it('counts a ticket whose root is already gone as closed', async () => {
    const { channel } = build(jest.fn().mockRejectedValue(unknownMessage));

    await expect(channel.closeTicket('m')).resolves.toBeUndefined();
  });

  it('still reports any other failure to close', async () => {
    const { channel } = build(jest.fn().mockRejectedValue(new Error('Missing Access')));

    await expect(channel.closeTicket('m')).rejects.toThrow('Missing Access');
  });

  it('resolves its channel on first use and again after a failure, never at construction', async () => {
    const root = { author: { id: 'admin' }, client: { user: { id: 'bot' } }, edit: jest.fn() };
    const { channel, discord } = build(jest.fn().mockResolvedValue(root));
    expect(discord.getChannel).not.toHaveBeenCalled();

    discord.getChannel.mockRejectedValueOnce(new Error('not connected'));
    await expect(channel.closeTicket('m')).rejects.toThrow('not connected');
    await channel.closeTicket('m');
    await channel.closeTicket('m');

    expect(discord.getChannel).toHaveBeenCalledTimes(2);
  });
});
