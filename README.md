# Reliable Webhook Processor

NestJS + PostgreSQL + Next.js, all TypeScript. Webhooks are persisted first and processed later by
background workers that survive duplicates, temporary failures and crashes.

## Quick start

```bash
docker compose up --build
```

Starts, in order: `postgres` → `migrate` (one-shot) → `api`, `worker-1`, `worker-2`, `frontend`.
No other setup is needed.

| What | URL |
|---|---|
| Operations page | http://localhost:3000 |
| API | http://localhost:3001/api |

Ports `3000`, `3001`, `5432` must be free. Override with `FRONTEND_PORT`, `API_PORT` (if you change
`API_PORT`, also set `NEXT_PUBLIC_API_URL` and `CORS_ORIGIN`). More workers: copy the `worker-2`
block in `docker-compose.yml` as `worker-3`.

Reset all data: `docker compose down -v`.

### Send an event

```bash
curl -i -X POST http://localhost:3001/api/webhooks -H "Content-Type: application/json" -d '{
  "eventId": "evt_123",
  "type": "order.created",
  "data": { "orderId": "ORD-1001", "customerId": "CUS-42", "simulate": "fail_then_succeed:2" }
}'
```

`simulate` (inside `data`): `ok` (default) · `fail_then_succeed:N` · `always_fail` · `slow:N`.

### API

| Method & path | Purpose |
|---|---|
| `POST /api/webhooks` | Ingest. Always `202` (new or duplicate); body has `duplicate: true/false`. |
| `GET /api/events?status=&limit=&offset=` | List events (state, attempts, last error). |
| `GET /api/events/:eventId` | One event: payload, `processed_orders` row, full attempt history. |
| `POST /api/events/:eventId/retry` | Manual retry of a `failed` event (`202`; `409` if not failed; `404` if unknown). |
| `GET /api/health` | Liveness. |

## Demonstration scenarios

Requires Node ≥ 22.18 on the host (runs the TypeScript script natively) and the stack running.

```bash
cd backend
npm run demo:duplicate           # same eventId x20 simultaneously -> 1 processed_orders row
npm run demo:temporary-failure   # fail_then_succeed:2 -> failed, failed, success
npm run demo:permanent-failure   # always_fail -> stops at max attempts, stays failed
npm run demo:parallel            # 6 x slow:5 -> shared by both workers, ~15s instead of 30s
npm run demo:crash               # docker kill the worker holding a slow:20 event -> other recovers it
npm run demo:burst               # 500 events at once -> all reach completed/failed, API stays fast
npm run demo:all                 # first four
```

Each prints the attempt history and a `PASS`/`FAIL` verdict (including a `processed_orders` count
read from Postgres). Last run on my machine: all six pass; burst reached a terminal state for all
500 events in ~20s with `/health` never above 4 ms while workers drained the queue.

Manual check of the business table:

```bash
docker exec -it surpluss-postgres psql -U postgres -d webhook_processor \
  -c "SELECT event_id, count(*) FROM processed_orders GROUP BY 1 HAVING count(*) > 1;"   # must be empty
```

## Tests

```bash
cd backend && npm test      # needs the postgres container running
```

25 integration tests against a real Postgres (own `webhook_processor_test` database, created and
migrated automatically; it never touches your data). Covered: 50 simultaneous duplicate
deliveries, 4 workers draining a queue without double claims, concurrent completions writing one
`processed_orders` row, retries/backoff/cap, crash recovery (including a zombie worker and a crash
on the final attempt), and manual retry races.

## Architecture

```
            POST /webhooks                       poll (1s)
 sender ───────────────────▶  API  ──insert──▶ ┌───────────────┐ ◀────────── worker-1
                              (202)            │ webhook_events │ ◀────────── worker-2   (N workers)
                                               │ processing_    │
 browser ◀── Next.js ◀── GET /events ◀──────── │   attempts     │
                                               │ processed_     │
                                               │   orders       │
                                               └───────────────┘
```

PostgreSQL is both the system of record and the queue.

**Ingestion.** `INSERT … ON CONFLICT (event_id) DO NOTHING` on a `UNIQUE` column. The row is
committed before `202` is returned. A repeated `eventId` is acknowledged but changes nothing, so the
first payload always wins, even with simultaneous deliveries.

**Event states.** `pending → processing → completed`, or `processing → retrying → processing …`, or
`→ failed` when attempts are used up. `failed` can be revived by manual retry.

