import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { AuthDevicePublicCtxt } from '@/modules/trakt/types';
import { DiscordService } from '@/services/discord';

import { UserMessaging } from '.';

export class DiscordUserMessaging extends UserMessaging<string> {
  constructor(private readonly discordService: DiscordService) {
    super();
  }

  async error(id: string, message: string): Promise<void> {
    const user = await this.discordService.getUser(id);
    await user.send(`Error: ${message}`);
  }

  async welcome(id: string): Promise<void> {
    const user = await this.discordService.getUser(id);
    await user.send('Welcome to TraktSync!');
  }

  async registered(id: string, jellyfinUser: JellyfinUser): Promise<void> {
    const user = await this.discordService.getUser(id);

    const embed = {
      color: 0x3498db,
      title: '✅ Registration Completed Successfully!',
      description: 'Your account has been created and you can now access [CRN-Flix](https://jellyfin.crn-tech.fr).',
      fields: [
        {
          name: 'Jellyfin Credentials',
          value: `**Username:** ${jellyfinUser.name}\n**Password:** ${jellyfinUser.password}`,
          inline: false,
        },
      ],
    };

    await user.send({ embeds: [embed] });
  }

  async traktLinkRequest(id: string, authCtxt: AuthDevicePublicCtxt): Promise<void> {
    const user = await this.discordService.getUser(id);
    const url = `${authCtxt.verification_url}/${authCtxt.user_code}`;
    await user.send(`Please link your Trakt account: ${url}`);
  }

  async mediaRequestUpdated(id: string, mediaTitle: string, status: string): Promise<void> {
    const user = await this.discordService.getUser(id);
    await user.send(`Media update: ${mediaTitle} - Status: ${status}`);
  }

  // TODO forward unsubscribes
  onJoin(handler: (id: string) => void): void {
    this.discordService.onGuildMemberJoin(async (member) => {
      handler(member.id);
    });
    this.discordService.onDirectMessage(async (message) => {
      if (message.content === '!join') {
        handler(message.author.id);
      }
    });
  }

  onRegisterRequest(handler: (id: string, username: string) => void): void {
    this.discordService.onDirectMessage(async (message) => {
      if (message.content.startsWith('!register')) {
        const userName = message.content.split(' ')[1];
        if (!userName) {
          await message.reply('Please provide a username to register.');
          return;
        }

        handler(message.author.id, userName);
      }
    });
  }

  onTraktLinkRequest(handler: (id: string) => void): void {
    this.discordService.onDirectMessage(async (message) => {
      if (message.content.startsWith('!trakt-link')) {
        handler(message.author.id);
      }
    });
  }
}
