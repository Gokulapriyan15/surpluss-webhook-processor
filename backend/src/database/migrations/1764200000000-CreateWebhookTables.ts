
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookTables1764200000000
  implements MigrationInterface
{
  name = 'CreateWebhookTables1764200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE webhook_events (
        id BIGSERIAL PRIMARY KEY,

        event_id VARCHAR(255) NOT NULL UNIQUE,

        type VARCHAR(255) NOT NULL,

        payload JSONB NOT NULL,

        status VARCHAR(30) NOT NULL DEFAULT 'pending',

        attempts INTEGER NOT NULL DEFAULT 0,

        max_attempts INTEGER NOT NULL DEFAULT 5,

        next_retry_at TIMESTAMPTZ NULL,

        locked_by VARCHAR(255) NULL,

        lease_until TIMESTAMPTZ NULL,

        lease_token UUID NULL,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_webhook_events_status
      ON webhook_events(status);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_webhook_events_next_retry_at
      ON webhook_events(next_retry_at);
    `);

    await queryRunner.query(`
      CREATE TABLE processing_attempts (
        id BIGSERIAL PRIMARY KEY,

        event_id VARCHAR(255) NOT NULL,

        attempt_number INTEGER NOT NULL,

        worker_id VARCHAR(255) NOT NULL,

        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        finished_at TIMESTAMPTZ NULL,

        result VARCHAR(30) NOT NULL DEFAULT 'running',

        error TEXT NULL,

        CONSTRAINT fk_attempts_webhook_event
          FOREIGN KEY (event_id)
          REFERENCES webhook_events(event_id)
          ON DELETE RESTRICT,

        CONSTRAINT uq_processing_attempt_event_number
          UNIQUE (event_id, attempt_number)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE processed_orders (
        id BIGSERIAL PRIMARY KEY,

        order_id VARCHAR(255) NOT NULL,

        event_id VARCHAR(255) NOT NULL UNIQUE,

        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_processed_order_webhook_event
          FOREIGN KEY (event_id)
          REFERENCES webhook_events(event_id)
          ON DELETE RESTRICT
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE processed_orders`);
    await queryRunner.query(`DROP TABLE processing_attempts`);
    await queryRunner.query(`DROP TABLE webhook_events`);
  }
}
