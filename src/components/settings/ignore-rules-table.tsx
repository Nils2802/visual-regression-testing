'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LOG_TYPES } from '@/lib/collector';
import type { IgnoreRule } from '@/lib/client';

const ANY_ENTRY_TYPE = 'any';

export function IgnoreRulesTable({
  items,
  onAdd,
  onDelete,
}: {
  items: IgnoreRule[];
  onAdd: (body: { reason: string; entryType?: string; urlPattern?: string; messagePattern?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [entryType, setEntryType] = useState<string>(ANY_ENTRY_TYPE);
  const [urlPattern, setUrlPattern] = useState('');
  const [messagePattern, setMessagePattern] = useState('');

  const hasCriterion =
    entryType !== ANY_ENTRY_TYPE || urlPattern.trim().length > 0 || messagePattern.trim().length > 0;
  const canSubmit = reason.trim().length > 0 && hasCriterion;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onAdd({
      reason,
      ...(entryType !== ANY_ENTRY_TYPE ? { entryType } : {}),
      ...(urlPattern.trim() ? { urlPattern } : {}),
      ...(messagePattern.trim() ? { messagePattern } : {}),
    });
    setReason('');
    setEntryType(ANY_ENTRY_TYPE);
    setUrlPattern('');
    setMessagePattern('');
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reason</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>URL pattern</TableHead>
              <TableHead>Message pattern</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{rule.reason}</TableCell>
                <TableCell className="font-mono text-muted">{rule.entryType ?? ANY_ENTRY_TYPE}</TableCell>
                <TableCell className="font-mono text-muted">{rule.urlPattern ?? '—'}</TableCell>
                <TableCell className="font-mono text-muted">{rule.messagePattern ?? '—'}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${rule.reason}`}
                    onClick={() => onDelete(rule.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ignore-reason">Reason</Label>
          <Input id="ignore-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ignore-entry-type">Type</Label>
            <Select value={entryType} onValueChange={setEntryType}>
              <SelectTrigger id="ignore-entry-type" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_ENTRY_TYPE}>any</SelectItem>
                {LOG_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ignore-url-pattern">URL pattern</Label>
            <Input
              id="ignore-url-pattern"
              className="font-mono"
              value={urlPattern}
              onChange={(e) => setUrlPattern(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ignore-message-pattern">Message pattern</Label>
            <Input
              id="ignore-message-pattern"
              className="font-mono"
              value={messagePattern}
              onChange={(e) => setMessagePattern(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!canSubmit}>
            Add rule
          </Button>
        </div>
      </form>
    </div>
  );
}
