import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import type { ProjectSummary } from '@/lib/client';

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-md border border-border bg-surface p-4 transition-colors hover:border-muted"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight">{project.name}</h2>
        {project.failedResultCount > 0 && (
          <span className="rounded border border-status-fail/40 bg-status-fail/10 px-1.5 py-0.5 font-mono text-xs text-status-fail">
            {project.failedResultCount} failing
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        {project.lastRun ? (
          <>
            <StatusBadge kind="run" value={project.lastRun.status} />
            <span className="font-mono">{new Date(project.lastRun.createdAt).toLocaleString()}</span>
          </>
        ) : (
          <span>no runs yet</span>
        )}
      </div>
    </Link>
  );
}
