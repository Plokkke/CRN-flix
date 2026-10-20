import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { LoginChallenge, Recipient, RequestNotice, ServiceNotice, UserChannel } from '@crn-flix/contracts';

import { ContextService } from '@/services/context';
import { displayTitle } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UserEntity } from '@/services/database/users';
import { isUserNotifiableStatus } from '@/services/messaging/user';
import { DebouncedRequestQueue } from '@/services/messaging/user/notification-queue';

/** How a user is reached: `users.messaging_key` (a channel kind) and `messaging_id` (its address). */
export type UserMessagingCtxt = {
  key: string;
  id: string;
};

/** `dry-run` logs what would reach users and sends nothing — nor records anything as sent. */
export type UserMessagingMode = 'send' | 'dry-run';

/** Thrown instead of sending in `dry-run`, so callers never treat the message as delivered. */
export class UserMessagingDisabledError extends Error {
  constructor(what: string) {
    super(`User messaging is in dry-run: ${what} not sent`);
    this.name = 'UserMessagingDisabledError';
  }
}

const SHOWCASE_SIZE = 5;
const SEPARATOR = '\u0000';

const recipientOf = (ctxt: UserMessagingCtxt, name?: string): Recipient => ({
  name: name ?? ctxt.id,
  address: ctxt.id,
});

const batchKeyOf = (ctxt: UserMessagingCtxt, userId: string): string => [ctxt.key, ctxt.id, userId].join(SEPARATOR);

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
 * Reaches each user on the channel they picked. Request notices go through the
 * `user_notifications` outbox and are batched per user (a season landing produces one
 * message listing every episode, not ten pings); a batch is marked sent only once delivered.
 */
export class AllUserMessaging implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(AllUserMessaging.name);

  private readonly channelByKind: Map<string, UserChannel>;
  private readonly queue: DebouncedRequestQueue;

  constructor(
    channels: UserChannel[],
    private readonly context: ContextService,
    private readonly notifications: UserNotificationsRepository,
    readonly mode: UserMessagingMode,
  ) {
    this.channelByKind = new Map(channels.map((channel) => [channel.kind, channel]));
    this.queue = new DebouncedRequestQueue((key, requests) => this.flushRequests(key, requests));
  }

  async onModuleInit(): Promise<void> {
    if (this.mode === 'dry-run') {
      AllUserMessaging.logger.warn('User messaging in DRY-RUN: nothing reaches users, notifications stay queued');
    }
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

  hasChannel(kind: string): boolean {
    return this.channelByKind.has(kind);
  }

  async registered(ctxt: UserMessagingCtxt, user: UserEntity, password: string): Promise<void> {
    this.ensureSending(`welcome to ${ctxt.id}`);
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
    this.ensureSending(`error "${message}" to ${ctxt.id}`);
    await this.channelOf(ctxt.key).error(recipientOf(ctxt), message);
  }

  async loginChallenge(ctxt: UserMessagingCtxt, challenge: LoginChallenge): Promise<void> {
    this.ensureSending(`login challenge to ${ctxt.id}`);
    await this.channelOf(ctxt.key).loginChallenge(recipientOf(ctxt), challenge);
  }

  async announce(ctxt: UserMessagingCtxt, notice: ServiceNotice): Promise<void> {
    this.ensureSending(`announcement "${notice.subject}" to ${ctxt.id}`);
    await this.channelOf(ctxt.key).announce(recipientOf(ctxt), notice);
  }

  /** Queues the notice in the outbox (idempotent) and in the user's pending batch. */
  async requestUpdated(ctxt: UserMessagingCtxt, request: RequestEntity, userId: string): Promise<void> {
    if (!isUserNotifiableStatus(request.status)) {
      AllUserMessaging.logger.debug(`Skipping requestUpdated to ${ctxt.id} (status ${request.status} is transient)`);
      return;
    }
    if (!request.media) {
      AllUserMessaging.logger.error(`Request ${request.mediaId} has no media loaded, not notifying ${ctxt.id}`);
      return;
    }
    if (!this.hasChannel(ctxt.key)) {
      AllUserMessaging.logger.error(`No "${ctxt.key}" channel to notify ${ctxt.id}`);
      return;
    }
    await this.notifications.queue({ userId, mediaId: request.mediaId, status: request.status });
    await this.queue.add(batchKeyOf(ctxt, userId), request);
  }

  /** Throws (the queue logs it) when the send fails: the notices stay queued for redelivery. */
  private async flushRequests(key: string, requests: RequestEntity[]): Promise<void> {
    const [kind, address, userId] = key.split(SEPARATOR);
    if (this.mode === 'dry-run') {
      AllUserMessaging.logger.log(`DRY-RUN: would notify ${address} of ${requests.length} request(s), kept queued`);
      return;
    }
    await this.channelOf(kind).requestsUpdated({ name: address, address }, requests.map(noticeOf));
    await this.notifications.markSent(requests.map((r) => ({ userId, mediaId: r.mediaId, status: r.status })));
  }

  private ensureSending(what: string): void {
    if (this.mode === 'dry-run') {
      AllUserMessaging.logger.log(`DRY-RUN: ${what} not sent`);
      throw new UserMessagingDisabledError(what);
    }
  }

  private channelOf(kind: string): UserChannel {
    const channel = this.channelByKind.get(kind);
    if (!channel) {
      throw new Error(`No user messaging channel for "${kind}"`);
    }
    return channel;
  }
}
