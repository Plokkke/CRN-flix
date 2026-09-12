import { OnModuleDestroy } from '@nestjs/common';
import { ColorResolvable, EmbedBuilder } from 'discord.js';
import * as _ from 'lodash';

import { DiscordService } from '@/modules/discord/discord';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
import { LoginChallenge, UserMessaging } from '@/services/messaging/user';
import { DebouncedRequestQueue } from '@/services/messaging/user/notification-queue';
import { episodeRangesBySeason } from '@/services/request-groups';

const COLOR_BY_STATUS: Record<RequestStatus, ColorResolvable> = {
  [RequestStatus.Pending]: '#3498db',
  [RequestStatus.Fulfilled]: '#2ecc71',
  [RequestStatus.Rejected]: '#e74c3c',
  [RequestStatus.Missing]: '#f39c12',
};

const DESCRIPTION_BY_STATUS: Record<RequestStatus, string> = {
  [RequestStatus.Pending]: 'Nous avons bien reçu votre demande. Vous serez notifié lorsque elle sera terminée.',
  [RequestStatus.Fulfilled]: 'Votre demande est disponible sur [CRN-Flix](https://jellyfin.crn-tech.fr).',
  [RequestStatus.Rejected]:
    'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
  [RequestStatus.Missing]:
    "Le contenu demandé n'est pas encore disponible. Nous vérifions régulièrement et vous serez notifié dès qu'il sera disponible.",
};

const MAX_EMBEDS_PER_MESSAGE = 10;

const formatEpisodeList = (requests: RequestEntity[]): string =>
  episodeRangesBySeason(requests.map((r) => r.media!))
    .map((s) => `Saison ${s.season} : ${s.ranges.join(', ')}`)
    .join('\n');

/**
 * One embed per movie, one embed per show×status grouping every episode of the
 * batch — "S1E1-E10 disponible" arrives as a single message.
 */
function buildBatchEmbeds(requests: RequestEntity[]): EmbedBuilder[] {
  const [episodes, movies] = _.partition(requests, (r) => r.media?.type === 'episode');

  const movieEmbeds = movies.map((request) => {
    const media = request.media!;
    return new EmbedBuilder()
      .setColor(COLOR_BY_STATUS[request.status])
      .setTitle(`${media.title} (${media.year})`)
      .setDescription(DESCRIPTION_BY_STATUS[request.status]);
  });

  const showEmbeds = Object.values(_.groupBy(episodes, (r) => `${r.media!.imdbId}:${r.status}`)).map((group) => {
    const media = group[0].media!;
    return new EmbedBuilder()
      .setColor(COLOR_BY_STATUS[group[0].status])
      .setTitle(`${media.title} (${media.year})`)
      .setDescription(DESCRIPTION_BY_STATUS[group[0].status])
      .addFields({ name: 'Épisodes', value: formatEpisodeList(group).slice(0, 1024) });
  });

  return [...movieEmbeds, ...showEmbeds];
}

export class DiscordUserMessaging extends UserMessaging<string> implements OnModuleDestroy {
  private readonly queue: DebouncedRequestQueue;

  constructor(private readonly discordService: DiscordService) {
    super();
    this.queue = new DebouncedRequestQueue((id, requests) => this.sendBatch(id, requests));
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.onEmpty();
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
    if (!request.media) {
      throw new Error('Request media not loaded');
    }
    await this.queue.add(id, request);
  }

  async loginChallenge(id: string, challenge: LoginChallenge): Promise<void> {
    const discordUser = await this.discordService.getUser(id);
    await discordUser.send(
      [
        `Code de connexion ${challenge.serviceName} : **${challenge.code}**`,
        `Ou connectez-vous directement : ${challenge.link}`,
        `Valable ${challenge.expiresInMinutes} minutes.`,
      ].join('\n'),
    );
  }

  private async sendBatch(id: string, requests: RequestEntity[]): Promise<void> {
    const user = await this.discordService.getUser(id);
    const embeds = buildBatchEmbeds(requests);
    for (const chunk of _.chunk(embeds, MAX_EMBEDS_PER_MESSAGE)) {
      await user.send({ embeds: chunk });
    }
  }
}
