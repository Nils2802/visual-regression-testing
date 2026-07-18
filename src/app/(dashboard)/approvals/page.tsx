'use client';

import { useCallback, useState } from 'react';
import { ViewportChip } from '@/components/viewport-chip';
import { Button } from '@/components/ui/button';
import { api, ApiClientError, imageUrl, type PendingVersion } from '@/lib/client';
import { useLoad } from '@/lib/use-load';

function ApprovalRow({ version, onDone }: { version: PendingVersion; onDone: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function act(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    const fn = action === 'approve' ? api.versions.approve : api.versions.reject;
    fn(version.id)
      .then(() => onDone())
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'something went wrong'))
      .finally(() => setBusy(null));
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-3">
        <img
          src={imageUrl(version.imagePath)}
          alt={`${version.target.baseline.name} pending version`}
          className="h-16 w-16 shrink-0 rounded border border-border bg-surface-2 object-cover"
        />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{version.target.baseline.name}</span>
            <ViewportChip
              name={version.target.viewport.name}
              width={version.target.viewport.width}
              height={version.target.viewport.height}
            />
          </div>
          <span className="font-mono text-xs text-muted">{new Date(version.createdAt).toLocaleString()}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => act('approve')}>
            Approve
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => act('reject')}>
            Reject
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-status-fail">{error}</p>}
    </div>
  );
}

export default function ApprovalsPage() {
  const fetchPending = useCallback(() => api.versions.pending().then((r) => r.versions), []);
  const { data: versions, error, reload } = useLoad<PendingVersion[]>(fetchPending);

  const groups = new Map<string, PendingVersion[]>();
  for (const v of versions ?? []) {
    const key = v.target.baseline.project.name;
    const list = groups.get(key);
    if (list) list.push(v);
    else groups.set(key, [v]);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Approvals</h1>

      {error &&
        (versions === null ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-status-fail">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : (
          <p className="text-sm text-status-fail">{error}</p>
        ))}

      {versions && versions.length === 0 && (
        <p className="text-sm text-muted">Nothing pending — approved baselines are up to date.</p>
      )}

      <div className="flex flex-col gap-6">
        {[...groups.entries()].map(([name, list]) => (
          <div key={name} className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-semibold tracking-tight">{name}</h2>
            <div className="flex flex-col gap-2">
              {list.map((v) => (
                <ApprovalRow key={v.id} version={v} onDone={reload} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
