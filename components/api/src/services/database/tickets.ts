import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

import { Emitter } from '@/helpers/events';
import { ListenChannel, ListenHandle, listenWithReconnect } from '@/helpers/sql';
import {
  TicketCategory,
  TicketEntity,
  TicketEventEntity,
  TicketEventKind,
  TicketStatus,
  TicketSubject,
} from '@/services/tickets/model';

type TicketRecord = {
  id: string;
  category: TicketCategory;
  subject_type: string | null;
  subject_id: string | null;
  status: TicketStatus;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  resolution: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
};

type TicketEventRecord = {
  id: string;
  ticket_id: string;
  kind: TicketEventKind;
  actor: string;
  message: string;
  data: Record<string, unknown>;
  created_at: Date;
};

function fromRecord(record: TicketRecord): TicketEntity {
  return {
    id: record.id,
    category: record.category,
    subjectType: record.subject_type,
    subjectId: record.subject_id,
    status: record.status,
    title: record.title,
    summary: record.summary,
    payload: record.payload as TicketEntity['payload'],
    attempts: record.attempts,
    resolution: record.resolution,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    resolvedAt: record.resolved_at,
  };
}

function fromEventRecord(record: TicketEventRecord): TicketEventEntity {
  return {
    id: record.id,
    ticketId: record.ticket_id,
    kind: record.kind,
    actor: record.actor,
    message: record.message,
    data: record.data,
    createdAt: record.created_at,
  };
}

const stringParseMorphing = z.string().transform((payload): unknown => JSON.parse(payload));

const ticketCreatedEventSchema = z.object({ ticketId: z.string() });
export type TicketCreatedEvent = z.infer<typeof ticketCreatedEventSchema>;

const ticketStatusChangedEventSchema = z.object({
  ticketId: z.string(),
  oldStatus: z.enum(TicketStatus),
  newStatus: z.enum(TicketStatus),
});
export type TicketStatusChangedEvent = z.infer<typeof ticketStatusChangedEventSchema>;

const ticketEventCreatedEventSchema = z.object({
  ticketId: z.string(),
  eventId: z.string(),
  kind: z.string(),
});
export type TicketEventCreatedEvent = z.infer<typeof ticketEventCreatedEventSchema>;

export type TicketNotifyEvents = {
  created: TicketCreatedEvent;
  statusChange: TicketStatusChangedEvent;
  eventCreated: TicketEventCreatedEvent;
};

export type NewTicket = {
  category: TicketCategory;
  subject: TicketSubject;
  title: string;
  summary?: string;
  payload: Record<string, unknown>;
};

export type TicketBinding = { kind: 'root' | 'thread'; externalId: string };

export class TicketsRepository extends Emitter<TicketNotifyEvents> implements OnModuleInit, OnModuleDestroy {
  private listenHandle: ListenHandle | null = null;

  constructor(private readonly pool: Pool) {
    super();
  }

