export function ViewportChip({ name, width, height }: { name: string; width: number; height: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
      {name}
      <span className="text-text">
        {width}×{height}
      </span>
    </span>
  );
}
