import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BusinessCompletionService } from '../src/workers/business-completion.service';

import {
  countOrders,
  createTestDataSource,
  createWorker,
  expireLease,
  getAttempts,
  getEvent,
  makeRetriesDue,
  resetTables,
  runOnce,
  seedEvent,
} from './helpers/db';

describe('Retries and backoff', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetTables(dataSource);
  });

  it('fail_then_succeed:2 fails twice, then succeeds on attempt 3 with one business row', async () => {
    await seedEvent(dataSource, {
      eventId: 'evt_flaky',
      simulate: 'fail_then_succeed:2',
    });

    const worker = createWorker(dataSource, 'worker-a');

    for (let i = 0; i < 3; i += 1) {
      await makeRetriesDue(dataSource);
      expect(await runOnce(worker)).toBe(true);
    }

    expect((await getEvent(dataSource, 'evt_flaky')).status).toBe('completed');
    expect(await countOrders(dataSource, 'evt_flaky')).toBe(1);

    const attempts = await getAttempts(dataSource, 'evt_flaky');

    expect(attempts.map((a) => [a.attempt_number, a.result])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'success'],
    ]);
    expect(attempts[0].error).toContain('Simulated temporary failure');
  });

  it('always_fail stops at exactly max_attempts and is marked permanently failed', async () => {
    await seedEvent(dataSource, {
      eventId: 'evt_dead',
      simulate: 'always_fail',
      maxAttempts: 3,
    });

    const worker = createWorker(dataSource, 'worker-a');

    for (let i = 0; i < 3; i += 1) {
      await makeRetriesDue(dataSource);
      await runOnce(worker);
    }

    const event = await getEvent(dataSource, 'evt_dead');

    expect(event.status).toBe('failed');
    expect(event.attempts).toBe(3);

    // Nothing left to claim: retries really stopped.
    await makeRetriesDue(dataSource);
    expect(await runOnce(worker)).toBe(false);

    expect(await getAttempts(dataSource, 'evt_dead')).toHaveLength(3);
    expect(await countOrders(dataSource)).toBe(0);
  });

  it('a retry count higher than the cap still ends in permanent failure at the cap', async () => {
    await seedEvent(dataSource, {
      eventId: 'evt_too_flaky',
      simulate: 'fail_then_succeed:10',
      maxAttempts: 3,
    });

    const worker = createWorker(dataSource, 'worker-a');

    for (let i = 0; i < 5; i += 1) {
      await makeRetriesDue(dataSource);
      await runOnce(worker);
    }

    const event = await getEvent(dataSource, 'evt_too_flaky');

    expect(event.status).toBe('failed');
    expect(event.attempts).toBe(3);
    expect(await countOrders(dataSource)).toBe(0);
  });

  it('uses exponential backoff (1s, 2s, 4s) capped at 60s', async () => {
    await seedEvent(dataSource, {
      eventId: 'evt_backoff',
      simulate: 'always_fail',
      maxAttempts: 10,
    });

    const worker = createWorker(dataSource, 'worker-a');
    const delays: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      await makeRetriesDue(dataSource);
      await runOnce(worker);

      const [row] = await dataSource.query(
        `SELECT EXTRACT(EPOCH FROM (next_retry_at - updated_at))::float AS delay
         FROM webhook_events WHERE event_id = 'evt_backoff'`,
      );

      delays.push(Math.round(row.delay));
    }

    expect(delays).toEqual([1, 2, 4]);

    // Far into the sequence the delay must not keep doubling.
    await seedEvent(dataSource, {
      eventId: 'evt_backoff_cap',
      simulate: 'always_fail',
      attempts: 9,
      maxAttempts: 20,
    });

    await runOnce(worker);

    const [capped] = await dataSource.query(
      `SELECT EXTRACT(EPOCH FROM (next_retry_at - updated_at))::float AS delay
       FROM webhook_events WHERE event_id = 'evt_backoff_cap'`,
    );

    expect(Math.round(capped.delay)).toBe(60);
  });
});

