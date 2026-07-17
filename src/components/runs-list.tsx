'use client';

import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import type { RunSummary } from '@/lib/client';

function RunRow({ run }: { run: RunSummary }) {
  const router = useRouter();
  const href = `/runs/${run.id}`;

  function navigate() {
    router.push(href);
  }

  return (
    <TableRow
      role="link"
      tabIndex={0}
      className="cursor-pointer"
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate();
        }
      }}
    >
      <TableCell className="font-mono">{new Date(run.createdAt).toLocaleString()}</TableCell>
      <TableCell>{run.type}</TableCell>
      <TableCell>{run.environment.name}</TableCell>
      <TableCell>
        <StatusBadge kind="run" value={run.status} />
      </TableCell>
      <TableCell className={`font-mono ${run.failedResultCount > 0 ? 'text-status-fail' : ''}`}>
        {run.failedResultCount}/{run.resultCount}
      </TableCell>
    </TableRow>
  );
}

export function RunsList({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No runs yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Environment</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Results</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </TableBody>
    </Table>
  );
}
