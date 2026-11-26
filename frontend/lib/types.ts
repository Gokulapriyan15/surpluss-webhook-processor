export type EventStatus =
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'completed'
  | 'failed';

export const EVENT_STATUSES: readonly EventStatus[] = [
  'pending',
  'processing',
  'retrying',
  'completed',
  'failed',
];

export interface EventSummary {
  eventId: string;
  type: string;
  status: EventStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lockedBy: string | null;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  processed: boolean;
}

export interface EventListResponse {
  total: number;
  limit: number;
  offset: number;
  items: EventSummary[];
}

export interface AttemptRecord {
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  finishedAt: string | null;
  result: 'running' | 'success' | 'failed';
  error: string | null;
}

export interface EventDetail extends EventSummary {
  payload: Record<string, unknown>;
  processedOrder: { orderId: string; processedAt: string } | null;
  attemptHistory: AttemptRecord[];
}

export interface RetryResponse {
  success: boolean;
  message: string;
  eventId: string;
  attempts: number;
  maxAttempts: number;
}

export interface CreateWebhookInput {
  eventId: string;
  type: string;
  data: {
    orderId: string;
    customerId?: string;
    simulate?: string;
  };
}

export interface CreateWebhookResponse {
  success: boolean;
  message: string;
  eventId: string;
  duplicate: boolean;
}

export interface HealthResponse {
  status: string;
  message: string;
  service: string;
  timestamp: string;
}
