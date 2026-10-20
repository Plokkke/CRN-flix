import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { LoginChallenge, Recipient, RequestNotice, ServiceNotice, UserChannel } from '@crn-flix/contracts';

import { ContextService } from '@/services/context';
import { displayTitle } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
import { isUserNotifiableStatus } from '@/services/messaging/user';
import { DebouncedRequestQueue } from '@/services/messaging/user/notification-queue';

/** How a user is reached: `users.messaging_key` (a channel kind) and `messaging_id` (its address). */
export type UserMessagingCtxt = {
  key: string;
  id: string;
};

const SHOWCASE_SIZE = 5;

const recipientOf = (ctxt: UserMessagingCtxt, name?: string): Recipient => ({
  name: name ?? ctxt.id,
  address: ctxt.id,
});

const keyOf = (ctxt: UserMessagingCtxt): string => `${ctxt.key}\u0000${ctxt.id}`;

function noticeOf(request: RequestEntity): RequestNotice {
  const media = request.media!;
  return {
    title: displayTitle(media),
    year: media.year,
    type: media.type,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    outcome: request.status === RequestStatus.Fulfilled ? 'fulfilled' : 'rejected',
    posterUrl: media.posterUrl,
  };
}

/**
 * Reaches each user on the channel they picked. Request notices are batched per user
 * (a season landing produces one message listing every episode, not ten pings).
 */
export class AllUserMessaging implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(AllUserMessaging.name);

  private readonly channelByKind: Map<string, UserChannel>;
  private readonly queue: DebouncedRequestQueue;

  constructor(
    channels: UserChannel[],
    private readonly context: ContextService,
  ) {
    this.channelByKind = new Map(channels.map((channel) => [channel.kind, channel]));
    this.queue = new DebouncedRequestQueue((key, requests) => this.flushRequests(key, requests));
  }

  async onModuleInit(): Promise<void> {
    for (const channel of this.channelByKind.values()) {
      await channel.verify?.().catch((error: unknown) => {
        AllUserMessaging.logger.error(
          `${channel.kind} channel verification failed: ${error instanceof Error ? error.message : error}`,
        );
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.onEmpty();
  }

  async registered(ctxt: UserMessagingCtxt, user: UserEntity, password: string): Promise<void> {
    await this.channelOf(ctxt.key).welcome(recipientOf(ctxt, user.name), {
      password,
      userGuideUrl: this.context.userGuideUrl,
      catalogLinkUrl: this.context.getTraktLinkUrl(user.id),
      showcase: {
        movies: await this.context.getRandomMedias(SHOWCASE_SIZE, 'movie'),
        shows: await this.context.getRandomMedias(SHOWCASE_SIZE, 'show'),
      },
    });
  }

  async error(ctxt: UserMessagingCtxt, message: string): Promise<void> {
    await this.channelOf(ctxt.key).error(recipientOf(ctxt), message);
  }

  async loginChallenge(ctxt: UserMessagingCtxt, challenge: LoginChallenge): Promise<void> {
    await this.channelOf(ctxt.key).loginChallenge(recipientOf(ctxt), challenge);
  }

  async announce(ctxt: UserMessagingCtxt, notice: ServiceNotice): Promise<void> {
    await this.channelOf(ctxt.key).announce(recipientOf(ctxt), notice);
  }

  async requestUpdated(ctxt: UserMessagingCtxt, request: RequestEntity): Promise<void> {
    if (!isUserNotifiableStatus(request.status)) {
      AllUserMessaging.logger.debug(`Skipping requestUpdated to ${ctxt.id} (status ${request.status} is transient)`);
      return;
    }
    if (!request.media) {
      AllUserMessaging.logger.error(`Request ${request.mediaId} has no media loaded, not notifying ${ctxt.id}`);
      return;
    }
    if (!this.channelByKind.has(ctxt.key)) {
      AllUserMessaging.logger.error(`No "${ctxt.key}" channel to notify ${ctxt.id}`);
      return;
    }
    await this.queue.add(keyOf(ctxt), request);
  }

  private async flushRequests(key: string, requests: RequestEntity[]): Promise<void> {
    const [kind, address] = key.split('\u0000');
    await this.channelOf(kind).requestsUpdated({ name: address, address }, requests.map(noticeOf));
  }

  private channelOf(kind: string): UserChannel {
    const channel = this.channelByKind.get(kind);
    if (!channel) {
      throw new Error(`No user messaging channel for "${kind}"`);
    }
    return channel;
  }
}
