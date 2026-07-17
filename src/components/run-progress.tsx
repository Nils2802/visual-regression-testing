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
        {expectedCount !== null && (
          <span className="font-mono text-xs text-muted">
            {completedCount}/{expectedCount}
          </span>
        )}
      </div>
      {isActive && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
