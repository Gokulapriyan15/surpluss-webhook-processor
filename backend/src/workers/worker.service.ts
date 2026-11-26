
import {
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
  } from '@nestjs/common';
  import { DataSource } from 'typeorm';
  import { randomUUID } from 'crypto';
  import { BusinessCompletionService } from './business-completion.service';
  
  export interface ClaimedEvent {
    event_id: string;
    payload: Record<string, any>;
    attempts: number;
    max_attempts: number;
    lease_token: string;
  }
  
  @Injectable()
  export class WorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WorkerService.name);
  
    private readonly workerId =
      process.env.WORKER_ID || `worker-${randomUUID()}`;
  
    private readonly leaseSeconds = Number(
      process.env.WORKER_LEASE_SECONDS || 30,
    );
  
    private readonly pollIntervalMs = Number(
      process.env.WORKER_POLL_INTERVAL_MS || 1000,
    );
  
    private running = false;
    private stopping = false;
  
    constructor(
      private readonly dataSource: DataSource,
      private readonly businessCompletion: BusinessCompletionService,
    ) {}
  
    onModuleInit() {
      // The API process must not start a worker.
      if (process.env.WORKER_ENABLED !== 'true') {
        this.logger.log('Background worker is disabled');
        return;
      }
  
      this.running = true;
      this.logger.log(`Worker started: ${this.workerId}`);
  
      void this.run();
    }
  
    onModuleDestroy() {
      this.stopping = true;
      this.running = false;
      this.logger.log(`Worker stopping: ${this.workerId}`);
    }
  
    private async run(): Promise<void> {
      while (this.running && !this.stopping) {
        try {
          await this.failExhaustedEvents();

          const event = await this.claimEvent();

          if (!event) {
            await this.sleep(this.pollIntervalMs);
            continue;
          }
  
          await this.processEvent(event);
        } catch (error) {
          this.logger.error(
            'Worker loop error',
            error instanceof Error ? error.stack : String(error),
          );
  
          await this.sleep(this.pollIntervalMs);
        }
      }
    }
  
    /**
     * Crash recovery for the last attempt.
     *
     * claimEvent() only picks events with attempts < max_attempts. If a worker
     * dies during the FINAL attempt, the event would sit in `processing`
     * forever. Any expired-lease event with no attempts left is therefore
     * moved to `failed` here (and its dangling attempt record is closed).
     */
    async failExhaustedEvents(): Promise<void> {
      const rows = await this.queryRows<{ event_id: string }>(
        `
        WITH expired AS (
          UPDATE webhook_events
          SET
            status = 'failed',
            next_retry_at = NULL,
            locked_by = NULL,
            lease_until = NULL,
            lease_token = NULL,
            updated_at = NOW()
          WHERE id IN (
            SELECT id
            FROM webhook_events
            WHERE status = 'processing'
              AND lease_until <= NOW()
              AND attempts >= max_attempts
            FOR UPDATE SKIP LOCKED
          )
          RETURNING event_id, attempts
        ),
        closed AS (
          UPDATE processing_attempts AS attempt
          SET
            finished_at = NOW(),
            result = 'failed',
            error = 'Lease expired on the final attempt (worker crashed or stalled)'
          FROM expired
          WHERE attempt.event_id = expired.event_id
            AND attempt.result = 'running'
          RETURNING attempt.id
        )
        SELECT event_id FROM expired
        `,
        [],
      );

      for (const row of rows) {
        this.logger.warn(
          `${row.event_id} permanently failed: lease expired on final attempt`,
        );
      }
    }

    /**
     * Atomically claims one available event.
     * SKIP LOCKED allows multiple workers to claim different events.
     */
    async claimEvent(): Promise<ClaimedEvent | null> {
      const leaseToken = randomUUID();
  
      const rows = await this.queryRows<ClaimedEvent>(
        `
        WITH candidate AS (
          SELECT id
          FROM webhook_events
          WHERE
            (
              (
                status IN ('pending', 'retrying')
                AND (
                  next_retry_at IS NULL
                  OR next_retry_at <= NOW()
                )
              )
              OR
              (
                status = 'processing'
                AND lease_until <= NOW()
              )
            )
            AND attempts < max_attempts
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ),
        claimed AS (
          UPDATE webhook_events AS event
          SET
            status = 'processing',
            attempts = event.attempts + 1,
            locked_by = $1::varchar,
            lease_until = NOW() + ($2 * INTERVAL '1 second'),
            lease_token = $3,
            updated_at = NOW()
          FROM candidate
          WHERE event.id = candidate.id
          RETURNING
            event.event_id,
            event.payload,
            event.attempts,
            event.max_attempts,
            event.lease_token
        ),
        -- A re-claimed event means the previous attempt never finished
        -- (worker crashed or stalled past its lease). Close it out.
        closed_stale AS (
          UPDATE processing_attempts AS attempt
          SET
            finished_at = NOW(),
            result = 'failed',
            error = 'Lease expired before the attempt finished (worker crashed or stalled)'
          FROM claimed
          WHERE attempt.event_id = claimed.event_id
            AND attempt.result = 'running'
          RETURNING attempt.id
        ),
        new_attempt AS (
          INSERT INTO processing_attempts (
            event_id,
            attempt_number,
            worker_id,
            started_at,
            result
          )
          SELECT event_id, attempts, $1::varchar, NOW(), 'running'
          FROM claimed
          RETURNING id
        )
        SELECT
          event_id,
          payload,
          attempts,
          max_attempts,
          lease_token
        FROM claimed
        `,
        [this.workerId, this.leaseSeconds, leaseToken],
      );
  
      return rows.length > 0 ? rows[0] : null;
    }
  
    async processEvent(event: ClaimedEvent): Promise<void> {
      this.logger.log(
        `Processing ${event.event_id}, attempt ${event.attempts}`,
      );
  
      let leaseLost = false;
  
      // Keep extending the lease while this worker is processing.
      const heartbeat = setInterval(async () => {
        try {
          const result = await this.queryRows<{ event_id: string }>(
            `
            UPDATE webhook_events
            SET
              lease_until = NOW() + ($1 * INTERVAL '1 second'),
              updated_at = NOW()
            WHERE event_id = $2
              AND status = 'processing'
              AND locked_by = $3
              AND lease_token = $4
            RETURNING event_id
            `,
            [
              this.leaseSeconds,
              event.event_id,
              this.workerId,
              event.lease_token,
            ],
          );
  
          if (result.length === 0) {
            leaseLost = true;
            this.logger.warn(`Lease lost for ${event.event_id}`);
          }
        } catch (error) {
          this.logger.error(
            `Lease renewal failed for ${event.event_id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }, Math.max(1000, Math.floor((this.leaseSeconds * 1000) / 3)));
  
      try {
        await this.simulateProcessing(event);
  
        if (leaseLost) {
          throw new Error('Worker lost ownership of the event');
        }
  
        await this.businessCompletion.completeEvent(
          event.event_id,
          this.workerId,
          event.lease_token,
        );
  
        this.logger.log(`Completed ${event.event_id}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
  
        this.logger.error(`Failed ${event.event_id}: ${message}`);
  
        // Do not change the event if another worker owns it now.
        if (!leaseLost) {
          await this.scheduleRetry(event, message);
        }
      } finally {
        clearInterval(heartbeat);
      }
    }
  
    /**
     * Implements the four simulation values from the assessment.
     */
    private async simulateProcessing(event: ClaimedEvent): Promise<void> {
      const simulate = event.payload?.data?.simulate ?? 'ok';
  
      if (simulate === 'ok') {
        return;
      }
  
      if (simulate === 'always_fail') {
        throw new Error('Simulated failure: always_fail');
      }
  
      if (typeof simulate !== 'string') {
        throw new Error('Invalid simulate value');
      }
  
      const failMatch = simulate.match(/^fail_then_succeed:(\d+)$/);
  
      if (failMatch) {
        const failureCount = Number(failMatch[1]);
  
        if (event.attempts <= failureCount) {
          throw new Error(
            `Simulated temporary failure on attempt ${event.attempts}`,
          );
        }
  
        return;
      }
  
      const slowMatch = simulate.match(/^slow:(\d+)$/);
  
      if (slowMatch) {
        const seconds = Number(slowMatch[1]);
  
        await this.sleep(seconds * 1000);
        return;
      }
  
      throw new Error(`Unsupported simulate value: ${simulate}`);
    }
  
    /**
     * Retry with exponential backoff.
     * The delay is capped at 60 seconds.
     */
    private async scheduleRetry(
      event: ClaimedEvent,
      errorMessage: string,
    ): Promise<void> {
      const delaySeconds = Math.min(
        2 ** Math.max(0, event.attempts - 1),
        60,
      );
  
      const isPermanentlyFailed =
        event.attempts >= event.max_attempts;
  
      // One statement => the event transition and the attempt record
      // either both happen or neither does.
      await this.dataSource.query(
        `
        WITH updated AS (
          UPDATE webhook_events
          SET
            status = $1::varchar,
            next_retry_at = CASE
              WHEN $1::varchar = 'retrying'
              THEN NOW() + ($2 * INTERVAL '1 second')
              ELSE NULL
            END,
            locked_by = NULL,
            lease_until = NULL,
            lease_token = NULL,
            updated_at = NOW()
          WHERE event_id = $3
            AND status = 'processing'
            AND locked_by = $4
            AND lease_token = $5
          RETURNING event_id, attempts
        )
        UPDATE processing_attempts AS attempt
        SET
          finished_at = NOW(),
          result = 'failed',
          error = $6
        FROM updated
        WHERE attempt.event_id = updated.event_id
          AND attempt.attempt_number = updated.attempts
          AND attempt.result = 'running'
        `,
        [
          isPermanentlyFailed ? 'failed' : 'retrying',
          delaySeconds,
          event.event_id,
          this.workerId,
          event.lease_token,
          errorMessage,
        ],
      );
  
      this.logger.log(
        isPermanentlyFailed
          ? `${event.event_id} permanently failed`
          : `${event.event_id} scheduled for retry in ${delaySeconds}s`,
      );
    }
  
    /**
     * TypeORM's Postgres driver returns `[rows, affectedCount]` for UPDATE/DELETE
     * (even with RETURNING) and a plain rows array for SELECT/INSERT.
     * Normalise to rows only.
     */
    private async queryRows<T>(
      sql: string,
      params: unknown[],
    ): Promise<T[]> {
      const raw: unknown = await this.dataSource.query(sql, params);

      if (
        Array.isArray(raw) &&
        raw.length === 2 &&
        Array.isArray(raw[0]) &&
        typeof raw[1] === 'number'
      ) {
        return raw[0] as T[];
      }

      return raw as T[];
    }

    /**
     * setTimeout overflows (and fires immediately) above 2^31-1 ms, which would
     * make a huge `slow:N` finish instantly. Sleep in bounded chunks instead.
     */
    private async sleep(ms: number): Promise<void> {
      const MAX_CHUNK_MS = 1_000_000_000;
      let remaining = ms;

      while (remaining > 0) {
        const chunk = Math.min(remaining, MAX_CHUNK_MS);

        await new Promise<void>((resolve) => setTimeout(resolve, chunk));
        remaining -= chunk;
      }
    }
  }
  