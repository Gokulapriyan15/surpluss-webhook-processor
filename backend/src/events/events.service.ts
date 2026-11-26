import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { queryRows } from '../database/query-rows';

import { ListEventsDto } from './dto/list-events.dto';

interface EventSummaryRow {
  event_id: string;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: Date | null;
  locked_by: string | null;
  lease_until: Date | null;
  created_at: Date;
  updated_at: Date;
  last_error: string | null;
  processed: boolean;
}

interface EventDetailRow extends EventSummaryRow {
  payload: Record<string, unknown>;
}

interface AttemptRow {
  attempt_number: number;
  worker_id: string;
  started_at: Date;
  finished_at: Date | null;
  result: string;
  error: string | null;
}

interface ProcessedOrderRow {
  order_id: string;
  processed_at: Date;
}

const SUMMARY_COLUMNS = `
  e.event_id,
  e.type,
  e.status,
  e.attempts,
  e.max_attempts,
  e.next_retry_at,
  e.locked_by,
  e.lease_until,
  e.created_at,
  e.updated_at,
  (
    SELECT a.error
    FROM processing_attempts a
    WHERE a.event_id = e.event_id
      AND a.error IS NOT NULL
    ORDER BY a.attempt_number DESC
    LIMIT 1
  ) AS last_error,
  EXISTS (
    SELECT 1 FROM processed_orders p WHERE p.event_id = e.event_id
  ) AS processed
`;

@Injectable()
export class EventsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async list(query: ListEventsDto) {
    const params: unknown[] = [];
    let where = '';

    if (query.status) {
      params.push(query.status);
      where = `WHERE e.status = $${params.length}::varchar`;
    }

    const [{ count }] = await queryRows<{ count: string }>(
      this.dataSource,
      `SELECT COUNT(*) AS count FROM webhook_events e ${where}`,
      params,
    );

    const rows = await queryRows<EventSummaryRow>(
      this.dataSource,
      `
      SELECT ${SUMMARY_COLUMNS}
      FROM webhook_events e
      ${where}
      ORDER BY e.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.limit, query.offset],
    );

    return {
      total: Number(count),
      limit: query.limit,
      offset: query.offset,
      items: rows.map((row) => this.toSummary(row)),
    };
  }

  async findOne(eventId: string) {
    const [event] = await queryRows<EventDetailRow>(
      this.dataSource,
      `
      SELECT ${SUMMARY_COLUMNS}, e.payload
      FROM webhook_events e
      WHERE e.event_id = $1
      `,
      [eventId],
    );

    if (!event) {
      throw new NotFoundException(`Event ${eventId} not found`);
    }

    const attempts = await queryRows<AttemptRow>(
      this.dataSource,
      `
      SELECT attempt_number, worker_id, started_at, finished_at, result, error
      FROM processing_attempts
      WHERE event_id = $1
      ORDER BY attempt_number ASC
      `,
      [eventId],
    );

    const [processedOrder] = await queryRows<ProcessedOrderRow>(
      this.dataSource,
      `
      SELECT order_id, processed_at
      FROM processed_orders
      WHERE event_id = $1
      `,
      [eventId],
    );

    return {
      ...this.toSummary(event),
      payload: event.payload,
      processedOrder: processedOrder
        ? {
            orderId: processedOrder.order_id,
            processedAt: processedOrder.processed_at,
          }
        : null,
      attemptHistory: attempts.map((attempt) => ({
        attemptNumber: attempt.attempt_number,
        workerId: attempt.worker_id,
        startedAt: attempt.started_at,
        finishedAt: attempt.finished_at,
        result: attempt.result,
        error: attempt.error,
      })),
    };
  }

  /**
   * Manual retry of a permanently failed event.
   *
   * - Only `failed` events qualify; the conditional UPDATE makes concurrent
   *   retry requests safe (exactly one wins, the others get 409).
   * - `attempts` is never reset, so attempt numbers keep increasing.
   * - The fresh budget is `attempts + MAX_ATTEMPTS`, i.e. the same number of
   *   new attempts a brand-new event gets.
   */
  async retry(eventId: string) {
    const budget = this.retryBudget;

    const rows = await queryRows<{
      event_id: string;
      attempts: number;
      max_attempts: number;
    }>(
      this.dataSource,
      `
      UPDATE webhook_events
      SET
        status = 'pending',
        max_attempts = attempts + $2::int,
        next_retry_at = NULL,
        locked_by = NULL,
        lease_until = NULL,
        lease_token = NULL,
        updated_at = NOW()
      WHERE event_id = $1
        AND status = 'failed'
      RETURNING event_id, attempts, max_attempts
      `,
      [eventId, budget],
    );

    if (rows.length === 0) {
      const [existing] = await queryRows<{ status: string }>(
        this.dataSource,
        `SELECT status FROM webhook_events WHERE event_id = $1`,
        [eventId],
      );

      if (!existing) {
        throw new NotFoundException(`Event ${eventId} not found`);
      }

      throw new ConflictException(
        `Event ${eventId} is "${existing.status}"; only failed events can be retried`,
      );
    }

    return {
      success: true,
      message: 'Event queued for retry',
      eventId: rows[0].event_id,
      attempts: rows[0].attempts,
      maxAttempts: rows[0].max_attempts,
    };
  }

  private get retryBudget(): number {
    const value = Number(this.configService.get('MAX_ATTEMPTS') ?? 5);

    return Number.isInteger(value) && value >= 1 ? value : 5;
  }

  private toSummary(row: EventSummaryRow) {
    return {
      eventId: row.event_id,
      type: row.type,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextRetryAt: row.next_retry_at,
      lockedBy: row.locked_by,
      leaseUntil: row.lease_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastError: row.last_error,
      processed: row.processed,
    };
  }
}
