import { ColorResolvable, EmbedBuilder } from 'discord.js';

import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { AuthDevicePublicCtxt } from '@/modules/trakt/types';
import { MediaRequestEntity, RequestStatus } from '@/services/database/mediaRequests';
import { DiscordService } from '@/services/discord';

import { UserMessaging } from '.';

const COLOR_BY_STATUS: Record<RequestStatus, ColorResolvable> = {
  pending: '#3498db',
  in_progress: '#3498db',
  fulfilled: '#2ecc71',
  rejected: '#e74c3c',
  canceled: '#94312d',
  missing: '#94312d',
};

const DESCRIPTION_BY_STATUS: Record<RequestStatus, string> = {
  pending: 'Nous avons bien reçu votre demande. Vous serez notifié lorsque elle sera terminée.',
  in_progress: 'Un administrateur a pris en charge votre demande. Elle sera disponible dans quelques minutes.',
  fulfilled: 'Votre demande est disponible sur [CRN-Flix](https://jellyfin.crn-tech.fr).',
  rejected: 'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
  canceled: 'Vous avez annulé votre demande.',
  missing: 'Le contenu demandé est introuvable. Nous sommes navrés de ne pas pouvoir vous satisfaire.',
};

function embedBuilder(request: MediaRequestEntity): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOR_BY_STATUS[request.status])
    .setTitle(`${request.title} (${request.year})`)
    .setDescription(DESCRIPTION_BY_STATUS[request.status]);

  if (request.type === 'episode') {
    embed.addFields(
      { name: 'Saisons', value: `${request.seasonNumber}`, inline: true },
      { name: 'Episode', value: `${request.episodeNumber}`, inline: true },
    );
  }

  return embed;
}

export class DiscordUserMessaging extends UserMessaging<string> {
  constructor(private readonly discordService: DiscordService) {
    super();
  }

  async error(id: string, message: string): Promise<void> {
    const user = await this.discordService.getUser(id);
    await user.send(`Error: ${message}`);
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

  async mediaRequestUpdated(id: string, request: MediaRequestEntity): Promise<void> {
    const user = await this.discordService.getUser(id);
    await user.send({ embeds: [embedBuilder(request)] });
  }
}
