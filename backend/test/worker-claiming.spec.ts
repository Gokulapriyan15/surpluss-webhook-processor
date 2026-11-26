import { DataSource } from 'typeorm';

import {
  createTestDataSource,
  createWorker,
  getAttempts,
  resetTables,
  seedEvent,
} from './helpers/db';

describe('Worker claiming (two workers never share an event)', () => {
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

  it('hands every event to exactly one of several concurrent workers', async () => {
    const EVENT_COUNT = 40;

    for (let i = 0; i < EVENT_COUNT; i += 1) {
      await seedEvent(dataSource, { eventId: `evt_claim_${i}` });
    }

    const workers = ['worker-a', 'worker-b', 'worker-c', 'worker-d'].map(
      (id) => createWorker(dataSource, id),
    );

    // All workers drain the queue at the same time.
    const claimedPerWorker = await Promise.all(
      workers.map(async (worker) => {
        const claimed: string[] = [];

        for (;;) {
          const event = await worker.claimEvent();

          if (!event) {
            return claimed;
          }

          claimed.push(event.event_id);
        }
      }),
    );

    const allClaimed = claimedPerWorker.flat();

    // No event was claimed twice, and none was left behind.
    expect(allClaimed).toHaveLength(EVENT_COUNT);
    expect(new Set(allClaimed).size).toBe(EVENT_COUNT);

    // The work was actually shared, not done by a single worker.
    expect(claimedPerWorker.filter((claimed) => claimed.length > 0).length).toBeGreaterThan(1);

    // Each event has exactly one running attempt (#1), owned by one worker.
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) AS count FROM processing_attempts WHERE attempt_number = 1 AND result = 'running'`,
    );

    expect(Number(count)).toBe(EVENT_COUNT);
  });

  it('does not claim an event that is already being processed with a live lease', async () => {
    await seedEvent(dataSource, { eventId: 'evt_leased' });

    const workerA = createWorker(dataSource, 'worker-a');
    const workerB = createWorker(dataSource, 'worker-b');

    const claimedByA = await workerA.claimEvent();

    expect(claimedByA?.event_id).toBe('evt_leased');
    expect(await workerB.claimEvent()).toBeNull();
  });

  it('does not claim a retrying event before its backoff has elapsed', async () => {
    await seedEvent(dataSource, { eventId: 'evt_backoff', status: 'retrying' });
    await dataSource.query(
      `UPDATE webhook_events SET next_retry_at = NOW() + INTERVAL '1 hour' WHERE event_id = 'evt_backoff'`,
    );

    const worker = createWorker(dataSource, 'worker-a');

    expect(await worker.claimEvent()).toBeNull();
  });

  it('never claims an event whose attempts are used up (retry budget applies to every status)', async () => {
    // Regression guard for the WHERE-clause grouping: the attempts limit must
    // apply to pending/retrying events as well as to expired processing ones.
    await seedEvent(dataSource, {
      eventId: 'evt_no_budget',
      status: 'pending',
      attempts: 3,
      maxAttempts: 3,
    });

    const worker = createWorker(dataSource, 'worker-a');

    expect(await worker.claimEvent()).toBeNull();
    expect(await getAttempts(dataSource, 'evt_no_budget')).toHaveLength(0);
  });
});
