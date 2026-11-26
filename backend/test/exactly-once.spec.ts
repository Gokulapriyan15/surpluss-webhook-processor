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
  resetTables,
  seedEvent,
} from './helpers/db';

describe('Exactly-once business action (processed_orders)', () => {
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

  it('writes one row even if completion is attempted concurrently', async () => {
    await seedEvent(dataSource, { eventId: 'evt_once', orderId: 'ORD-ONCE' });

    const worker = createWorker(dataSource, 'worker-a');
    const claimed = await worker.claimEvent();

    expect(claimed).not.toBeNull();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        completion.completeEvent('evt_once', 'worker-a', claimed!.lease_token),
      ),
    );

    // The row lock lets exactly one completion win; the rest see the event
    // is no longer theirs and are rejected.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .every((r) => r.reason instanceof ConflictException),
    ).toBe(true);

    expect(await countOrders(dataSource, 'evt_once')).toBe(1);
    expect((await getEvent(dataSource, 'evt_once')).status).toBe('completed');

    const attempts = await getAttempts(dataSource, 'evt_once');

    expect(attempts).toHaveLength(1);
    expect(attempts[0].result).toBe('success');
  });

  it('rejects a completion that carries a stale lease token and writes nothing', async () => {
    await seedEvent(dataSource, { eventId: 'evt_stale' });

    const worker = createWorker(dataSource, 'worker-a');

    await worker.claimEvent();

    await expect(
      completion.completeEvent(
        'evt_stale',
        'worker-a',
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await countOrders(dataSource)).toBe(0);
    expect((await getEvent(dataSource, 'evt_stale')).status).toBe('processing');
  });

  it('does not create a second row when the business row already exists (crash after the business write)', async () => {
    await seedEvent(dataSource, { eventId: 'evt_replay', orderId: 'ORD-REPLAY' });

    const crashed = createWorker(dataSource, 'worker-crashed');

    await crashed.claimEvent();

    // The previous worker had already written the business row, then died
    // before the event was marked completed.
    await dataSource.query(
      `INSERT INTO processed_orders (order_id, event_id) VALUES ('ORD-REPLAY', 'evt_replay')`,
    );
    await expireLease(dataSource, 'evt_replay');

    // Another worker recovers and reprocesses the event.
    const survivor = createWorker(dataSource, 'worker-survivor');
    const event = await survivor.claimEvent();

    expect(event?.attempts).toBe(2);

    await survivor.processEvent(event!);

    expect(await countOrders(dataSource, 'evt_replay')).toBe(1);
    expect((await getEvent(dataSource, 'evt_replay')).status).toBe('completed');
  });

  it('fails the event instead of writing a row when the payload has no orderId', async () => {
    await dataSource.query(
      `INSERT INTO webhook_events (event_id, type, payload, max_attempts)
       VALUES ('evt_bad', 'order.created', '{"data":{}}'::jsonb, 1)`,
    );

    const worker = createWorker(dataSource, 'worker-a');
    const event = await worker.claimEvent();

    await worker.processEvent(event!);

    expect(await countOrders(dataSource)).toBe(0);

    const stored = await getEvent(dataSource, 'evt_bad');

    expect(stored.status).toBe('failed');
  });
});
