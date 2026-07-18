'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, runEventsUrl, type RunDetail, type Viewport } from '@/lib/client';
import { RunProgress } from '@/components/run-progress';
import { ResultList, type StatusFilter } from '@/components/result-list';
import { ComparisonViewer } from '@/components/comparison-viewer';
import { LogPanel } from '@/components/log-panel';
import { Button } from '@/components/ui/button';
import { useLoad } from '@/lib/use-load';

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewportFilter, setViewportFilter] = useState<string | null>(null);

  const fetchRun = useCallback(() => api.runs.get(runId), [runId]);
  const { data: run, error, reload } = useLoad<RunDetail>(fetchRun);

  // While the run is in flight, open an SSE connection and refetch the run on
  // every `result`/terminal `status` event. Progress counts are derived from
  // the refetched `run.results` below rather than incremented locally: each
  // result row exists in the DB before it's processed (see runner.ts), so a
  // client-side counter would drift on missed/duplicate events or on this
  // effect's queued->running teardown/reopen — recomputing from the fetched
  // data is always correct.
  useEffect(() => {
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
    const es = new EventSource(runEventsUrl(run.id));
    es.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as { type: string; status?: string };
      if (event.type === 'result') {
        reload();
      } else if (event.type === 'status') {
        if (event.status === 'done' || event.status === 'failed') {
          es.close();
        }
        reload();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [run?.id, run?.status, reload]);

  const viewports = useMemo(() => {
    if (!run) return [];
    const map = new Map<string, Viewport>();
    for (const r of run.results) {
      if (!map.has(r.viewportId)) map.set(r.viewportId, r.viewport);
    }
    return [...map.values()];
  }, [run]);

  // The runner persists the eligible baseline×viewport pair count up front
  // (see runner.ts) and emits the `running` status event only after that
  // persist, so the running-triggered reload sees the real total.
  // Pre-migration runs have a null `expectedResultCount`; for those, fall back
  // to `results.length` once the run is terminal (rows are created lazily, so
  // mid-run `results.length` is just "how many have started so far" — not a
  // valid denominator) and show an indeterminate count until then.
  const expectedCount = run
    ? run.expectedResultCount ??
      (run.status === 'done' || run.status === 'failed' ? run.results.length : null)
    : null;
  const completedCount = run ? run.results.filter((r) => r.visualStatus !== null).length : 0;
  const selectedResult = run?.results.find((r) => r.id === selectedId) ?? null;

  if (!run) {
    return (
      <div className="mx-auto max-w-6xl">
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-status-fail">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/projects/${run.projectId}`} className="text-sm text-muted hover:text-text">
          ← project
        </Link>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {run.type} run — {run.environment.name}
            </h1>
            <span className="font-mono text-xs text-muted">{new Date(run.createdAt).toLocaleString()}</span>
          </div>
          <RunProgress run={run} expectedCount={expectedCount} completedCount={completedCount} />
        </div>
      </div>

      {error && <p className="text-sm text-status-fail">{error}</p>}

      {run.type === 'compare' && (
        <p className="text-xs text-muted">reference (live) left — test (dev) right</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ResultList
          results={run.results}
          selectedId={selectedId}
          onSelect={setSelectedId}
          statusFilter={statusFilter}
          onFilterChange={setStatusFilter}
          viewportFilter={viewportFilter}
          onViewportFilterChange={setViewportFilter}
          viewports={viewports}
        />

        <div className="flex flex-col gap-4">
          {selectedResult ? (
            <>
              <ComparisonViewer result={selectedResult} runType={run.type} onPromoted={reload} />
              <LogPanel entries={selectedResult.logEntries} onIgnored={reload} />
            </>
          ) : (
            <p className="text-sm text-muted">Select a result to preview.</p>
          )}
        </div>
      </div>
    </div>
  );
}
