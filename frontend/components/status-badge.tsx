import type { EventStatus } from '@/lib/types';

const STATUS_STYLES: Record<EventStatus | 'running' | 'success', string> = {
  pending: 'bg-gray-200 text-gray-800',
  processing: 'bg-blue-100 text-blue-800',
  retrying: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
};

export function StatusBadge({
  value,
}: {
  value: EventStatus | 'running' | 'success';
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[value]}`}
    >
      {value}
    </span>
  );
}
