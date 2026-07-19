'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError, type Baseline, type Viewport } from '@/lib/client';

export interface BaselineFormValues {
  name: string;
  pagePath: string;
  sourceType: 'upload' | 'capture' | 'figma';
  elementSelector?: string;
  diffThreshold?: number;
  maskSelectors?: string[];
  viewportIds?: string[];
  figmaFrames?: { viewportId: string; url: string }[];
}

// Reconstructs the editable Figma frame URL from a target's stored
// fileKey/nodeId — the inverse of parseFigmaFrameUrl (colon node ids are
// dash-separated in the URL's node-id query param).
function figmaFrameUrl(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}/frame?node-id=${nodeId.replaceAll(':', '-')}`;
}

function parseMaskSelectors(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function BaselineDialog({
  viewports,
  baseline,
  open,
  onOpenChange,
  onSubmit,
  trigger,
}: {
  viewports: Viewport[];
  baseline?: Baseline;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSubmit: (values: BaselineFormValues) => Promise<unknown>;
  trigger?: React.ReactNode;
}) {
  const editing = baseline !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [name, setName] = useState('');
  const [pagePath, setPagePath] = useState('');
  const [sourceType, setSourceType] = useState<'upload' | 'capture' | 'figma'>('capture');
  const [elementSelector, setElementSelector] = useState('');
  const [diffThreshold, setDiffThreshold] = useState('');
  const [maskSelectors, setMaskSelectors] = useState('');
  const [selectedViewportIds, setSelectedViewportIds] = useState<string[]>(viewports.map((v) => v.id));
  const [figmaUrls, setFigmaUrls] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset/initialize the form only when the dialog opens or the edited
  // baseline's identity changes — keyed on `baseline?.id`, not the `baseline`
  // object or the `viewports` array, so an unrelated object-reference change
  // (e.g. a background reload completing while the dialog is open) can't
  // silently discard unsaved input. `viewports` and `baseline` are still read
  // from the current render's closure, so defaults reflect their latest
  // values at the moment the effect actually runs (open time).
  useEffect(() => {
    if (!isOpen) return;
    setSubmitting(false);
    setError(null);
    if (baseline) {
      setName(baseline.name);
      setPagePath(baseline.pagePath);
      setSourceType(
        baseline.sourceType === 'upload' ? 'upload' : baseline.sourceType === 'figma' ? 'figma' : 'capture'
      );
      setElementSelector(baseline.elementSelector ?? '');
      setDiffThreshold(baseline.diffThreshold !== null && baseline.diffThreshold !== undefined ? String(baseline.diffThreshold) : '');
      setMaskSelectors(baseline.maskSelectors.join('\n'));
      setSelectedViewportIds((baseline.targets ?? []).map((t) => t.viewportId));
      const urls: Record<string, string> = {};
      for (const t of baseline.targets ?? []) {
        if (t.figmaFileKey && t.figmaNodeId) urls[t.viewportId] = figmaFrameUrl(t.figmaFileKey, t.figmaNodeId);
      }
      setFigmaUrls(urls);
    } else {
      setName('');
      setPagePath('');
      setSourceType('capture');
      setElementSelector('');
      setDiffThreshold('');
      setMaskSelectors('');
      setSelectedViewportIds(viewports.map((v) => v.id));
      setFigmaUrls({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, baseline?.id]);

  function toggleViewport(id: string) {
    setSelectedViewportIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    onSubmit({
      name,
      pagePath,
      sourceType,
      ...(elementSelector.trim() ? { elementSelector: elementSelector.trim() } : {}),
      ...(diffThreshold.trim() ? { diffThreshold: Number(diffThreshold) } : {}),
      maskSelectors: parseMaskSelectors(maskSelectors),
      viewportIds: selectedViewportIds,
      ...(sourceType === 'figma'
        ? {
            figmaFrames: selectedViewportIds.map((viewportId) => ({
              viewportId,
              url: (figmaUrls[viewportId] ?? '').trim(),
            })),
          }
        : {}),
    })
      .then(() => setOpen(false))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'something went wrong'))
      .finally(() => setSubmitting(false));
  }

  const canSubmit =
    name.trim().length > 0 &&
    pagePath.trim().startsWith('/') &&
    (editing || selectedViewportIds.length > 0) &&
    (sourceType !== 'figma' || selectedViewportIds.every((id) => (figmaUrls[id] ?? '').trim().length > 0));

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${baseline.name}` : 'New baseline'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-name">Name</Label>
            <Input id="baseline-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-page-path">Page path</Label>
            <Input id="baseline-page-path" className="font-mono" value={pagePath} onChange={(e) => setPagePath(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-source-type">Source type</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as 'upload' | 'capture' | 'figma')} disabled={editing}>
              <SelectTrigger id="baseline-source-type" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="capture">capture</SelectItem>
                <SelectItem value="upload">upload</SelectItem>
                <SelectItem value="figma">figma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-element-selector">Element selector</Label>
            <Input
              id="baseline-element-selector"
              className="font-mono"
              value={elementSelector}
              onChange={(e) => setElementSelector(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-diff-threshold">Diff threshold</Label>
            <Input
              id="baseline-diff-threshold"
              type="number"
              step="0.001"
              min="0"
              max="1"
              className="font-mono"
              value={diffThreshold}
              onChange={(e) => setDiffThreshold(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-mask-selectors">Mask selectors (one per line)</Label>
            <Textarea
              id="baseline-mask-selectors"
              className="font-mono"
              value={maskSelectors}
              onChange={(e) => setMaskSelectors(e.target.value)}
            />
          </div>
          {!editing && (
            <div className="flex flex-col gap-2">
              <Label>Viewports</Label>
              <div className="flex flex-col gap-1.5">
                {viewports.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedViewportIds.includes(v.id)}
                      onChange={() => toggleViewport(v.id)}
                    />
                    <span className="font-mono">
                      {v.name} {v.width}×{v.height}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {sourceType === 'figma' && (
            <div className="flex flex-col gap-2">
              <Label>Figma frame URLs</Label>
              <div className="flex flex-col gap-3">
                {viewports
                  .filter((v) => selectedViewportIds.includes(v.id))
                  .map((v) => (
                    <div key={v.id} className="flex flex-col gap-1.5">
                      <Label htmlFor={`baseline-figma-url-${v.id}`}>{v.name}</Label>
                      <Input
                        id={`baseline-figma-url-${v.id}`}
                        className="font-mono"
                        placeholder="https://www.figma.com/design/…?node-id=…"
                        value={figmaUrls[v.id] ?? ''}
                        onChange={(e) => setFigmaUrls((prev) => ({ ...prev, [v.id]: e.target.value }))}
                      />
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">Frames are imported on the next sync.</p>
            </div>
          )}
          {error && <p className="text-sm text-status-fail">{error}</p>}
          <Button type="submit" disabled={!canSubmit || submitting}>
            {editing ? 'Save changes' : 'Create baseline'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
