'use client';

import { useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { ViewportChip } from '@/components/viewport-chip';
import { imageUrl, type Baseline, type BaselineTarget, type Viewport } from '@/lib/client';

function resolveViewport(target: BaselineTarget, viewports: Viewport[]): Viewport | undefined {
  return target.viewport ?? viewports.find((v) => v.id === target.viewportId);
}

function activeApprovedThumbnail(targets: BaselineTarget[]): string | null {
  for (const target of targets) {
    const version = (target.versions ?? []).find((v) => v.isActive && v.status === 'approved');
    if (version) return version.imagePath;
  }
  return null;
}

function UploadRow({
  baselineId,
  targets,
  viewports,
  onUpload,
}: {
  baselineId: string;
  targets: BaselineTarget[];
  viewports: Viewport[];
  onUpload: (baselineId: string, viewportId: string, bytes: Uint8Array) => void;
}) {
  const targetViewports = targets
    .map((t) => resolveViewport(t, viewports))
    .filter((v): v is Viewport => v !== undefined);
  const [viewportId, setViewportId] = useState<string>(targetViewports[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.png')) {
      setError('file must be a .png');
      return;
    }
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      onUpload(baselineId, viewportId, bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
  }

  if (targetViewports.length === 0) return null;

  return (
    <details className="border-t border-border">
      <summary className="cursor-pointer px-4 py-2 text-xs text-muted hover:text-text">Upload PNG</summary>
      <div className="flex flex-col gap-2 px-4 pb-3">
        <Select value={viewportId} onValueChange={setViewportId}>
          <SelectTrigger size="sm" aria-label="Viewport">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targetViewports.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="file"
          accept=".png,image/png"
          aria-label="Upload PNG file"
          onChange={handleFile}
          className="text-xs text-muted file:mr-2 file:rounded file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-xs"
        />
        {error && <p className="text-xs text-status-fail">{error}</p>}
      </div>
    </details>
  );
}

function BaselineCard({
  baseline,
  viewports,
  onUpload,
  onEdit,
  onDelete,
}: {
  baseline: Baseline;
  viewports: Viewport[];
  onUpload: (baselineId: string, viewportId: string, bytes: Uint8Array) => void;
  onEdit: (baseline: Baseline) => void;
  onDelete: (id: string) => void;
}) {
  const targets = baseline.targets ?? [];
  const thumbnailPath = activeApprovedThumbnail(targets);

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface">
      {thumbnailPath ? (
        <img
          src={imageUrl(thumbnailPath)}
          alt={`${baseline.name} baseline thumbnail`}
          className="h-32 w-full rounded-t-md border-b border-border object-cover object-top bg-surface-2"
        />
      ) : (
        <div className="flex h-32 w-full items-center justify-center rounded-t-md border-b border-border bg-surface-2 text-xs text-muted">
          no baseline yet
        </div>
      )}
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-sm font-semibold tracking-tight">{baseline.name}</h3>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${baseline.name}`} onClick={() => onEdit(baseline)}>
              <Pencil className="size-3" />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Delete ${baseline.name}`} onClick={() => onDelete(baseline.id)}>
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
        <p className="font-mono text-xs text-muted">{baseline.pagePath}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {baseline.elementSelector && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
              ⌖ {baseline.elementSelector}
            </span>
          )}
          {targets.map((target) => {
            const viewport = resolveViewport(target, viewports);
            return viewport ? <ViewportChip key={target.id} name={viewport.name} width={viewport.width} height={viewport.height} /> : null;
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{baseline.sourceType}</span>
          {baseline.syncStatus === 'sync-error' && <StatusBadge kind="version" value="sync-error" />}
        </div>
      </div>
      <UploadRow baselineId={baseline.id} targets={targets} viewports={viewports} onUpload={onUpload} />
    </div>
  );
}

export function BaselineGrid({
  baselines,
  viewports,
  onUpload,
  onEdit,
  onDelete,
}: {
  baselines: Baseline[];
  viewports: Viewport[];
  onUpload: (baselineId: string, viewportId: string, bytes: Uint8Array) => void;
  onEdit: (baseline: Baseline) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {baselines.map((baseline) => (
        <BaselineCard key={baseline.id} baseline={baseline} viewports={viewports} onUpload={onUpload} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
