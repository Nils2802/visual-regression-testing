'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ViewportChip } from '@/components/viewport-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Viewport } from '@/lib/client';

const PRESETS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

export function ViewportsTable({
  items,
  onAdd,
  onDelete,
}: {
  items: Viewport[];
  onAdd: (body: { name: string; width: number; height: number }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');

  const canSubmit = name.trim().length > 0 && width.trim().length > 0 && height.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onAdd({ name, width: parseInt(width, 10), height: parseInt(height, 10) });
    setName('');
    setWidth('');
    setHeight('');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.name}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAdd({ name: p.name, width: p.width, height: p.height })}
          >
            {p.name} {p.width}×{p.height}
          </Button>
        ))}
      </div>
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Viewport</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <ViewportChip name={v.name} width={v.width} height={v.height} />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${v.name}`}
                    onClick={() => onDelete(v.id)}
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
          <Label htmlFor="viewport-name">Name</Label>
          <Input id="viewport-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="viewport-width">Width</Label>
          <Input
            id="viewport-width"
            type="number"
            className="w-24 font-mono"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="viewport-height">Height</Label>
          <Input
            id="viewport-height"
            type="number"
            className="w-24 font-mono"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!canSubmit}>
          Add viewport
        </Button>
      </form>
    </div>
  );
}
