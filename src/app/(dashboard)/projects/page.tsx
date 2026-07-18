'use client';

import { useCallback } from 'react';
import { api, type ProjectSummary } from '@/lib/client';
import { ProjectCard } from '@/components/project-card';
import { CreateProjectDialog } from '@/components/create-project-dialog';
import { useLoad } from '@/lib/use-load';
import { Button } from '@/components/ui/button';

export default function ProjectsPage() {
  const fetchProjects = useCallback(() => api.projects.list().then((r) => r.projects), []);
  const { data: projects, error, reload } = useLoad<ProjectSummary[]>(fetchProjects);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Projects</h1>
        <CreateProjectDialog onCreated={reload} />
      </div>
      {error &&
        (projects === null ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-status-fail">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : (
          <p className="text-sm text-status-fail">{error}</p>
        ))}
      {projects && projects.length === 0 && (
        <p className="text-sm text-muted">No projects yet — create one to start capturing baselines.</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
