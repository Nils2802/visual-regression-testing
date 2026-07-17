import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import type { RunSummary } from '@/lib/client';

function RunRow({ run }: { run: RunSummary }) {
  const href = `/runs/${run.id}`;

  return (
    <TableRow>
      <TableCell className="p-0">
        <Link href={href} className="block px-2 py-2 font-mono">
          {new Date(run.createdAt).toLocaleString()}
        </Link>
      </TableCell>
      <TableCell className="p-0">
        <Link href={href} className="block px-2 py-2">
          {run.type}
        </Link>
      </TableCell>
      <TableCell className="p-0">
        <Link href={href} className="block px-2 py-2">
          {run.environment.name}
        </Link>
      </TableCell>
      <TableCell className="p-0">
        <Link href={href} className="block px-2 py-2">
          <StatusBadge kind="run" value={run.status} />
        </Link>
      </TableCell>
      <TableCell className="p-0">
        <Link
          href={href}
          className={`block px-2 py-2 font-mono ${run.failedResultCount > 0 ? 'text-status-fail' : ''}`}
        >
          {run.failedResultCount}/{run.resultCount}
        </Link>
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