  onModuleInit(): void {
    const channels: ListenChannel[] = [
      {
        channel: 'ticket_created',
        schema: stringParseMorphing.pipe(ticketCreatedEventSchema),
        callback: (msg) => this.emit('created', msg as TicketCreatedEvent),
      },
      {
        channel: 'ticket_status_changed',
        schema: stringParseMorphing.pipe(ticketStatusChangedEventSchema),
        callback: (msg) => this.emit('statusChange', msg as TicketStatusChangedEvent),
      },
      {
        channel: 'ticket_event_created',
        schema: stringParseMorphing.pipe(ticketEventCreatedEventSchema),
        callback: (msg) => this.emit('eventCreated', msg as TicketEventCreatedEvent),
      },
    ];
    this.listenHandle = listenWithReconnect(this.pool, channels, undefined, 'TicketsRepository');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.listenHandle) {
      await this.listenHandle.close();
      this.listenHandle = null;
    }
  }

  /** Race-safe idempotent open: the partial unique index arbitrates concurrent inserts. */
  async openIdempotent(input: NewTicket): Promise<{ ticket: TicketEntity; created: boolean }> {
    const { rows } = await this.pool.query<TicketRecord>(
      `INSERT INTO tickets (category, subject_type, subject_id, title, summary, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (category, subject_type, subject_id) WHERE status = 'open' AND subject_id IS NOT NULL
       DO NOTHING
       RETURNING *`,
      [
        input.category,
        input.subject?.type ?? null,
        input.subject?.id ?? null,
        input.title,
        input.summary ?? null,
        input.payload,
      ],
    );
    if (rows.length > 0) {
      return { ticket: fromRecord(rows[0]), created: true };
    }

    const existing = await this.getOpenBySubject(input.category, input.subject!.type, input.subject!.id);
    if (!existing) {
      throw new Error(`Ticket insert conflicted but no open ticket found for ${input.category}/${input.subject?.id}`);
    }
    return { ticket: existing, created: false };
  }

  async get(id: string): Promise<TicketEntity | null> {
    const { rows } = await this.pool.query<TicketRecord>(`SELECT * FROM tickets WHERE id = $1`, [id]);
    return rows.length > 0 ? fromRecord(rows[0]) : null;
  }

  async getOpenBySubject(
    category: TicketCategory,
    subjectType: string,
    subjectId: string,
  ): Promise<TicketEntity | null> {
    const { rows } = await this.pool.query<TicketRecord>(
      `SELECT * FROM tickets WHERE category = $1 AND subject_type = $2 AND subject_id = $3 AND status = 'open'`,
      [category, subjectType, subjectId],
    );
    return rows.length > 0 ? fromRecord(rows[0]) : null;
  }

  async listOpen(): Promise<TicketEntity[]> {
    const { rows } = await this.pool.query<TicketRecord>(
      `SELECT * FROM tickets WHERE status = 'open' ORDER BY created_at DESC`,
    );
    return rows.map(fromRecord);
  }

  async listRecentlyClosed(limit: number): Promise<TicketEntity[]> {
    const { rows } = await this.pool.query<TicketRecord>(
      `SELECT * FROM tickets WHERE status != 'open' ORDER BY resolved_at DESC NULLS LAST LIMIT $1`,
      [limit],
    );
    return rows.map(fromRecord);
  }

  async listEvents(ticketId: string): Promise<TicketEventEntity[]> {
    const { rows } = await this.pool.query<TicketEventRecord>(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at`,
      [ticketId],
    );
    return rows.map(fromEventRecord);
  }

  async getEvent(eventId: string): Promise<TicketEventEntity | null> {
    const { rows } = await this.pool.query<TicketEventRecord>(`SELECT * FROM ticket_events WHERE id = $1`, [eventId]);
    return rows.length > 0 ? fromEventRecord(rows[0]) : null;
  }

  async addEvent(
    ticketId: string,
    kind: TicketEventKind,
    actor: string,
    message: string,
    data: Record<string, unknown> = {},
  ): Promise<TicketEventEntity> {
    const { rows } = await this.pool.query<TicketEventRecord>(
      `INSERT INTO ticket_events (ticket_id, kind, actor, message, data) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ticketId, kind, actor, message, data],
    );
    return fromEventRecord(rows[0]);
  }

  async patchPayload(ticketId: string, patch: Record<string, unknown>): Promise<void> {
    await this.pool.query(`UPDATE tickets SET payload = payload || $2::jsonb WHERE id = $1`, [
      ticketId,
      JSON.stringify(patch),
    ]);
  }

  async incrementAttempts(ticketId: string): Promise<void> {
    await this.pool.query(`UPDATE tickets SET attempts = attempts + 1 WHERE id = $1`, [ticketId]);
  }

  /** Terminal close; returns false when the ticket was not open (lost race, already closed). */
  async close(
    ticketId: string,
    status: TicketStatus.Resolved | TicketStatus.Abandoned,
    resolution: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE tickets SET status = $2, resolution = $3, resolved_at = now() WHERE id = $1 AND status = 'open'`,
      [ticketId, status, resolution],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // --- Adapter bindings ---

  /** Returns false when this (ticket, adapter, kind) slot is already bound — materialization race. */
  async bind(ticketId: string, adapter: string, kind: 'root' | 'thread', externalId: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO ticket_bindings (ticket_id, adapter, kind, external_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [ticketId, adapter, kind, externalId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getByBinding(adapter: string, externalId: string): Promise<TicketEntity | null> {
    const { rows } = await this.pool.query<TicketRecord>(
      `SELECT t.* FROM tickets t
       JOIN ticket_bindings tb ON tb.ticket_id = t.id
       WHERE tb.adapter = $1 AND tb.external_id = $2`,
      [adapter, externalId],
    );
    return rows.length > 0 ? fromRecord(rows[0]) : null;
  }

  async getBindings(ticketId: string, adapter: string): Promise<TicketBinding[]> {
    const { rows } = await this.pool.query<{ kind: 'root' | 'thread'; external_id: string }>(
      `SELECT kind, external_id FROM ticket_bindings WHERE ticket_id = $1 AND adapter = $2`,
      [ticketId, adapter],
    );
    return rows.map((row) => ({ kind: row.kind, externalId: row.external_id }));
  }

  /** Drops every binding of an adapter (its rendering was wiped); returns how many went. */
  async unbindAll(adapter: string): Promise<number> {
    const result = await this.pool.query(`DELETE FROM ticket_bindings WHERE adapter = $1`, [adapter]);
    return result.rowCount ?? 0;
  }

  async findOpenWithoutBinding(adapter: string, kind: 'root' | 'thread', olderThan: Date): Promise<TicketEntity[]> {
    const { rows } = await this.pool.query<TicketRecord>(
      `SELECT t.* FROM tickets t
       WHERE t.status = 'open' AND t.created_at < $3
         AND NOT EXISTS (
           SELECT 1 FROM ticket_bindings tb
           WHERE tb.ticket_id = t.id AND tb.adapter = $1 AND tb.kind = $2
         )
       ORDER BY t.created_at`,
      [adapter, kind, olderThan],
    );
    return rows.map(fromRecord);
  }
}
