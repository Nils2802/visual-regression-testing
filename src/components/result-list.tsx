import { StatusBadge } from '@/components/status-badge';
import { ViewportChip } from '@/components/viewport-chip';
import type { RunResult, Viewport } from '@/lib/client';

export type StatusFilter = 'all' | 'visual-fail' | 'functional-fail' | 'pass';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'all' },
  { value: 'visual-fail', label: 'visual fail' },
  { value: 'functional-fail', label: 'functional fail' },
  { value: 'pass', label: 'pass' },
];

function isVisualFail(r: RunResult): boolean {
  return r.visualStatus === 'diff' || r.visualStatus === 'fail';
}

function isFunctionalFail(r: RunResult): boolean {
  return r.functionalStatus === 'fail';
}

function isFullyPassing(r: RunResult): boolean {
  const visualOk = r.visualStatus === 'pass' || r.visualStatus === 'new';
  const functionalOk = r.functionalStatus === 'pass' || r.functionalStatus === null;
  return visualOk && functionalOk;
}

function matchesStatusFilter(r: RunResult, filter: StatusFilter): boolean {
  switch (filter) {
    case 'visual-fail':
      return isVisualFail(r);
    case 'functional-fail':
      return isFunctionalFail(r);
    case 'pass':
      return isFullyPassing(r);
    default:
      return true;
  }
}

function nonIgnoredTestLogCount(r: RunResult): number {
  return r.logEntries.filter((l) => l.origin === 'test' && !l.ignored).length;
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function ResultRow({
  result,
  selected,
  onSelect,
}: {
  result: RunResult;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const logCount = nonIgnoredTestLogCount(result);

  return (
    <button
      type="button"
      data-testid={`result-row-${result.id}`}
      aria-pressed={selected}
      onClick={() => onSelect(result.id)}
      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
        selected ? 'border-accent bg-surface-2' : 'border-border bg-surface hover:border-muted'
      }`}
    >
      <div className="flex items-center gap-2">
        <ViewportChip name={result.viewport.name} width={result.viewport.width} height={result.viewport.height} />
        {result.sizeMismatch && (
          <span title="size mismatch" className="text-status-fail">
            ⚠
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {result.diffRatio !== null && <span className="font-mono text-xs text-muted">{result.diffRatio.toFixed(4)}</span>}
        {logCount > 0 && (
          <span className="font-mono text-xs text-muted">
            {logCount} log{logCount === 1 ? '' : 's'}
          </span>
        )}
        {result.visualStatus && <StatusBadge kind="visual" value={result.visualStatus} />}
        {result.functionalStatus && <StatusBadge kind="functional" value={result.functionalStatus} />}
      </div>
    </button>
  );
}

export function ResultList({
  results,
  selectedId,
  onSelect,
  statusFilter,
  onFilterChange,
  viewportFilter,
  onViewportFilterChange,
  viewports,
}: {
  results: RunResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
  viewportFilter: string | null;
  onViewportFilterChange: (viewportId: string | null) => void;
  viewports: Viewport[];
}) {
  const filtered = results.filter(
    (r) => matchesStatusFilter(r, statusFilter) && (viewportFilter === null || r.viewportId === viewportFilter)
  );

  const groups = new Map<string, RunResult[]>();
  for (const r of filtered) {
    const key = r.baseline.name;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status filter">
          {STATUS_FILTERS.map((f) => (
            <Pill key={f.value} active={statusFilter === f.value} onClick={() => onFilterChange(f.value)}>
              {f.label}
            </Pill>
          ))}
        </div>
        {viewports.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Viewport filter">
            <Pill active={viewportFilter === null} onClick={() => onViewportFilterChange(null)}>
              all viewports
            </Pill>
            {viewports.map((v) => (
              <Pill key={v.id} active={viewportFilter === v.id} onClick={() => onViewportFilterChange(v.id)}>
                {v.name}
              </Pill>
            ))}
          </div>
        )}
      </div>

      {groups.size === 0 ? (
        <p className="text-sm text-muted">No results match the current filters.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {[...groups.entries()].map(([name, rows]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <h3 className="font-display text-sm font-semibold tracking-tight">{name}</h3>
              <div className="flex flex-col gap-1.5">
                {rows.map((r) => (
                  <ResultRow key={r.id} result={r} selected={r.id === selectedId} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
