import { InternalServerErrorException } from '@nestjs/common';
import { ColorResolvable, EmbedBuilder } from 'discord.js';

import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
import { DiscordService } from '@/services/discord';
import { UserMessaging } from '@/services/messaging/user';

const COLOR_BY_STATUS: Record<RequestStatus, ColorResolvable> = {
  pending: '#3498db',
  fulfilled: '#2ecc71',
  rejected: '#e74c3c',
  canceled: '#94312d',
  missing: '#94312d',
};

const DESCRIPTION_BY_STATUS: Record<RequestStatus, string> = {
  pending: 'Nous avons bien reçu votre demande. Vous serez notifié lorsque elle sera terminée.',
  fulfilled: 'Votre demande est disponible sur [CRN-Flix](https://jellyfin.crn-tech.fr).',
  rejected: 'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
  canceled: 'Vous avez annulé votre demande.',
  missing: 'Le contenu demandé est introuvable. Nous sommes navrés de ne pas pouvoir vous satisfaire.',
};

function embedBuilder(request: RequestEntity): EmbedBuilder {
  const media = request.media!;
  const embed = new EmbedBuilder()
    .setColor(COLOR_BY_STATUS[request.status])
    .setTitle(`${media.title} (${media.year})`)
    .setDescription(DESCRIPTION_BY_STATUS[request.status]);

  if (media.type === 'episode') {
    embed.addFields(
      { name: 'Saisons', value: `${media.seasonNumber}`, inline: true },
      { name: 'Episode', value: `${media.episodeNumber}`, inline: true },
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

  async registered(id: string, user: UserEntity, password: string): Promise<void> {
    const discordUser = await this.discordService.getUser(id);

    const embed = {
      color: 0x3498db,
      title: '✅ Registration Completed Successfully!',
      description: 'Your account has been created and you can now access [CRN-Flix](https://jellyfin.crn-tech.fr).',
      fields: [
        {
          name: 'Jellyfin Credentials',
          value: `**Username:** ${user.name}\n**Password:** ${password}`,
          inline: false,
        },
      ],
    };

    await discordUser.send({ embeds: [embed] });
  }

  async requestUpdated(id: string, request: RequestEntity): Promise<void> {
    const user = await this.discordService.getUser(id);
    if (!request.media) {
      throw new InternalServerErrorException('Request media not loaded');
    }
    await user.send({ embeds: [embedBuilder(request)] });
  }
}
