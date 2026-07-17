const STATUS_COLOR: Record<string, string> = {
  pass: 'text-status-pass border-status-pass/40 bg-status-pass/10 status-pass',
  diff: 'text-status-diff border-status-diff/40 bg-status-diff/10 status-diff',
  fail: 'text-status-fail border-status-fail/40 bg-status-fail/10 status-fail',
  new: 'text-status-new border-status-new/40 bg-status-new/10 status-new',
  done: 'text-status-pass border-status-pass/40 bg-status-pass/10 status-pass',
  failed: 'text-status-fail border-status-fail/40 bg-status-fail/10 status-fail',
  running: 'text-status-new border-status-new/40 bg-status-new/10 status-new',
  pending: 'text-status-pending border-status-pending/40 bg-status-pending/10 status-pending',
  approved: 'text-status-pass border-status-pass/40 bg-status-pass/10 status-pass',
  rejected: 'text-status-fail border-status-fail/40 bg-status-fail/10 status-fail',
};

export function StatusBadge({ kind, value }: { kind: 'visual' | 'functional' | 'run' | 'version'; value: string }) {
  const color = STATUS_COLOR[value] ?? 'text-muted border-border bg-surface-2 muted';
  return (
    <span
      data-kind={kind}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs ${color}`}
    >
      {value}
    </span>
  );
}
