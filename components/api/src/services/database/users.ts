import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { Profile } from '@/services/policy/shelves';

export enum UserStatus {
  Pending = 'pending',
  Active = 'active',
}

export type UserEntity = {
  id: string;
  name: string;
  jellyfinId: string | null;
  /** Concurrent streams allowed on the player, 0 = unlimited; null until adopted from the player. */
  maxStreams: number | null;
  /** When the user was asked to link their catalog account again; null when it works. */
  catalogRelinkRequestedAt: Date | null;
  /** Which shared shelves the account sees. */
  profile: Profile;
  /** Null for a player account taken in by the admin: nobody to notify. */
  messagingKey: string | null;
  messagingId: string | null;
  /** The Discord admin this account belongs to (their personal downloads land here). */
  adminDiscordId: string | null;
  /** A guest account: the shelves of its profile, never a personal shelf. */
  guest: boolean;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};

type UserRecord = {
  id: string;
  name: string;
  jellyfin_id: string | null;
  max_streams: number | null;
  catalog_relink_requested_at: Date | null;
  profile: Profile;
  messaging_key: string | null;
  messaging_id: string | null;
  admin_discord_id: string | null;
  guest: boolean;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
};

function fromUserRecord(record: UserRecord): UserEntity {
  return {
    id: record.id,
    name: record.name,
    jellyfinId: record.jellyfin_id,
    maxStreams: record.max_streams,
    catalogRelinkRequestedAt: record.catalog_relink_requested_at,
    profile: record.profile,
    messagingKey: record.messaging_key,
    messagingId: record.messaging_id,
    adminDiscordId: record.admin_discord_id,
    guest: record.guest,
    status: record.status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export class UsersRepository {
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

  async getByMessagingInfos(messagingKey: string, messagingId: string): Promise<UserEntity | null> {
    const query = `
      SELECT *
      FROM users
      WHERE messaging_key = $1 AND messaging_id = $2
    `;
    const { rows } = await this.pool.query<UserRecord>(query, [messagingKey, messagingId]);
    return rows.length ? fromUserRecord(rows[0]) : null;
  }

  async getByName(name: string): Promise<UserEntity | null> {
    const query = `SELECT * FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`;
    const { rows } = await this.pool.query<UserRecord>(query, [name]);
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

  /** Takes a player account in: active at once, no messaging channel. */
  async createFromPlayerAccount(name: string, jellyfinId: string): Promise<UserEntity> {
    const { rows } = await this.pool.query<UserRecord>(
      `INSERT INTO users (name, jellyfin_id, status) VALUES ($1, $2, 'active') RETURNING *`,
      [name, jellyfinId],
    );
    return fromUserRecord(rows[0]);
  }

  async getByAdminDiscordId(adminDiscordId: string): Promise<UserEntity | null> {
    const { rows } = await this.pool.query<UserRecord>(`SELECT * FROM users WHERE admin_discord_id = $1`, [
      adminDiscordId,
    ]);
    return rows.length ? fromUserRecord(rows[0]) : null;
  }

  /** Links the account to a Discord admin (null unlinks); an admin has one account, the previous one is unlinked. */
  async setAdminDiscordId(userId: string, adminDiscordId: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (adminDiscordId) {
        await client.query(`UPDATE users SET admin_discord_id = NULL WHERE admin_discord_id = $1`, [adminDiscordId]);
      }
      await client.query(`UPDATE users SET admin_discord_id = $2, updated_at = NOW() WHERE id = $1`, [
        userId,
        adminDiscordId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  async setMaxStreams(userId: string, maxStreams: number): Promise<void> {
    await this.pool.query(`UPDATE users SET max_streams = $2 WHERE id = $1`, [userId, maxStreams]);
  }

  async setGuest(userId: string, guest: boolean): Promise<void> {
    await this.pool.query(`UPDATE users SET guest = $2, updated_at = NOW() WHERE id = $1`, [userId, guest]);
  }

  async setProfile(userId: string, profile: Profile): Promise<void> {
    await this.pool.query(`UPDATE users SET profile = $2, updated_at = NOW() WHERE id = $1`, [userId, profile]);
  }

  async setCatalogRelinkRequestedAt(userId: string, requestedAt: Date | null): Promise<void> {
    await this.pool.query(`UPDATE users SET catalog_relink_requested_at = $2 WHERE id = $1`, [userId, requestedAt]);
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.pool.query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, status]);
  }
}
