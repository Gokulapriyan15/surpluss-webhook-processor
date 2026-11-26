/**
 * Demonstration scenarios for the Reliable Webhook Processor.
 *
 *   node scripts/demo.ts <scenario>
 *
 * Scenarios: duplicate | temporary-failure | permanent-failure | parallel |
 *            crash | burst | all   (all = the first four; crash and burst are
 *            run separately because they kill a container / send 500 events)
 *
 * Requires Node >= 22.18 (runs TypeScript natively) and the stack running via
 * `docker compose up`. Environment overrides:
 *   API_URL            default http://localhost:3001/api
 *   CONTAINER_PREFIX   default "surpluss-"   (worker containers: surpluss-worker-1, ...)
 *   POSTGRES_CONTAINER default surpluss-postgres
 *   BURST_COUNT        default 500
 */
import { execFileSync } from 'node:child_process';

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api';
const CONTAINER_PREFIX = process.env.CONTAINER_PREFIX ?? 'surpluss-';
const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER ?? 'surpluss-postgres';
const BURST_COUNT = Number(process.env.BURST_COUNT ?? 500);

const RUN_ID = Date.now().toString(36);

interface WebhookResponse {
  success: boolean;
  eventId: string;
  duplicate: boolean;
}

interface Attempt {
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  finishedAt: string | null;
  result: string;
  error: string | null;
}

interface EventDetail {
  eventId: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  processed: boolean;
  attemptHistory: Attempt[];
}

interface EventList {
  total: number;
}

interface SendResult {
  status: number;
  body: WebhookResponse;
  ms: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status}`);
  }

  return (await response.json()) as T;
}

async function sendEvent(
  eventId: string,
  simulate: string,
  orderId = `ORD-${eventId}`,
): Promise<SendResult> {
  const started = performance.now();

  const response = await fetch(`${API_URL}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId,
      type: 'order.created',
      data: { orderId, customerId: 'CUS-42', simulate },
    }),
  });

  return {
    status: response.status,
    body: (await response.json()) as WebhookResponse,
    ms: performance.now() - started,
  };
}

const getEvent = (eventId: string) =>
  api<EventDetail>(`/events/${encodeURIComponent(eventId)}`);

async function waitFor(
  eventId: string,
  predicate: (event: EventDetail) => boolean,
  timeoutMs: number,
): Promise<EventDetail> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const event = await getEvent(eventId);

    if (predicate(event)) {
      return event;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${eventId} (status=${event.status}, attempts=${event.attempts})`,
      );
    }

    await sleep(500);
  }
}

/** Counts processed_orders rows straight from Postgres (best effort). */
function countOrders(whereClause: string): number | null {
  try {
    const output = execFileSync(
      'docker',
      [
        'exec',
        POSTGRES_CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-d',
        'webhook_processor',
        '-tAc',
        `SELECT COUNT(*) FROM processed_orders WHERE ${whereClause}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );

    return Number(output.trim());
  } catch {
    return null;
  }
}

function printAttempts(event: EventDetail): void {
  console.table(
    event.attemptHistory.map((attempt) => ({
      '#': attempt.attemptNumber,
      worker: attempt.workerId,
      result: attempt.result,
      error: attempt.error ?? '',
    })),
  );
}

const results: Array<{ scenario: string; ok: boolean }> = [];

