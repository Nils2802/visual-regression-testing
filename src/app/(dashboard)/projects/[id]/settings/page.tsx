'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiClientError, type ProjectDetail, type IgnoreRule } from '@/lib/client';
import { EnvironmentsTable } from '@/components/settings/environments-table';
import { ViewportsTable } from '@/components/settings/viewports-table';
import { IgnoreRulesTable } from '@/components/settings/ignore-rules-table';

export default function ProjectSettingsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [rules, setRules] = useState<IgnoreRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.projects.get(projectId), api.ignoreRules.list(projectId)])
      .then(([p, r]) => {
        setProject(p);
        setRules(r.rules);
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'failed to load'));
  }, [projectId]);

  useEffect(load, [load]);

  const handleError = useCallback((e: unknown) => {
    setError(e instanceof ApiClientError ? e.message : 'something went wrong');
  }, []);

  const addEnvironment = useCallback(
    (body: { name: string; baseUrl: string }) => {
      api.environments.create(projectId, body).then(load).catch(handleError);
    },
    [projectId, load, handleError]
  );
  const deleteEnvironment = useCallback(
    (envId: string) => {
      api.environments.delete(envId).then(load).catch(handleError);
    },
    [load, handleError]
  );

  const addViewport = useCallback(
    (body: { name: string; width: number; height: number }) => {
      api.viewports.create(projectId, body).then(load).catch(handleError);
    },
    [projectId, load, handleError]
  );
  const deleteViewport = useCallback(
    (viewportId: string) => {
      api.viewports.delete(viewportId).then(load).catch(handleError);
    },
    [load, handleError]
  );

  const addIgnoreRule = useCallback(
    (body: { reason: string; entryType?: string; urlPattern?: string; messagePattern?: string }) => {
      api.ignoreRules.create(projectId, body).then(load).catch(handleError);
    },
    [projectId, load, handleError]
  );
  const deleteIgnoreRule = useCallback(
    (ruleId: string) => {
      api.ignoreRules.delete(ruleId).then(load).catch(handleError);
    },
    [load, handleError]
  );

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl">
        {error ? <p className="text-sm text-status-fail">{error}</p> : <p className="text-sm text-muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-1">
        <Link href={`/projects/${project.id}`} className="text-sm text-muted hover:text-text">
          ← {project.name}
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      {error && <p className="text-sm text-status-fail">{error}</p>}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">Environments</h2>
        <EnvironmentsTable items={project.environments} onAdd={addEnvironment} onDelete={deleteEnvironment} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">Viewports</h2>
        <ViewportsTable items={project.viewports} onAdd={addViewport} onDelete={deleteViewport} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">Ignore rules</h2>
        <IgnoreRulesTable items={rules ?? []} onAdd={addIgnoreRule} onDelete={deleteIgnoreRule} />
      </section>
    </div>
  );
}
