'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ProjectDetail, type IgnoreRule } from '@/lib/client';
import { EnvironmentsTable } from '@/components/settings/environments-table';
import { ViewportsTable } from '@/components/settings/viewports-table';
import { IgnoreRulesTable } from '@/components/settings/ignore-rules-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLoad } from '@/lib/use-load';

interface ProjectSettingsData {
  project: ProjectDetail;
  rules: IgnoreRule[];
}

export default function ProjectSettingsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const fetchSettings = useCallback(
    () =>
      Promise.all([api.projects.get(projectId), api.ignoreRules.list(projectId)]).then(([project, r]) => ({
        project,
        rules: r.rules,
      })),
    [projectId]
  );
  const { data, error, reload, fail } = useLoad<ProjectSettingsData>(fetchSettings);
  const project = data?.project ?? null;
  const rules = data?.rules ?? null;

  const [figmaTokenInput, setFigmaTokenInput] = useState('');
  const [replacingFigmaToken, setReplacingFigmaToken] = useState(false);

  const saveFigmaToken = useCallback(() => {
    api.projects
      .update(projectId, { figmaToken: figmaTokenInput })
      .then(() => {
        setFigmaTokenInput('');
        setReplacingFigmaToken(false);
        reload();
      })
      .catch(fail);
  }, [projectId, figmaTokenInput, reload, fail]);

  const clearFigmaToken = useCallback(() => {
    api.projects.update(projectId, { figmaToken: null }).then(reload).catch(fail);
  }, [projectId, reload, fail]);

  const setSyncBeforeRun = useCallback(
    (checked: boolean) => {
      api.projects.update(projectId, { syncBeforeRun: checked }).then(reload).catch(fail);
    },
    [projectId, reload, fail]
  );

  const addEnvironment = useCallback(
    (body: { name: string; baseUrl: string }) => {
      api.environments.create(projectId, body).then(reload).catch(fail);
    },
    [projectId, reload, fail]
  );
  const deleteEnvironment = useCallback(
    (envId: string) => {
      api.environments.delete(envId).then(reload).catch(fail);
    },
    [reload, fail]
  );

  const addViewport = useCallback(
    (body: { name: string; width: number; height: number }) => {
      api.viewports.create(projectId, body).then(reload).catch(fail);
    },
    [projectId, reload, fail]
  );
  const deleteViewport = useCallback(
    (viewportId: string) => {
      api.viewports.delete(viewportId).then(reload).catch(fail);
    },
    [reload, fail]
  );

  const addIgnoreRule = useCallback(
    (body: { reason: string; entryType?: string; urlPattern?: string; messagePattern?: string }) => {
      api.ignoreRules.create(projectId, body).then(reload).catch(fail);
    },
    [projectId, reload, fail]
  );
  const deleteIgnoreRule = useCallback(
    (ruleId: string) => {
      api.ignoreRules.delete(ruleId).then(reload).catch(fail);
    },
    [reload, fail]
  );

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl">
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
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-1">
        <Link href={`/projects/${project.id}`} className="text-sm text-muted hover:text-text">
          ← {project.name}
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      {error && <p className="text-sm text-status-fail">{error}</p>}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">Figma</h2>
        {project.figmaTokenSet && !replacingFigmaToken ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted">Token set</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setReplacingFigmaToken(true)}>
              Replace
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clearFigmaToken}>
              Clear
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Input
                type="password"
                placeholder="figd_…"
                value={figmaTokenInput}
                onChange={(e) => setFigmaTokenInput(e.target.value)}
              />
            </div>
            <Button type="button" disabled={figmaTokenInput.trim().length === 0} onClick={saveFigmaToken}>
              Save
            </Button>
            {project.figmaTokenSet && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReplacingFigmaToken(false);
                  setFigmaTokenInput('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={project.syncBeforeRun}
            onChange={(e) => setSyncBeforeRun(e.target.checked)}
          />
          Sync baselines from Figma before every run
        </label>
      </section>

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
