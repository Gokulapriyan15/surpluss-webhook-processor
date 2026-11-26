import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

import { resetTables } from './helpers/db';
import { ensureTestDatabase } from './helpers/test-database';

interface WebhookResponse {
  success: boolean;
  eventId: string;
  duplicate: boolean;
}

describe('Webhook ingestion (HTTP + Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    await ensureTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTables(dataSource);
  });

  const post = (body: unknown) =>
    request(app.getHttpServer()).post('/api/webhooks').send(body as object);

  it('answers 202 and persists a new event before acknowledging', async () => {
    const response = await post({
      eventId: 'evt_new',
      type: 'order.created',
      data: { orderId: 'ORD-1' },
    });

    const body = response.body as WebhookResponse;

    expect(response.status).toBe(202);
    expect(body.duplicate).toBe(false);

    const rows = await dataSource.query(
      `SELECT status, attempts FROM webhook_events WHERE event_id = 'evt_new'`,
    );

    expect(rows).toEqual([{ status: 'pending', attempts: 0 }]);
  });

  it('stores exactly one event when the same eventId arrives 50 times simultaneously', async () => {
    const payload = {
      eventId: 'evt_burst_dup',
      type: 'order.created',
      data: { orderId: 'ORD-DUP' },
    };

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => post(payload)),
    );

    // Every delivery is acknowledged, new or duplicate.
    expect(responses.every((response) => response.status === 202)).toBe(true);

    const bodies = responses.map((response) => response.body as WebhookResponse);

    expect(bodies.filter((body) => !body.duplicate)).toHaveLength(1);
    expect(bodies.filter((body) => body.duplicate)).toHaveLength(49);

    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) AS count FROM webhook_events WHERE event_id = 'evt_burst_dup'`,
    );

    expect(Number(count)).toBe(1);
  });

  it('keeps the first payload when the same eventId is re-sent with a different one', async () => {
    await post({
      eventId: 'evt_conflict',
      type: 'order.created',
      data: { orderId: 'ORD-FIRST' },
    }).expect(202);

    const second = await post({
      eventId: 'evt_conflict',
      type: 'order.updated',
      data: { orderId: 'ORD-SECOND' },
    });

    expect(second.status).toBe(202);
    expect((second.body as WebhookResponse).duplicate).toBe(true);

    const [row] = await dataSource.query(
      `SELECT type, payload FROM webhook_events WHERE event_id = 'evt_conflict'`,
    );

    expect(row.type).toBe('order.created');
    expect(row.payload.data.orderId).toBe('ORD-FIRST');
  });

  it('rejects malformed requests without storing anything', async () => {
    await post({ type: 'order.created', data: {} }).expect(400);
    await post({ eventId: 'evt_x', type: 'order.created' }).expect(400);

    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) AS count FROM webhook_events`,
    );

    expect(Number(count)).toBe(0);
  });
});
