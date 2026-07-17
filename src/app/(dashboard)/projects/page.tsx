'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectSummary } from '@/lib/client';
import { ProjectCard } from '@/components/project-card';
import { CreateProjectDialog } from '@/components/create-project-dialog';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.projects
      .list()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Projects</h1>
        <CreateProjectDialog onCreated={load} />
      </div>
      {error && <p className="text-sm text-status-fail">{error}</p>}
      {projects && projects.length === 0 && (
        <p className="text-sm text-muted">No projects yet — create one to start capturing baselines.</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
