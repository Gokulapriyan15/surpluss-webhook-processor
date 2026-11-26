import type {
  CreateWebhookInput,
  CreateWebhookResponse,
  EventDetail,
  EventListResponse,
  EventStatus,
  HealthResponse,
  RetryResponse,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface ApiErrorBody {
  message?: string | string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.message) {
        message = Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message;
      }
    } catch {
      // Non-JSON error body: keep the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export function fetchEvents(
  status: EventStatus | 'all',
  limit: number,
): Promise<EventListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });

  if (status !== 'all') {
    params.set('status', status);
  }

  return request<EventListResponse>(`/events?${params.toString()}`);
}

export function fetchEvent(eventId: string): Promise<EventDetail> {
  return request<EventDetail>(`/events/${encodeURIComponent(eventId)}`);
}

export function createWebhook(
  input: CreateWebhookInput,
): Promise<CreateWebhookResponse> {
  return request<CreateWebhookResponse>('/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function retryEvent(eventId: string): Promise<RetryResponse> {
  return request<RetryResponse>(
    `/events/${encodeURIComponent(eventId)}/retry`,
    { method: 'POST' },
  );
}
