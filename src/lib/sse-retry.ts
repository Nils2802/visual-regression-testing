// Capped exponential backoff for manual EventSource re-creation after a
// fatal close (readyState CLOSED — the browser only auto-retries while
// readyState is CONNECTING).
export function nextRetryDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}
