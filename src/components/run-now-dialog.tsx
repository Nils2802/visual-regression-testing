'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { api, type ProjectDetail, type Run } from '@/lib/client';

export function RunNowDialog({
  project,
  onTriggered,
  triggerFn = api.runs.trigger,
  open,
  onOpenChange,
  defaultOpen,
  trigger,
}: {
  project: ProjectDetail;
  onTriggered: (run: Run) => void;
  triggerFn?: (projectId: string, body: { environmentId: string; type?: 'visual' | 'compare'; referenceEnvironmentId?: string; viewportIds?: string[] }) => Promise<Run>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  trigger?: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [environmentId, setEnvironmentId] = useState('');
  const [type, setType] = useState<'visual' | 'compare'>('visual');
  const [referenceEnvironmentId, setReferenceEnvironmentId] = useState('');
  const [viewportIds, setViewportIds] = useState<string[]>(project.viewports.map((v) => v.id));
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the dialog opens, so a prior run's selections
  // don't leak into the next one.
  useEffect(() => {
    if (!isOpen) return;
    setEnvironmentId('');
    setType('visual');
    setReferenceEnvironmentId('');
    setViewportIds(project.viewports.map((v) => v.id));
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function toggleViewport(id: string) {
    setViewportIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  const referenceOptions = project.environments.filter((e) => e.id !== environmentId);

  const canSubmit =
    environmentId.length > 0 && (type === 'visual' || referenceEnvironmentId.length > 0) && viewportIds.length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const allSelected = viewportIds.length === project.viewports.length;
    setSubmitting(true);
    triggerFn(project.id, {
      environmentId,
      type,
      ...(type === 'compare' ? { referenceEnvironmentId } : {}),
      viewportIds: allSelected ? undefined : viewportIds,
    })
      .then((run) => {
        setOpen(false);
        onTriggered(run);
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run now</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Environment</Label>
            {environmentId === '' ? (
              <div className="flex flex-col gap-1.5">
                {project.environments.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="environment"
                      value={e.id}
                      checked={false}
                      onChange={() => setEnvironmentId(e.id)}
                    />
                    {e.name}
                  </label>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{project.environments.find((e) => e.id === environmentId)?.name}</span>
                <button
                  type="button"
                  className="text-xs text-muted underline"
                  onClick={() => {
                    setEnvironmentId('');
                    setReferenceEnvironmentId('');
                  }}
                >
                  Change
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Run type</Label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="run-type"
                  value="visual"
                  checked={type === 'visual'}
                  onChange={() => setType('visual')}
                />
                visual
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="run-type"
                  value="compare"
                  checked={type === 'compare'}
                  onChange={() => setType('compare')}
                />
                compare
              </label>
            </div>
          </div>

          {type === 'compare' && environmentId !== '' && (
            <div className="flex flex-col gap-2">
              <Label>Reference environment</Label>
              <div className="flex flex-col gap-1.5">
                {referenceOptions.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="reference-environment"
                      value={e.id}
                      checked={referenceEnvironmentId === e.id}
                      onChange={() => setReferenceEnvironmentId(e.id)}
                    />
                    {e.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Viewports</Label>
            <div className="flex flex-col gap-1.5">
              {project.viewports.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={viewportIds.includes(v.id)} onChange={() => toggleViewport(v.id)} />
                  <span className="font-mono">
                    {v.name} {v.width}×{v.height}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={!canSubmit || submitting}>
            Start run
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
