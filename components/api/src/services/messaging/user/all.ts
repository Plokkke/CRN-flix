import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { LoginChallenge, Recipient, RequestNotice, ServiceNotice, UserChannel } from '@crn-flix/contracts';

import { ContextService } from '@/services/context';
import { displayTitle } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserMessageKind, UserMessagesRepository } from '@/services/database/user-messages';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UserEntity } from '@/services/database/users';
import { isUserNotifiableStatus } from '@/services/messaging/user';
import { DebouncedRequestQueue } from '@/services/messaging/user/notification-queue';

/** How a user is reached: `users.messaging_key` (a channel kind) and `messaging_id` (its address). */
export type UserMessagingCtxt = {
  key: string;
  id: string;
  userId: string;
};

export const messagingContextOf = (user: UserEntity): UserMessagingCtxt => ({
  key: user.messagingKey,
  id: user.messagingId,
  userId: user.id,
});

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
const VERIFY_RETRY_MS = 60_000;
const VERIFY_REFRESH_MS = 15 * 60_000;
/** A lossy route to the provider fails one check now and then: only a lasting outage counts. */
const FAILURES_BEFORE_UNREACHABLE = 3;
const SEPARATOR = '\u0000';

const recipientOf = (ctxt: UserMessagingCtxt, name?: string): Recipient => ({
  name: name ?? ctxt.id,
  address: ctxt.id,
});

const batchKeyOf = (ctxt: UserMessagingCtxt): string => [ctxt.key, ctxt.id, ctxt.userId].join(SEPARATOR);

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
  private reachable = false;
  private consecutiveFailures = 0;
  private verifyTimer: NodeJS.Timeout | null = null;

  constructor(
    channels: UserChannel[],
    private readonly context: ContextService,
    private readonly notifications: UserNotificationsRepository,
    private readonly journal: UserMessagesRepository,
    readonly mode: UserMessagingMode,
  ) {
    this.channelByKind = new Map(channels.map((channel) => [channel.kind, channel]));
    this.queue = new DebouncedRequestQueue((key, requests) => this.flushRequests(key, requests));
  }

  onModuleInit(): void {
    if (this.mode === 'dry-run') {
      AllUserMessaging.logger.warn('User messaging in DRY-RUN: nothing reaches users, notifications stay queued');
    }
    void this.verifyChannels();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.verifyTimer) {
      clearTimeout(this.verifyTimer);
    }
    await this.queue.onEmpty();
  }

  /** False until a check succeeds, then only after several checks in a row failed. */
  get canReachUsers(): boolean {
    return this.reachable;
  }

  /** Off the boot path: users cannot be served without a channel, but the engine still starts. */
  private async verifyChannels(): Promise<void> {
    const results = await Promise.all([...this.channelByKind.values()].map((channel) => this.verifyChannel(channel)));
    this.consecutiveFailures = results.every(Boolean) ? 0 : this.consecutiveFailures + 1;
    const reachable =
      this.consecutiveFailures === 0 || (this.reachable && this.consecutiveFailures < FAILURES_BEFORE_UNREACHABLE);
    if (reachable !== this.reachable) {
      const state = reachable ? 'every user channel can send' : 'users cannot be reached, retrying every minute';
      AllUserMessaging.logger[reachable ? 'log' : 'error'](`User messaging: ${state}`);
    }
    this.reachable = reachable;
    const delay = this.consecutiveFailures === 0 ? VERIFY_REFRESH_MS : VERIFY_RETRY_MS;
    this.verifyTimer = setTimeout(() => void this.verifyChannels(), delay);
    this.verifyTimer.unref();
  }

  private async verifyChannel(channel: UserChannel): Promise<boolean> {
    try {
      await channel.verify?.();
      return true;
    } catch (error) {
      AllUserMessaging.logger.error(
        `${channel.kind} channel verification failed: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  hasChannel(kind: string): boolean {
    return this.channelByKind.has(kind);
  }

  async registered(ctxt: UserMessagingCtxt, user: UserEntity, password: string): Promise<void> {
    await this.deliver(ctxt, 'welcome', 'welcome', async (channel) =>
      channel.welcome(recipientOf(ctxt, user.name), {
        password,
        userGuideUrl: this.context.userGuideUrl,
        catalogLinkUrl: this.context.getTraktLinkUrl(user.id),
        showcase: {
          movies: await this.context.getRandomMedias(SHOWCASE_SIZE, 'movie'),
          shows: await this.context.getRandomMedias(SHOWCASE_SIZE, 'show'),
        },
      }),
    );
  }

  async error(ctxt: UserMessagingCtxt, message: string): Promise<void> {
    await this.deliver(ctxt, 'error', `error "${message}"`, (channel) => channel.error(recipientOf(ctxt), message));
  }

  async loginChallenge(ctxt: UserMessagingCtxt, challenge: LoginChallenge): Promise<void> {
    await this.deliver(ctxt, 'login', 'login challenge', (channel) =>
      channel.loginChallenge(recipientOf(ctxt), challenge),
    );
  }

  async announce(ctxt: UserMessagingCtxt, notice: ServiceNotice): Promise<void> {
    await this.deliver(ctxt, 'announce', `announcement "${notice.subject}"`, (channel) =>
      channel.announce(recipientOf(ctxt), notice),
    );
  }

  /** Asks the user to authorize the catalog again; throws when not delivered. */
  async catalogRelink(ctxt: UserMessagingCtxt, userName: string, catalogName: string): Promise<void> {
    await this.deliver(ctxt, 'catalog-relink', 'catalog relink', (channel) =>
      channel.catalogRelink(recipientOf(ctxt, userName), {
        catalogName,
        linkUrl: this.context.getTraktLinkUrl(ctxt.userId),
      }),
    );
  }

  /** Queues the notice in the outbox (idempotent) and in the user's pending batch. */
  async requestUpdated(ctxt: UserMessagingCtxt, request: RequestEntity): Promise<void> {
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
    await this.notifications.queue({ userId: ctxt.userId, mediaId: request.mediaId, status: request.status });
    await this.queue.add(batchKeyOf(ctxt), request);
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
    await this.journalize(userId, 'requests-updated', kind);
  }

  /** The single way out to users: nothing in dry-run, journaled only once the channel delivered. */
  private async deliver(
    ctxt: UserMessagingCtxt,
    kind: UserMessageKind,
    what: string,
    send: (channel: UserChannel) => Promise<void>,
  ): Promise<void> {
    this.ensureSending(`${what} to ${ctxt.id}`);
    const channel = this.channelOf(ctxt.key);
    await send(channel);
    await this.journalize(ctxt.userId, kind, channel.kind);
  }

  /** The message already left: a journal failure is logged, never turned into a failed send. */
  private async journalize(userId: string, kind: UserMessageKind, channel: string): Promise<void> {
    await this.journal.record(userId, kind, channel).catch((error: unknown) => {
      AllUserMessaging.logger.error(
        `Delivered ${kind} to user ${userId} but could not journal it: ${error instanceof Error ? error.message : error}`,
      );
    });
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
