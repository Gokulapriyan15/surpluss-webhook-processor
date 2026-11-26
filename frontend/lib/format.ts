export function formatDateTime(value: string | null): string {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString();
}

export function formatDuration(
  startedAt: string,
  finishedAt: string | null,
): string {
  if (!finishedAt) {
    return '-';
  }

  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
