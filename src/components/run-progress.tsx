import { StatusBadge } from '@/components/status-badge';
import type { RunDetail } from '@/lib/client';

export function RunProgress({
  run,
  expectedCount,
  completedCount,
}: {
  run: RunDetail;
  expectedCount: number | null;
  completedCount: number;
}) {
  const isActive = run.status === 'queued' || run.status === 'running';
  const pct = expectedCount && expectedCount > 0 ? Math.min(100, Math.round((completedCount / expectedCount) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <StatusBadge kind="run" value={run.status} />
        <span className="font-mono text-xs text-muted">
          {expectedCount !== null ? (
            `${completedCount}/${expectedCount}`
          ) : (
            `${completedCount} result${completedCount === 1 ? '' : 's'}`
          )}
        </span>
      </div>
      {isActive && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          {expectedCount !== null ? (
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          ) : (
            // Total is unknown until the run is terminal (see page.tsx) — show
            // an indeterminate pulse instead of a fake fractional width.
            // `animate-pulse` is neutralized under prefers-reduced-motion by
            // the global rule in globals.css (forces animation-duration to
            // 0.01ms), so no extra guard is needed here.
            <div className="h-full w-full bg-accent animate-pulse" data-testid="run-progress-indeterminate" />
          )}
        </div>
      )}
    </div>
  );
}
