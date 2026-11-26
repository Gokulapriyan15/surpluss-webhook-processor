'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchEvent, retryEvent } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';

import { StatusBadge } from './status-badge';

interface EventDetailProps {
  eventId: string;
  onClose: () => void;
}

export function EventDetail({ eventId, onClose }: EventDetailProps) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId),
    refetchInterval: 2000,
  });

  const retry = useMutation({
    mutationFn: () => retryEvent(eventId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  return (
    <section
      aria-label={`Details for ${eventId}`}
      className="mt-6 rounded-xl bg-white p-6 shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="break-all font-mono text-lg font-semibold text-gray-900">
          {eventId}
        </h2>

        <button
          type="button"
          onClick={onClose}
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
        >
          Close
        </button>
      </div>

      {isLoading && <p className="mt-4 text-gray-500">Loading...</p>}

      {error && (
        <p role="alert" className="mt-4 text-red-600">
          {error.message}
        </p>
      )}

      {data && (
        <div className="mt-4 space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-800 md:grid-cols-4">
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd>
                <StatusBadge value={data.status} />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Attempts</dt>
              <dd>
                {data.attempts} / {data.maxAttempts}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Locked by</dt>
              <dd>{data.lockedBy ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Next retry</dt>
              <dd>{formatDateTime(data.nextRetryAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Received</dt>
              <dd>{formatDateTime(data.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Business row</dt>
              <dd>
                {data.processedOrder
                  ? `${data.processedOrder.orderId} @ ${formatDateTime(data.processedOrder.processedAt)}`
                  : 'not written'}
              </dd>
            </div>
          </dl>

          {data.status === 'failed' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => retry.mutate()}
                disabled={retry.isPending}
                className="rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {retry.isPending ? 'Retrying...' : 'Retry event'}
              </button>

              {retry.error && (
                <span role="alert" className="text-sm text-red-600">
                  {retry.error.message}
                </span>
              )}
            </div>
          )}

          <div>
            <h3 className="mb-2 font-semibold text-gray-900">
              Processing history
            </h3>

            {data.attemptHistory.length === 0 ? (
              <p className="text-sm text-gray-500">No attempts yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-800">
                  <thead className="border-b border-gray-200 text-gray-500">
                    <tr>
                      <th className="py-2 pr-4">#</th>
                      <th className="py-2 pr-4">Worker</th>
                      <th className="py-2 pr-4">Started</th>
                      <th className="py-2 pr-4">Duration</th>
                      <th className="py-2 pr-4">Result</th>
                      <th className="py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attemptHistory.map((attempt) => (
                      <tr
                        key={attempt.attemptNumber}
                        className="border-b border-gray-100 align-top"
                      >
                        <td className="py-2 pr-4">{attempt.attemptNumber}</td>
                        <td className="py-2 pr-4 font-mono">
                          {attempt.workerId}
                        </td>
                        <td className="py-2 pr-4">
                          {formatDateTime(attempt.startedAt)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatDuration(attempt.startedAt, attempt.finishedAt)}
                        </td>
                        <td className="py-2 pr-4">
                          <StatusBadge value={attempt.result} />
                        </td>
                        <td className="py-2 text-red-700">
                          {attempt.error ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-semibold text-gray-900">Payload</h3>
            <pre className="overflow-x-auto rounded bg-gray-100 p-3 font-mono text-xs text-gray-800">
              {JSON.stringify(data.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
