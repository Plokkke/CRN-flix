import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { DiscordWired } from './discord-wired';

export type UserEntity = {
  id: string;
  name: string;
  jellyfinId: string | null;
  messagingKey: string;
  messagingId: string;
  discordMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserRecord = {
  id: string;
  name: string;
  jellyfin_id: string | null;
  messaging_key: string;
  messaging_id: string;
  discord_message_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function fromUserRecord(record: UserRecord): UserEntity {
  return {
    id: record.id,
    name: record.name,
    jellyfinId: record.jellyfin_id,
    messagingKey: record.messaging_key,
    messagingId: record.messaging_id,
    discordMessageId: record.discord_message_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export class UsersRepository implements DiscordWired<UserEntity> {
  static readonly logger = new Logger(UsersRepository.name);

  constructor(private readonly pool: Pool) {}

  async list(): Promise<UserEntity[]> {
    const query = `
      SELECT *
      FROM users
    `;
    const { rows } = await this.pool.query<UserRecord>(query);
    return rows.map(fromUserRecord);
  }

  async get(id: string): Promise<UserEntity | null> {
    const query = `
      SELECT *
      FROM users
      WHERE id = $1
    `;
    const { rows } = await this.pool.query<UserRecord>(query, [id]);
    return rows.length ? fromUserRecord(rows[0]) : null;
  }

  async getByDiscordMessageId(discordMessageId: string): Promise<UserEntity | null> {
    const query = `
      SELECT *
      FROM users
      WHERE discord_message_id = $1
    `;
    const { rows } = await this.pool.query<UserRecord>(query, [discordMessageId]);
    return rows.length ? fromUserRecord(rows[0]) : null;
  }

  async getByMessagingInfos(messagingKey: string, messagingId: string): Promise<UserEntity | null> {
    const query = `
      SELECT *
      FROM users
      WHERE messaging_key = $1 AND messaging_id = $2
    `;
    const { rows } = await this.pool.query<UserRecord>(query, [messagingKey, messagingId]);
    return rows.length ? fromUserRecord(rows[0]) : null;
  }

  async existsByName(name: string): Promise<boolean> {
    const query = `SELECT 1 FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`;
    const { rows } = await this.pool.query(query, [name]);
    return rows.length > 0;
  }

  async createFromMessagingInfos(messagingKey: string, messagingId: string, name: string): Promise<UserEntity> {
    const query = `
      INSERT INTO users (messaging_key, messaging_id, name)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const { rows } = await this.pool.query<UserRecord>(query, [messagingKey, messagingId, name]);
    return fromUserRecord(rows[0]);
  }

  async linkDiscordMessageId(userId: string, discordMessageId: string): Promise<void> {
    const query = `
      UPDATE users
      SET discord_message_id = $2
      WHERE id = $1
    `;
    await this.pool.query(query, [userId, discordMessageId]);
  }

  async remove(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }

  async setJellyfinId(userId: string, jellyfinId: string): Promise<void> {
    const query = `
      UPDATE users
      SET jellyfin_id = $2
      WHERE id = $1
    `;
    await this.pool.query(query, [userId, jellyfinId]);
  }
}
