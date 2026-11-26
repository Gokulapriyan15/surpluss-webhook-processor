import { DataSource } from 'typeorm';

import { BusinessCompletionService } from '../../src/workers/business-completion.service';
import { WorkerService } from '../../src/workers/worker.service';

import { ensureTestDatabase } from './test-database';
import { testDbConfig } from './test-config';

export async function createTestDataSource(): Promise<DataSource> {
  await ensureTestDatabase();

  const dataSource = new DataSource({
    type: 'postgres',
    ...testDbConfig,
  });

  await dataSource.initialize();

  return dataSource;
}

export async function resetTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE processed_orders, processing_attempts, webhook_events RESTART IDENTITY',
  );
}

export interface SeedEventOptions {
  eventId: string;
  orderId?: string;
  simulate?: string;
  status?: string;
  attempts?: number;
  maxAttempts?: number;
}

/** Inserts an event exactly as the ingestion endpoint would store it. */
export async function seedEvent(
  dataSource: DataSource,
  options: SeedEventOptions,
): Promise<void> {
  const data: Record<string, unknown> = {
    orderId: options.orderId ?? `ORD-${options.eventId}`,
  };

  if (options.simulate !== undefined) {
    data.simulate = options.simulate;
  }

  await dataSource.query(
    `
    INSERT INTO webhook_events (event_id, type, payload, status, attempts, max_attempts)
    VALUES ($1, 'order.created', $2::jsonb, $3, $4, $5)
    `,
    [
      options.eventId,
      JSON.stringify({ eventId: options.eventId, type: 'order.created', data }),
      options.status ?? 'pending',
      options.attempts ?? 0,
      options.maxAttempts ?? 5,
    ],
  );
}

/** A worker instance with its own identity, like a separate container. */
export function createWorker(
  dataSource: DataSource,
  workerId: string,
): WorkerService {
  // WorkerService reads WORKER_ID when it is constructed.
  process.env.WORKER_ID = workerId;

  return new WorkerService(
    dataSource,
    new BusinessCompletionService(dataSource),
  );
}

/**
 * One iteration of the worker loop (recover exhausted events, claim, process),
 * without sleeping. Returns false when there was nothing to claim.
 */
export async function runOnce(worker: WorkerService): Promise<boolean> {
  await worker.failExhaustedEvents();

  const event = await worker.claimEvent();

  if (!event) {
    return false;
  }

  await worker.processEvent(event);

  return true;
}

/** Skips the retry backoff wait so a test does not have to sleep. */
export async function makeRetriesDue(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `UPDATE webhook_events SET next_retry_at = NOW() WHERE status = 'retrying'`,
  );
}

/** Simulates a worker that died: its lease is now in the past. */
export async function expireLease(
  dataSource: DataSource,
  eventId: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE webhook_events SET lease_until = NOW() - INTERVAL '1 second' WHERE event_id = $1`,
    [eventId],
  );
}

export interface EventRow {
  status: string;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  lease_token: string | null;
}

export async function getEvent(
  dataSource: DataSource,
  eventId: string,
): Promise<EventRow> {
  const rows: EventRow[] = await dataSource.query(
    `SELECT status, attempts, max_attempts, locked_by, lease_token FROM webhook_events WHERE event_id = $1`,
    [eventId],
  );

  return rows[0];
}

export interface AttemptRow {
  attempt_number: number;
  worker_id: string;
  result: string;
  error: string | null;
}

export function getAttempts(
  dataSource: DataSource,
  eventId: string,
): Promise<AttemptRow[]> {
  return dataSource.query(
    `SELECT attempt_number, worker_id, result, error FROM processing_attempts WHERE event_id = $1 ORDER BY attempt_number`,
    [eventId],
  );
}

export async function countOrders(
  dataSource: DataSource,
  eventId?: string,
): Promise<number> {
  const rows: Array<{ count: string }> = eventId
    ? await dataSource.query(
        `SELECT COUNT(*) AS count FROM processed_orders WHERE event_id = $1`,
        [eventId],
      )
    : await dataSource.query(`SELECT COUNT(*) AS count FROM processed_orders`);

  return Number(rows[0].count);
}
