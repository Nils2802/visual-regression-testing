'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, type Baseline, type ProjectDetail, type RunSummary } from '@/lib/client';
import { BaselineGrid } from '@/components/baseline-grid';
import { BaselineDialog, type BaselineFormValues } from '@/components/baseline-dialog';
import { RunNowDialog } from '@/components/run-now-dialog';
import { RunsList } from '@/components/runs-list';
import { Button } from '@/components/ui/button';
import { useLoad } from '@/lib/use-load';

interface ProjectDetailData {
  project: ProjectDetail;
  runs: RunSummary[];
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingBaseline, setEditingBaseline] = useState<Baseline | null>(null);

  const fetchProjectDetail = useCallback(
    () =>
      Promise.all([api.projects.get(projectId), api.runs.list(projectId)]).then(([project, r]) => ({
        project,
        runs: r.runs,
      })),
    [projectId]
  );
  const { data, error, reload, fail } = useLoad<ProjectDetailData>(fetchProjectDetail);
  const project = data?.project ?? null;
  const runs = data?.runs ?? [];

  const createBaseline = useCallback(
    (values: BaselineFormValues) => api.baselines.create(projectId, values).then(reload),
    [projectId, reload]
  );

  const updateBaseline = useCallback(
    (values: BaselineFormValues) => {
      if (!editingBaseline) return Promise.reject(new Error('no baseline selected'));
      return api.baselines
        .update(editingBaseline.id, {
          name: values.name,
          pagePath: values.pagePath,
          elementSelector: values.elementSelector ?? null,
          diffThreshold: values.diffThreshold ?? null,
          maskSelectors: values.maskSelectors ?? [],
          ...(values.figmaFrames ? { figmaFrames: values.figmaFrames } : {}),
        })
        .then(reload);
    },
    [editingBaseline, reload]
  );

  const deleteBaseline = useCallback(
    (id: string) => {
      api.baselines.delete(id).then(reload).catch(fail);
    },
    [reload, fail]
  );

  const uploadVersion = useCallback(
    (baselineId: string, viewportId: string, bytes: Uint8Array) => {
      api.baselines.uploadVersion(baselineId, viewportId, bytes).then(reload).catch(fail);
    },
    [reload, fail]
  );

  if (!project) {
    return (
      <div className="mx-auto max-w-5xl">
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
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h1>
        <div className="flex items-center gap-2">
          <RunNowDialog
            project={project}
            onTriggered={(run) => router.push('/runs/' + run.id)}
            trigger={<Button variant="outline">Run now</Button>}
          />
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
          onSynced={reload}
          onSyncError={(err) => {
            fail(err);
            reload();
          }}
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

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Runs</h2>
        <RunsList runs={runs} />
      </div>
    </div>
  );
}
