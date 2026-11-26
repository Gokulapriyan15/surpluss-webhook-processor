'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchEvents, fetchHealth } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { EVENT_STATUSES, type EventStatus } from '@/lib/types';

import { CreateEventForm } from './create-event-form';
import { EventDetail } from './event-detail';
import { StatusBadge } from './status-badge';

const PAGE_SIZE = 100;

export function EventsDashboard() {
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  const events = useQuery({
    queryKey: ['events', statusFilter],
    queryFn: () => fetchEvents(statusFilter, PAGE_SIZE),
    refetchInterval: 2000,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Surpluss Webhook Processor
          </h1>
          <p className="mt-1 text-gray-600">Operations page</p>
        </div>

        <p
          className={`text-sm font-semibold ${
            health.isError ? 'text-red-600' : 'text-green-700'
          }`}
        >
          Backend:{' '}
          {health.isPending
            ? 'checking...'
            : health.isError
              ? 'unreachable'
              : 'connected'}
        </p>
      </header>

      <CreateEventForm />

      <section
        aria-label="Received events"
        className="mt-6 rounded-xl bg-white p-6 shadow"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Events
            {events.data && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                {events.data.items.length} of {events.data.total}
              </span>
            )}
          </h2>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            Status
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as EventStatus | 'all')
              }
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              <option value="all">all</option>
              {EVENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        {events.isPending && (
          <p className="mt-4 text-gray-500">Loading events...</p>
        )}

        {events.isError && (
          <p role="alert" className="mt-4 text-red-600">
            Unable to load events: {events.error.message}
          </p>
        )}

        {events.data && events.data.items.length === 0 && (
          <p className="mt-4 text-gray-500">No events found.</p>
        )}

        {events.data && events.data.items.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-800">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th className="py-2 pr-4">Event ID</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Attempts</th>
                  <th className="py-2 pr-4">Worker</th>
                  <th className="py-2 pr-4">Received</th>
                  <th className="py-2 pr-4">Last error</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {events.data.items.map((item) => (
                  <tr
                    key={item.eventId}
                    className={`border-b border-gray-100 align-top ${
                      item.eventId === selectedEventId ? 'bg-gray-50' : ''
                    }`}
                  >
                    <td className="py-2 pr-4 font-mono">{item.eventId}</td>
                    <td className="py-2 pr-4">{item.type}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge value={item.status} />
                      {item.status === 'retrying' && item.nextRetryAt && (
                        <div className="mt-1 text-xs text-gray-500">
                          next: {formatDateTime(item.nextRetryAt)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {item.attempts} / {item.maxAttempts}
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {item.lockedBy ?? '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="max-w-xs break-words py-2 pr-4 text-red-700">
                      {item.lastError ?? ''}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedEventId(item.eventId)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedEventId && (
        <EventDetail
          key={selectedEventId}
          eventId={selectedEventId}
          onClose={() => setSelectedEventId(null)}
        />
      )}
    </div>
  );
}
