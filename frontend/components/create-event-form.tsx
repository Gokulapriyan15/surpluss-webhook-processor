'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createWebhook } from '@/lib/api';
import type { CreateWebhookInput } from '@/lib/types';

type SimulateMode = 'ok' | 'fail_then_succeed' | 'always_fail' | 'slow' | 'custom';

const SIMULATE_OPTIONS: ReadonlyArray<{
  value: SimulateMode;
  label: string;
}> = [
  { value: 'ok', label: 'ok - succeeds immediately' },
  { value: 'fail_then_succeed', label: 'fail_then_succeed - fails N times, then succeeds' },
  { value: 'always_fail', label: 'always_fail - fails every attempt' },
  { value: 'slow', label: 'slow - takes N seconds, then succeeds' },
  { value: 'custom', label: 'custom value...' },
];

function buildSimulate(
  mode: SimulateMode,
  count: number,
  custom: string,
): string {
  switch (mode) {
    case 'fail_then_succeed':
      return `fail_then_succeed:${count}`;
    case 'slow':
      return `slow:${count}`;
    case 'custom':
      return custom.trim();
    default:
      return mode;
  }
}

const MAX_COPIES = 50;

function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

interface SubmitSummary {
  eventId: string;
  sent: number;
  accepted: number;
  newEvents: number;
  duplicates: number;
}

export function CreateEventForm() {
  const queryClient = useQueryClient();

  // Left empty on first render (a random ID at render time would differ
  // between server render and hydration); generated on submit if still empty.
  const [eventId, setEventId] = useState('');
  const [type, setType] = useState('order.created');
  const [orderId, setOrderId] = useState('ORD-1001');
  const [customerId, setCustomerId] = useState('CUS-42');
  const [simulateMode, setSimulateMode] = useState<SimulateMode>('ok');
  const [simulateCount, setSimulateCount] = useState(2);
  const [simulateCustom, setSimulateCustom] = useState('');
  const [copies, setCopies] = useState(1);

  const submit = useMutation({
    // Sends the same event `copies` times at once, which doubles as a
    // duplicate / concurrent-delivery demo when copies > 1.
    mutationFn: async (input: CreateWebhookInput): Promise<SubmitSummary> => {
      const results = await Promise.all(
        Array.from({ length: copies }, () => createWebhook(input)),
      );

      return {
        eventId: input.eventId,
        sent: copies,
        accepted: results.filter((result) => result.success).length,
        newEvents: results.filter((result) => !result.duplicate).length,
        duplicates: results.filter((result) => result.duplicate).length,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      // Cleared so the next submit gets a fresh ID; the sent one stays
      // visible in the summary.
      setEventId('');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const data: CreateWebhookInput['data'] = { orderId: orderId.trim() };

    if (customerId.trim()) {
      data.customerId = customerId.trim();
    }

    const simulate = buildSimulate(
      simulateMode,
      simulateCount,
      simulateCustom,
    );

    if (simulate) {
      data.simulate = simulate;
    }

    submit.mutate({
      eventId: eventId.trim() || newEventId(),
      type: type.trim(),
      data,
    });
  }

  const inputClass =
    'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900';

  return (
    <section
      aria-label="Create event"
      className="mt-6 rounded-xl bg-white p-6 shadow"
    >
      <h2 className="text-xl font-semibold text-gray-900">Create event</h2>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label
              htmlFor="event-id"
              className="mb-1 block text-sm text-gray-600"
            >
              Event ID
            </label>
            <div className="flex gap-2">
              <input
                id="event-id"
                maxLength={255}
                value={eventId}
                placeholder="auto-generated if empty"
                onChange={(event) => setEventId(event.target.value)}
                className={`${inputClass} font-mono`}
              />
              <button
                type="button"
                onClick={() => setEventId(newEventId())}
                className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              >
                New
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="event-type"
              className="mb-1 block text-sm text-gray-600"
            >
              Type
            </label>
            <input
              id="event-type"
              required
              maxLength={255}
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="simulate"
              className="mb-1 block text-sm text-gray-600"
            >
              Simulate
            </label>
            <select
              id="simulate"
              value={simulateMode}
              onChange={(event) =>
                setSimulateMode(event.target.value as SimulateMode)
              }
              className={inputClass}
            >
              {SIMULATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {(simulateMode === 'fail_then_succeed' ||
              simulateMode === 'slow') && (
              <div className="mt-2 flex items-center gap-2">
                <label
                  htmlFor="simulate-count"
                  className="text-sm text-gray-600"
                >
                  {simulateMode === 'slow' ? 'Seconds (N)' : 'Failures (N)'}
                </label>
                <input
                  id="simulate-count"
                  type="number"
                  min={0}
                  step={1}
                  value={simulateCount}
                  onChange={(event) =>
                    setSimulateCount(
                      Math.max(0, Math.floor(Number(event.target.value) || 0)),
                    )
                  }
                  className={`${inputClass} w-24`}
                />
              </div>
            )}

            {simulateMode === 'custom' && (
              <input
                aria-label="Custom simulate value"
                value={simulateCustom}
                onChange={(event) => setSimulateCustom(event.target.value)}
                placeholder="e.g. slow:45 or anything else"
                className={`${inputClass} mt-2 font-mono`}
              />
            )}

            <p className="mt-1 font-mono text-xs text-gray-500">
              sends: {buildSimulate(simulateMode, simulateCount, simulateCustom) || '(nothing)'}
            </p>
          </div>

          <div>
            <label
              htmlFor="order-id"
              className="mb-1 block text-sm text-gray-600"
            >
              Order ID
            </label>
            <input
              id="order-id"
              required
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="customer-id"
              className="mb-1 block text-sm text-gray-600"
            >
              Customer ID (optional)
            </label>
            <input
              id="customer-id"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="copies"
              className="mb-1 block text-sm text-gray-600"
            >
              Send simultaneously (duplicates test)
            </label>
            <input
              id="copies"
              type="number"
              min={1}
              max={MAX_COPIES}
              value={copies}
              onChange={(event) =>
                setCopies(
                  Math.min(
                    MAX_COPIES,
                    Math.max(1, Math.floor(Number(event.target.value) || 1)),
                  ),
                )
              }
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submit.isPending}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {submit.isPending ? 'Sending...' : 'Send event'}
          </button>

          {submit.isSuccess && (
            <p role="status" className="text-sm text-green-700">
              <span className="font-mono">{submit.data.eventId}</span>:{' '}
              {submit.data.accepted}/{submit.data.sent} accepted,{' '}
              {submit.data.newEvents} new, {submit.data.duplicates} duplicate
            </p>
          )}

          {submit.isError && (
            <p role="alert" className="text-sm text-red-600">
              {submit.error.message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
