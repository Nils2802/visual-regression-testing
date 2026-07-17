'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiClientError, runEventsUrl, type RunDetail, type Viewport } from '@/lib/client';
import { RunProgress } from '@/components/run-progress';
import { ResultList, type StatusFilter } from '@/components/result-list';
import { ComparisonViewer } from '@/components/comparison-viewer';

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewportFilter, setViewportFilter] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.runs
      .get(runId)
      .then((r) => {
        setRun(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'failed to load'));
  }, [runId]);

  useEffect(reload, [reload]);

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
      } else if (event.type === 'status' && (event.status === 'done' || event.status === 'failed')) {
        es.close();
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

  // The true total is only known once the run reaches a terminal state: rows
  // are created lazily, one per baseline×viewport pair immediately before it
  // is processed (see runner.ts), so `results.length` while queued/running is
  // just "how many have started so far" — not a valid denominator. Show it as
  // an indeterminate count until then instead of a misleading N/N-ish ratio.
  const expectedCount = run && (run.status === 'done' || run.status === 'failed') ? run.results.length : null;
  const completedCount = run ? run.results.filter((r) => r.visualStatus !== null).length : 0;
  const selectedResult = run?.results.find((r) => r.id === selectedId) ?? null;

  if (!run) {
    return (
      <div className="mx-auto max-w-6xl">
        {error ? <p className="text-sm text-status-fail">{error}</p> : <p className="text-sm text-muted">Loading…</p>}
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

        <div className="flex flex-col gap-2">
          {selectedResult ? (
            <ComparisonViewer key={selectedResult.id} result={selectedResult} runType={run.type} onPromoted={reload} />
          ) : (
            <p className="text-sm text-muted">Select a result to preview.</p>
          )}
        </div>
      </div>
    </div>
  );
}