**Claiming.** Each worker loops: *sweep exhausted events → claim one → process*. Claiming is one SQL
statement: `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` inside a CTE, then `UPDATE` to
`processing` with `attempts + 1`, `locked_by`, a 30 s `lease_until` and a fresh random `lease_token`.
The same statement inserts the attempt record. Workers never wait on each other and cannot claim the
same row.

**Leases and heartbeat.** While processing, a worker extends its lease every `max(1s, lease/3)`
with `WHERE locked_by = me AND lease_token = mine`. A `slow:N` event longer than the lease therefore
keeps its lease as long as the worker is alive. If a worker dies, the lease expires and any worker
may claim the event.

**Completion (the exactly-once part).** In one transaction: lock the event row (`FOR UPDATE`,
requiring `status='processing'` and the worker's id *and* token), insert into `processed_orders`
(`event_id UNIQUE`, `ON CONFLICT DO NOTHING`), close the attempt as `success`, mark the event
`completed`. The business row and the state change commit together or not at all. The token acts
as a fencing token: a worker that lost its lease cannot complete the event.

**Retries.** On failure the event becomes `retrying` with `next_retry_at = now + min(2^(attempt-1), 60)s`
(1, 2, 4, 8 … capped at 60 s). When `attempts >= max_attempts` (`MAX_ATTEMPTS`, default 5) it becomes
`failed` and is never claimed again. The failure transition and the attempt record are one statement.

**Crash recovery.** A claim of an expired `processing` event closes the dead attempt as `failed`
(*"Lease expired…"*) and opens the next one. Events are only claimable while `attempts < max_attempts`,
so a worker that dies on its final attempt would leave the event stuck; each loop therefore also runs a
sweep that moves expired-lease, out-of-attempts events to `failed`.

**Manual retry.** One conditional `UPDATE … WHERE status='failed'` sets `max_attempts = attempts + MAX_ATTEMPTS`
and `status='pending'`. `attempts` is never reset, so attempt numbers keep increasing; concurrent
retry requests produce exactly one winner.

**Processes.** One backend image, three roles chosen by `command`: API (`dist/main`, no worker),
worker (`dist/worker`, no HTTP server, one container each with its own `WORKER_ID`), and `migrate`
(`dist/database/run-migrations`, exits before the others start).

## Libraries

| Library | Why |
|---|---|
| NestJS 12 | Required; modules/DI keep API, worker and events code separate and testable. |
| TypeORM + `pg` | Connection pool, entities and versioned migrations. The queue-critical queries are hand-written SQL because `FOR UPDATE SKIP LOCKED` + CTEs are clearer and safer than query-builder equivalents. |
| class-validator / class-transformer | Declarative request validation (`whitelist`, `forbidNonWhitelisted`). |
| Jest + supertest | Integration tests against real Postgres; mocks cannot prove locking behaviour. |
| Next.js 16 + React 19 | Required. |
| TanStack Query | Polling, caching and mutations for the operations page. |
| Tailwind CSS | Minimal styling (not graded). |

## Correctness guarantees

I believe the following hold, and each is exercised by a test or demo:

1. **A delivered webhook is never lost after `202`**: it is committed before the response.
2. **Duplicate deliveries, however concurrent, create one event and one `processed_orders` row**: unique
   constraints, not application checks, enforce this (`ingestion.spec`, `demo:duplicate`).
3. **No two workers process the same event at the same time**: `FOR UPDATE SKIP LOCKED` at claim time, and
   the lease token at completion (`worker-claiming.spec`).
4. **`processed_orders` has at most one row per event even across crashes**: the row is written in the same
   transaction as the completion, and has its own unique constraint; a crash can leave either both or neither
   (`exactly-once.spec`, `retries-and-recovery.spec`).
5. **A crashed worker's event is recovered** after at most about one lease (30 s) plus a poll interval, including
   when it died on the last attempt (`demo:crash`, `retries-and-recovery.spec`).
6. **Retries are bounded**: after `max_attempts` the event is `failed` and no further attempts occur.
7. **Every attempt is recorded** with worker, start, finish, result and error; abandoned attempts are closed
   as failed rather than left "running".

## Known limitations

- **External side effects are at-least-once.** The "business action" here is a database row, so it is atomic
  with completion. If the action were an email or an HTTP call, a worker could perform it and die before the
  completion transaction, and the recovering worker would perform it again. Real side effects need a downstream
  idempotency key (the `eventId` would serve).
- **A stalled worker can be overtaken while still executing.** The heartbeat runs on the same Node event loop. If a
  worker is paused for longer than the lease (stop-the-world pause, blocked loop, lost DB connection), another
  worker reclaims the event while the first is still running. The first is then rejected at completion
  (token mismatch), so no duplicate row, but any non-database work it did in the meantime is duplicated.
- **Lease loss is only noticed at the next heartbeat or at completion**, not mid-computation; the stale worker
  keeps running until then.
- **A crashed attempt consumes retry budget.** A worker that keeps dying (e.g. out-of-memory on one payload) burns
  attempts without any failure being recorded by the code, and the event ends `failed` after `max_attempts` crashes.
  That is the intended poison-pill behaviour, but it also means unlucky infrastructure crashes count.
- **Recovery latency.** A killed worker's event waits for the full lease (30 s) before another worker can take it;
  shorter leases recover faster but make false takeovers more likely under load.
- **`failed` after a final-attempt crash needs a live worker.** The sweep runs inside the worker loop; if every
  worker is down, such events stay `processing` until one starts.
- **Polling, not push.** Idle workers query every second (two queries per loop); pickup latency is up to 1 s and
  cost grows with worker count. There is no `LISTEN/NOTIFY`.
- **No ordering guarantees.** Events are claimed roughly oldest-first, but with several workers and retries two
  events for the same order can finish out of order. Only `eventId` is deduplicated; the same `orderId` under a
  different `eventId` is processed twice, by design of the brief.
- **Shutdown is abrupt.** `SIGTERM` stops the polling loop but does not wait for an in-flight event; it is recovered
  by lease expiry.
- **Operations page is basic**: polls every 2 s, shows at most the 100 most recent events, no pagination UI.
- **Unsupported `simulate` values** (e.g. `banana`) are treated as processing failures and retried to the cap
  rather than rejected at ingestion. `fail_then_succeed:N` counts attempt numbers across manual retries too.
- No authentication or rate limiting on any endpoint (out of scope per the brief).

## Decisions

- **PostgreSQL-backed workers instead of Redis/BullMQ.** The business row and the "completed" state must change
  atomically, which is trivial inside one database transaction and impossible across Postgres and Redis without
  an outbox or compensation. One datastore also means fewer failure modes and a simpler `docker compose up`. The
  cost is throughput ceiling and polling; fine for this scale, and the schema would port to a queue later.
- **Lease + token (fencing) rather than a long row lock.** Holding a transaction open for the whole processing time
  would pin a connection per event and break on crashes in confusing ways. A lease survives crashes by expiring.
- **Heartbeat instead of a huge lease.** `slow:N` above the lease timeout must work, but a very long lease would make
  crash recovery slow. Heartbeats give both.
- **Crashed attempts count toward `max_attempts`.** Bounds the damage of a payload that kills workers.
- **`202` for duplicates, first payload wins**, as specified, with `duplicate` in the body for observability.
- **Manual retry budget = `attempts + MAX_ATTEMPTS`**: a fresh budget, with attempt numbers continuing.
- **Backoff: 2^(n-1) s capped at 60 s**, deterministic (no jitter) to keep behaviour easy to verify.
- **`simulate` semantics**: `fail_then_succeed:N` fails while `attempt_number <= N`, regardless of which worker runs it;
  `slow:N` sleeps N seconds (chunked, so huge values do not overflow timers) while the heartbeat runs.
- **Raw SQL for the queue, ORM for everything else**, so the concurrency-critical statements are visible in one place.
- **One image for API/worker/migrate**, so what the tests exercise is what runs in every container.

## What I'd do next

1. **Idempotency keys for real side effects / an outbox**: it closes the largest correctness gap (at-least-once external
   actions). First because everything else is secondary if the real action can run twice.
2. **Observability**: structured logs with `eventId`/`workerId`, queue depth and oldest-pending-age metrics, alerts on
   `failed` events. Without these, the limitations above are invisible in production.
3. **Jittered backoff and per-event/per-type retry policies**, plus a dead-letter view with bulk retry.
4. **`LISTEN/NOTIFY` to wake idle workers**, reducing latency and idle load; keep polling as a fallback.
5. **Graceful shutdown that drains in-flight events**, and a lease-lost signal that actually aborts processing.
6. **Load test with more workers and payloads** to find where Postgres-as-queue stops being enough, and decide on
   partitioning or a real broker then.
