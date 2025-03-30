import { Pool } from 'pg';

import { upsertQuery } from '@/helpers/sql';
import { UserMessagingCtxt } from '@/services/messaging/user/all';

export type UserCreateInfos = {
  messagingKey: string;
  messagingId: string;
  jellyfinId: string | null;
  name: string;
};

export type UserEntity = {
  id: string;
  jellyfinId: string | null;
  messagingKey: string;
  messagingId: string;
  name: string;
};

type UserRecord = {
  id: string;
  jellyfin_id: string | null;
  messaging_key: string;
  messaging_id: string;
  name: string;
};

type UserColumns = keyof UserRecord;
const COLUMNS = ['id', 'jellyfin_id', 'messaging_key', 'messaging_id', 'name'] as const satisfies UserColumns[];

function fromRecord(record: UserRecord): UserEntity {
  return {
    id: record.id,
    jellyfinId: record.jellyfin_id,
    messagingKey: record.messaging_key,
    messagingId: record.messaging_id,
    name: record.name,
  };
}

export class UsersRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<UserEntity[]> {
    const query = `SELECT ${COLUMNS.join(',')} FROM users`;
    const { rows } = await this.pool.query<UserRecord>(query);

    return rows.map(fromRecord);
  }

  async get(id: string): Promise<UserEntity | null> {
    const query = `SELECT ${COLUMNS.join(',')} FROM users WHERE id = $1`;
    const { rows } = await this.pool.query<UserRecord>(query, [id]);
    return rows.length > 0 ? fromRecord(rows[0]) : null;
  }

  async findByRegisterMessageId(messageId: string): Promise<UserEntity | null> {
    const query = `SELECT ${COLUMNS.join(',')} FROM users WHERE request_message_id = $1`;
    const { rows } = await this.pool.query<UserRecord>(query, [messageId]);
    return rows.length > 0 ? fromRecord(rows[0]) : null;
  }

  async upsert(infos: UserCreateInfos): Promise<UserEntity> {
    const userRecord: Partial<Record<UserColumns, unknown>> = {
      messaging_key: infos.messagingKey,
      messaging_id: infos.messagingId,
      jellyfin_id: infos.jellyfinId,
      name: infos.name,
    };
    const query = upsertQuery('users', userRecord, ['messaging_key', 'messaging_id']);
    const {
      rows: [user],
    } = await this.pool.query<UserRecord>(query, Object.values(userRecord));

    return fromRecord(user);
  }

  async getByMessaging(ctxt: UserMessagingCtxt): Promise<UserEntity | null> {
    const query = `
        SELECT ${COLUMNS.join(',')}
        FROM users
        WHERE messaging_key = $1 AND messaging_id = $2;
      `;

    const {
      rows: [user],
    } = await this.pool.query<UserRecord>(query, [ctxt.key, ctxt.id]);
    return user ? fromRecord(user) : null;
  }

  async attachMessage(user: UserEntity, messageId: string): Promise<void> {
    const query = `UPDATE users SET request_message_id = $2 WHERE id = $1`;
    await this.pool.query(query, [user.id, messageId]);
  }
}
