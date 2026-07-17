'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Environment } from '@/lib/client';

export function EnvironmentsTable({
  items,
  onAdd,
  onDelete,
}: {
  items: Environment[];
  onAdd: (body: { name: string; baseUrl: string }) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, body: { name?: string; baseUrl?: string }) => void;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onAdd({ name, baseUrl });
    setName('');
    setBaseUrl('');
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Base URL</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((env) => (
              <TableRow key={env.id}>
                <TableCell>{env.name}</TableCell>
                <TableCell className="font-mono text-muted">{env.baseUrl}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${env.name}`}
                    onClick={() => onDelete(env.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="env-name">Name</Label>
          <Input id="env-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="env-base-url">Base URL</Label>
          <Input
            id="env-base-url"
            className="font-mono"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!canSubmit}>
          Add environment
        </Button>
      </form>
    </div>
  );
}
