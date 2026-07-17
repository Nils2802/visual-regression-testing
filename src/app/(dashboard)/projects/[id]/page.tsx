'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiClientError, type Baseline, type ProjectDetail } from '@/lib/client';
import { BaselineGrid } from '@/components/baseline-grid';
import { BaselineDialog, type BaselineFormValues } from '@/components/baseline-dialog';
import { Button } from '@/components/ui/button';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBaseline, setEditingBaseline] = useState<Baseline | null>(null);

  const load = useCallback(() => {
    api.projects
      .get(projectId)
      .then((p) => {
        setProject(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'failed to load'));
  }, [projectId]);

  useEffect(load, [load]);

  const handleError = useCallback((e: unknown) => {
    setError(e instanceof ApiClientError ? e.message : 'something went wrong');
  }, []);

  const createBaseline = useCallback(
    (values: BaselineFormValues) => {
      api.baselines.create(projectId, values).then(load).catch(handleError);
    },
    [projectId, load, handleError]
  );

  const updateBaseline = useCallback(
    (values: BaselineFormValues) => {
      if (!editingBaseline) return;
      api.baselines
        .update(editingBaseline.id, {
          name: values.name,
          pagePath: values.pagePath,
          elementSelector: values.elementSelector ?? null,
          diffThreshold: values.diffThreshold ?? null,
          maskSelectors: values.maskSelectors ?? [],
        })
        .then(load)
        .catch(handleError);
    },
    [editingBaseline, load, handleError]
  );

  const deleteBaseline = useCallback(
    (id: string) => {
      api.baselines.delete(id).then(load).catch(handleError);
    },
    [load, handleError]
  );

  const uploadVersion = useCallback(
    (baselineId: string, viewportId: string, bytes: Uint8Array) => {
      api.baselines.uploadVersion(baselineId, viewportId, bytes).then(load).catch(handleError);
    },
    [load, handleError]
  );

  if (!project) {
    return (
      <div className="mx-auto max-w-5xl">
        {error ? <p className="text-sm text-status-fail">{error}</p> : <p className="text-sm text-muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h1>
        <div className="flex items-center gap-2">
          {/* Task 7: RunNowDialog mounts here */}
          <Link href={`/projects/${project.id}/settings`}>
            <Button variant="outline">Settings</Button>
          </Link>
          <BaselineDialog
            viewports={project.viewports}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onSubmit={createBaseline}
            trigger={<Button>New baseline</Button>}
          />
        </div>
      </div>

      {error && <p className="text-sm text-status-fail">{error}</p>}

      {project.baselines.length === 0 ? (
        <p className="text-sm text-muted">No baselines yet — create one to start tracking visual state.</p>
      ) : (
        <BaselineGrid
          baselines={project.baselines}
          viewports={project.viewports}
          onUpload={uploadVersion}
          onEdit={setEditingBaseline}
          onDelete={deleteBaseline}
        />
      )}

      <BaselineDialog
        viewports={project.viewports}
        baseline={editingBaseline ?? undefined}
        open={editingBaseline !== null}
        onOpenChange={(open) => {
          if (!open) setEditingBaseline(null);
        }}
        onSubmit={updateBaseline}
      />
    </div>
  );
}
