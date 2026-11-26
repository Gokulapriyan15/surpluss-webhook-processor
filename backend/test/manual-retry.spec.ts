import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

import {
  createWorker,
  getAttempts,
  getEvent,
  resetTables,
  runOnce,
  seedEvent,
} from './helpers/db';
import { ensureTestDatabase } from './helpers/test-database';

describe('Manual retry (POST /events/:id/retry)', () => {
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

  const retry = (eventId: string) =>
    request(app.getHttpServer()).post(`/api/events/${eventId}/retry`);

  it('gives a failed event a fresh budget while attempt numbers keep increasing', async () => {
    await seedEvent(dataSource, {
      eventId: 'evt_revive',
      simulate: 'fail_then_succeed:6',
      status: 'failed',
      attempts: 5,
      maxAttempts: 5,
    });

    await retry('evt_revive').expect(202);

    const revived = await getEvent(dataSource, 'evt_revive');

    expect(revived.status).toBe('pending');
    expect(revived.attempts).toBe(5); // not reset
    expect(revived.max_attempts).toBe(10); // 5 used + 5 new

    // The next attempt is #6, not #1, and succeeds (6 failures configured).
    const worker = createWorker(dataSource, 'worker-a');

    await runOnce(worker); // attempt 6 -> fails (<= 6)
    await dataSource.query(
      `UPDATE webhook_events SET next_retry_at = NOW() WHERE status = 'retrying'`,
    );
    await runOnce(worker); // attempt 7 -> succeeds

    const attempts = await getAttempts(dataSource, 'evt_revive');

    expect(attempts.map((a) => a.attempt_number)).toEqual([6, 7]);
    expect((await getEvent(dataSource, 'evt_revive')).status).toBe('completed');
  });

  it('lets exactly one of many simultaneous retry requests through', async () => {
    await seedEvent(dataSource, {
      eventId: 'evt_retry_race',
      status: 'failed',
      attempts: 5,
      maxAttempts: 5,
    });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => retry('evt_retry_race')),
    );

    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(7);

    // Budget granted once, not eight times.
    expect((await getEvent(dataSource, 'evt_retry_race')).max_attempts).toBe(10);
  });

  it('refuses to retry events that are not permanently failed', async () => {
    await seedEvent(dataSource, { eventId: 'evt_pending', status: 'pending' });
    await seedEvent(dataSource, { eventId: 'evt_done', status: 'completed' });

    await retry('evt_pending').expect(409);
    await retry('evt_done').expect(409);
  });

  it('returns 404 for an unknown event', async () => {
    await retry('evt_missing').expect(404);
  });
});
