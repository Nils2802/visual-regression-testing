'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [diffThreshold, setDiffThreshold] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await api.projects.create({
        name,
        ...(diffThreshold !== '' ? { diffThreshold: Number(diffThreshold) } : {}),
      });
      setOpen(false);
      setName('');
      setDiffThreshold('');
      onCreated();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-diff-threshold">Diff threshold</Label>
            <Input
              id="project-diff-threshold"
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={diffThreshold}
              onChange={(e) => setDiffThreshold(e.target.value)}
              className="font-mono"
            />
          </div>
          {error && <p className="text-sm text-status-fail">{error}</p>}
          <Button type="submit" disabled={busy || name.length === 0}>
            Create project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