describe('Crash recovery', () => {
  let dataSource: DataSource;
  let completion: BusinessCompletionService;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    completion = new BusinessCompletionService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetTables(dataSource);
  });

  it('another worker recovers an event whose worker died mid-processing, with exactly one business row', async () => {
    await seedEvent(dataSource, { eventId: 'evt_crash', orderId: 'ORD-CRASH' });

    const dead = createWorker(dataSource, 'worker-dead');
    const alive = createWorker(dataSource, 'worker-alive');

    // The worker claims the event and then "dies": nothing else ever happens.
    const abandoned = await dead.claimEvent();

    expect(abandoned?.attempts).toBe(1);

    // While the lease is valid nobody may take it over.
    expect(await alive.claimEvent()).toBeNull();

    await expireLease(dataSource, 'evt_crash');

    const recovered = await alive.claimEvent();

    expect(recovered?.event_id).toBe('evt_crash');
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.lease_token).not.toBe(abandoned?.lease_token);

    await alive.processEvent(recovered!);

    const event = await getEvent(dataSource, 'evt_crash');

    expect(event.status).toBe('completed');
    expect(await countOrders(dataSource, 'evt_crash')).toBe(1);

    // The dead worker's attempt is closed as failed, not left "running".
    const attempts = await getAttempts(dataSource, 'evt_crash');

    expect(
      attempts.map((a) => [a.attempt_number, a.worker_id, a.result]),
    ).toEqual([
      [1, 'worker-dead', 'failed'],
      [2, 'worker-alive', 'success'],
    ]);
    expect(attempts[0].error).toContain('Lease expired');
  });

  it('a "zombie" worker that wakes up later cannot complete the event again', async () => {
    await seedEvent(dataSource, { eventId: 'evt_zombie' });

    const zombie = createWorker(dataSource, 'worker-zombie');
    const survivor = createWorker(dataSource, 'worker-survivor');

    const zombieClaim = await zombie.claimEvent();

    await expireLease(dataSource, 'evt_zombie');

    const survivorClaim = await survivor.claimEvent();

    await survivor.processEvent(survivorClaim!);

    // The zombie finally tries to finish with its old, now-invalid lease.
    await expect(
      completion.completeEvent(
        'evt_zombie',
        'worker-zombie',
        zombieClaim!.lease_token,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await countOrders(dataSource, 'evt_zombie')).toBe(1);
  });

  it('a worker that dies on the FINAL attempt does not leave the event stuck in processing', async () => {
    await seedEvent(dataSource, { eventId: 'evt_last', maxAttempts: 1 });

    const dead = createWorker(dataSource, 'worker-dead');
    const alive = createWorker(dataSource, 'worker-alive');

    await dead.claimEvent();
    await expireLease(dataSource, 'evt_last');

    // No attempts are left to hand out...
    expect(await alive.claimEvent()).toBeNull();

    // ...so the recovery sweep must finalise the event.
    await alive.failExhaustedEvents();

    const event = await getEvent(dataSource, 'evt_last');

    expect(event.status).toBe('failed');
    expect(event.locked_by).toBeNull();
    expect(event.lease_token).toBeNull();

    const attempts = await getAttempts(dataSource, 'evt_last');

    expect(attempts).toHaveLength(1);
    expect(attempts[0].result).toBe('failed');
    expect(await countOrders(dataSource)).toBe(0);
  });

  it('concurrent recovery: two workers racing for an expired event produce one claim and one row', async () => {
    await seedEvent(dataSource, { eventId: 'evt_race' });

    const dead = createWorker(dataSource, 'worker-dead');

    await dead.claimEvent();
    await expireLease(dataSource, 'evt_race');

    const workers = ['worker-1', 'worker-2', 'worker-3'].map((id) =>
      createWorker(dataSource, id),
    );

    const claims = await Promise.all(workers.map((w) => w.claimEvent()));
    const winners = claims.filter((claim) => claim !== null);

    expect(winners).toHaveLength(1);

    const winnerIndex = claims.findIndex((claim) => claim !== null);

    await workers[winnerIndex].processEvent(winners[0]!);

    expect(await countOrders(dataSource, 'evt_race')).toBe(1);
  });
});