function verdict(scenario: string, ok: boolean, detail: string): void {
  results.push({ scenario, ok });
  console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${scenario} - ${detail}\n`);
}

function header(title: string): void {
  console.log(`\n=== ${title} ${'='.repeat(Math.max(0, 66 - title.length))}`);
}

// ---------------------------------------------------------------------------

async function duplicate(): Promise<void> {
  header('Duplicate event: same eventId, 20 simultaneous deliveries');

  const eventId = `evt_dup_${RUN_ID}`;
  const sent = await Promise.all(
    Array.from({ length: 20 }, () => sendEvent(eventId, 'ok')),
  );

  const accepted = sent.filter((r) => r.status === 202).length;
  const fresh = sent.filter((r) => !r.body.duplicate).length;

  console.log(`accepted (202): ${accepted}/20, new: ${fresh}, duplicates: ${20 - fresh}`);

  const event = await waitFor(eventId, (e) => e.status === 'completed', 30_000);
  const orders = countOrders(`event_id = '${eventId}'`);

  console.log(`event status: ${event.status}, processed_orders rows: ${orders ?? '(docker unavailable)'}`);

  verdict(
    'duplicate',
    accepted === 20 && fresh === 1 && (orders === null ? event.processed : orders === 1),
    'all deliveries acknowledged, one event, exactly one processed_orders row',
  );
}

async function temporaryFailure(): Promise<void> {
  header('Temporary failure: fail_then_succeed:2');

  const eventId = `evt_flaky_${RUN_ID}`;

  await sendEvent(eventId, 'fail_then_succeed:2');

  const event = await waitFor(eventId, (e) => e.status === 'completed', 60_000);

  printAttempts(event);

  const sequence = event.attemptHistory.map((a) => a.result).join(',');
  const orders = countOrders(`event_id = '${eventId}'`);

  verdict(
    'temporary-failure',
    sequence === 'failed,failed,success' && (orders === null || orders === 1),
    `attempt results: ${sequence}, processed_orders=${orders ?? 'n/a'}`,
  );
}

async function permanentFailure(): Promise<void> {
  header('Permanent failure: always_fail (retries must stop)');

  const eventId = `evt_dead_${RUN_ID}`;

  await sendEvent(eventId, 'always_fail');

  const event = await waitFor(eventId, (e) => e.status === 'failed', 120_000);

  printAttempts(event);

  console.log('waiting 12s to prove no further attempts happen...');
  await sleep(12_000);

  const later = await getEvent(eventId);
  const orders = countOrders(`event_id = '${eventId}'`);

  verdict(
    'permanent-failure',
    later.status === 'failed' &&
      later.attempts === event.attempts &&
      later.attempts === later.maxAttempts &&
      (orders ?? 0) === 0,
    `status=${later.status}, attempts=${later.attempts}/${later.maxAttempts}, processed_orders=${orders ?? 'n/a'}`,
  );
}

async function parallel(): Promise<void> {
  header('Parallel processing: 6 x slow:5 (sequential would take >= 30s)');

  const ids = Array.from({ length: 6 }, (_, i) => `evt_par_${RUN_ID}_${i + 1}`);
  const started = Date.now();

  await Promise.all(ids.map((id) => sendEvent(id, 'slow:5')));

  const events = await Promise.all(
    ids.map((id) => waitFor(id, (e) => e.status === 'completed', 90_000)),
  );

  const elapsed = (Date.now() - started) / 1000;
  const byWorker = new Map<string, number>();

  for (const event of events) {
    for (const attempt of event.attemptHistory) {
      byWorker.set(attempt.workerId, (byWorker.get(attempt.workerId) ?? 0) + 1);
    }
  }

  console.log(`all completed in ${elapsed.toFixed(1)}s`);
  console.table(Object.fromEntries(byWorker));

  verdict(
    'parallel',
    byWorker.size > 1 && elapsed < 27,
    `${byWorker.size} workers shared the load; wall time ${elapsed.toFixed(1)}s`,
  );
}

async function crash(): Promise<void> {
  header('Worker crash: docker kill the worker holding a slow:20 event');

  const eventId = `evt_crash_${RUN_ID}`;

  await sendEvent(eventId, 'slow:20');

  const claimed = await waitFor(
    eventId,
    (e) => e.status === 'processing' && e.lockedBy !== null,
    15_000,
  );

  const container = `${CONTAINER_PREFIX}${claimed.lockedBy}`;

  console.log(`${eventId} is being processed by ${claimed.lockedBy}; killing ${container}`);
  execFileSync('docker', ['kill', container], { stdio: 'inherit' });

  console.log('waiting for the lease to expire and another worker to recover it (up to ~60s)...');

  const recovered = await waitFor(eventId, (e) => e.status === 'completed', 120_000);

  printAttempts(recovered);

  const orders = countOrders(`event_id = '${eventId}'`);
  const first = recovered.attemptHistory[0];
  const last = recovered.attemptHistory[recovered.attemptHistory.length - 1];

  // Bring the killed worker back so the stack is whole again.
  try {
    execFileSync('docker', ['start', container], { stdio: 'ignore' });
  } catch {
    // Already restarted by its restart policy.
  }

  verdict(
    'crash',
    first.result === 'failed' &&
      (first.error ?? '').includes('Lease expired') &&
      last.result === 'success' &&
      (orders === null ? recovered.processed : orders === 1),
    `attempt 1 abandoned by ${claimed.lockedBy}, finished by ${last.workerId}; processed_orders=${orders ?? 'n/a'}`,
  );
}

async function burst(): Promise<void> {
  header(`Burst: ${BURST_COUNT} events submitted at once`);

  const statusTotal = async (status: string) =>
    (await api<EventList>(`/events?status=${status}&limit=1`)).total;

  const baseline = {
    completed: await statusTotal('completed'),
    failed: await statusTotal('failed'),
  };

  // 80% ok, 10% fail twice then succeed, 10% always fail.
  const simulateFor = (i: number) =>
    i % 10 === 0 ? 'always_fail' : i % 10 === 1 ? 'fail_then_succeed:2' : 'ok';

  const started = performance.now();

  const sent = await Promise.all(
    Array.from({ length: BURST_COUNT }, (_, i) =>
      sendEvent(`evt_burst_${RUN_ID}_${i}`, simulateFor(i)),
    ),
  );

  const ingestMs = performance.now() - started;
  const latencies = sent.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

  console.log(
    `ingested ${sent.filter((r) => r.status === 202).length}/${BURST_COUNT} (202) in ${(ingestMs / 1000).toFixed(2)}s | ` +
      `latency p50=${percentile(0.5).toFixed(0)}ms p95=${percentile(0.95).toFixed(0)}ms max=${latencies[latencies.length - 1].toFixed(0)}ms`,
  );

  // Stay responsive while workers drain the queue: sample /health.
  const healthSamples: number[] = [];
  const deadline = Date.now() + 240_000;
  let done = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const t = performance.now();

    await api('/health');
    healthSamples.push(performance.now() - t);

    done = (await statusTotal('completed')) - baseline.completed;
    failed = (await statusTotal('failed')) - baseline.failed;

    process.stdout.write(`\rcompleted=${done} failed=${failed} / ${BURST_COUNT}   `);

    if (done + failed >= BURST_COUNT) {
      break;
    }

    await sleep(1000);
  }

  console.log();

  const totalSeconds = (performance.now() - started) / 1000;
  const slowestHealth = Math.max(...healthSamples);
  const expectedFailed = Math.ceil(BURST_COUNT / 10);
  const orders = countOrders(`event_id LIKE 'evt_burst_${RUN_ID}_%'`);

  console.log(
    `all terminal after ${totalSeconds.toFixed(1)}s | slowest /health during processing: ${slowestHealth.toFixed(0)}ms | processed_orders: ${orders ?? 'n/a'}`,
  );

  verdict(
    'burst',
    done + failed === BURST_COUNT &&
      failed === expectedFailed &&
      (orders === null || orders === BURST_COUNT - expectedFailed),
    `completed=${done}, failed=${failed} (expected ${expectedFailed} always_fail), no event left non-terminal`,
  );
}

// ---------------------------------------------------------------------------

const scenarios: Record<string, () => Promise<void>> = {
  duplicate,
  'temporary-failure': temporaryFailure,
  'permanent-failure': permanentFailure,
  parallel,
  crash,
  burst,
};

async function main(): Promise<void> {
  const name = process.argv[2];

  const queue =
    name === 'all'
      ? ['duplicate', 'temporary-failure', 'permanent-failure', 'parallel']
      : name && name in scenarios
        ? [name]
        : [];

  if (queue.length === 0) {
    console.log(
      `Usage: node scripts/demo.ts <${[...Object.keys(scenarios), 'all'].join(' | ')}>`,
    );
    process.exit(1);
  }

  for (const scenario of queue) {
    await scenarios[scenario]();
  }

  console.log('--- summary ---');
  console.table(results.map((r) => ({ scenario: r.scenario, result: r.ok ? 'PASS' : 'FAIL' })));

  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
