'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiClientError, imageUrl, type BaselineVersion, type RunResult } from '@/lib/client';

type Mode = 'side-by-side' | 'slider' | 'diff';

const MODES: { key: Mode; label: string }[] = [
  { key: 'side-by-side', label: 'side by side' },
  { key: 'slider', label: 'slider' },
  { key: 'diff', label: 'diff' },
];

function ModeTab({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function ImagePane({ label, path, emptyText }: { label: string; path: string | null; emptyText: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex min-h-24 items-center justify-center rounded-md border border-border bg-surface-2">
        {path ? (
          <img src={imageUrl(path)} alt={`${label} image`} className="max-h-[70vh] w-full object-contain bg-surface-2" />
        ) : (
          <p className="p-4 text-sm text-muted">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

export function ComparisonViewer({
  result,
  runType,
  promoteFn = api.results.promote,
  onPromoted,
}: {
  result: RunResult;
  runType: string;
  promoteFn?: (id: string) => Promise<BaselineVersion>;
  onPromoted: () => void;
}) {
  const [mode, setMode] = useState<Mode>('side-by-side');
  const [sliderPos, setSliderPos] = useState(50);
  const [showCaptureUnderneath, setShowCaptureUnderneath] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState(false);

  const isCompare = runType === 'compare';
  // Visual runs pin the exact baseline image the diff ran against onto
  // baselineImagePath (see src/lib/runner.ts: processResult's diff-branch
  // update); compare runs instead store a live referenceImagePath and never
  // populate baselineImagePath. Pre-migration rows and results with
  // visualStatus 'new'/null (no approved baseline existed to diff against)
  // still have a null path here, so the placeholder text below still
  // distinguishes "no baseline" (new/null — none ever existed) from
  // "baseline image not available" (a diff/pass/fail row predating this
  // field, or rows where capture/diff threw before the final update).
  // Compare runs never had a "baseline" concept at all — their left pane is a
  // live reference capture, so a missing one reads as "no reference image",
  // not "no baseline".
  const leftImagePath = isCompare ? result.referenceImagePath : result.baselineImagePath;
  const leftLabel = isCompare ? 'reference (live)' : 'baseline';
  const captureLabel = isCompare ? 'test (dev)' : 'capture';
  const leftUnavailableText = isCompare
    ? 'no reference image'
    : result.visualStatus === 'new' || result.visualStatus === null
      ? 'no baseline'
      : 'baseline image not available';

  const hasCapture = result.captureImagePath !== null;
  const hasLeft = leftImagePath !== null;
  const hasDiff = result.diffImagePath !== null;

  const sliderAvailable = hasLeft && hasCapture;
  const diffAvailable = hasDiff && hasCapture;

  function missingReason(needsLeft: boolean, needsDiff: boolean): string {
    const missing: string[] = [];
    if (needsLeft && !hasLeft) missing.push(isCompare ? 'reference' : 'baseline');
    if (needsDiff && !hasDiff) missing.push('diff');
    if (!hasCapture) missing.push('capture');
    if (missing.length === 0) return '';
    const noun = missing.length > 1 ? 'images' : 'image';
    return `${missing.join(' and ')} ${noun} not available`;
  }

  const canApprove = runType !== 'compare' && result.captureImagePath !== null;

  // Tracks the result currently on screen so an approve request that resolves
  // after the user has already switched to a different result doesn't paint
  // its success/error note onto the newly-selected result.
  const currentResultId = useRef(result.id);
  currentResultId.current = result.id;

  // Reset transient, per-result UI state whenever the selected result
  // changes (but NOT on every re-render of the same result, e.g. a reload
  // after promoting). Mode itself persists across a switch unless the newly
  // selected result can't support it, in which case it falls back to
  // side-by-side.
  useEffect(() => {
    setSliderPos(50);
    setShowCaptureUnderneath(false);
    setApproving(false);
    setApproveError(null);
    setApproveSuccess(false);
    setMode((prev) => {
      if (prev === 'slider' && !sliderAvailable) return 'side-by-side';
      if (prev === 'diff' && !diffAvailable) return 'side-by-side';
      return prev;
    });
    // Only the identity of the selected result should trigger this reset;
    // sliderAvailable/diffAvailable are pure functions of `result` and are
    // already current by the time this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id]);

  function approve() {
    const requestedId = result.id;
    setApproving(true);
    setApproveError(null);
    promoteFn(requestedId)
      .then(() => {
        onPromoted();
        if (currentResultId.current !== requestedId) return;
        setApproveSuccess(true);
      })
      .catch((err) => {
        if (currentResultId.current !== requestedId) return;
        setApproveError(err instanceof ApiClientError ? err.message : 'something went wrong');
      })
      .finally(() => {
        if (currentResultId.current === requestedId) setApproving(false);
      });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {result.visualStatus && <StatusBadge kind="visual" value={result.visualStatus} />}
        {result.functionalStatus && <StatusBadge kind="functional" value={result.functionalStatus} />}
        {result.diffRatio !== null && <span className="font-mono text-xs text-muted">{result.diffRatio.toFixed(4)}</span>}
        {result.sizeMismatch && <span className="text-xs text-status-pending">⚠ size mismatch</span>}
      </div>

      {result.visualStatus === 'fail' && result.error && <p className="text-sm text-status-fail">{result.error}</p>}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Comparison mode">
        {MODES.map((m) => {
          const disabled = (m.key === 'slider' && !sliderAvailable) || (m.key === 'diff' && !diffAvailable);
          let title: string | undefined;
          if (disabled && m.key === 'slider') title = missingReason(true, false);
          else if (disabled && m.key === 'diff') title = missingReason(false, true);
          return (
            <ModeTab key={m.key} active={mode === m.key} disabled={disabled} title={title} onClick={() => setMode(m.key)}>
              {m.label}
            </ModeTab>
          );
        })}
      </div>

      {mode === 'side-by-side' && (
        <div className="grid grid-cols-2 gap-3">
          <ImagePane label={leftLabel} path={leftImagePath} emptyText={leftUnavailableText} />
          <ImagePane label={captureLabel} path={result.captureImagePath} emptyText="no capture" />
        </div>
      )}

      {mode === 'slider' && sliderAvailable && (
        <div className="flex flex-col gap-2">
          <div className="relative h-[70vh] w-full overflow-hidden rounded-md border border-border bg-surface-2">
            <img
              src={imageUrl(leftImagePath!)}
              alt={`${leftLabel} image`}
              className="absolute inset-0 h-full w-full object-contain bg-surface-2"
            />
            <img
              src={imageUrl(result.captureImagePath!)}
              alt={`${captureLabel} image`}
              className="absolute inset-0 h-full w-full object-contain bg-surface-2"
              style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            aria-label="comparison slider"
          />
        </div>
      )}

      {mode === 'diff' && diffAvailable && (
        <div className="flex flex-col gap-2">
          <div className="relative rounded-md border border-border bg-surface-2">
            {showCaptureUnderneath && (
              <img
                src={imageUrl(result.captureImagePath!)}
                alt={`${captureLabel} image`}
                className="max-h-[70vh] w-full object-contain bg-surface-2"
              />
            )}
            <img
              src={imageUrl(result.diffImagePath!)}
              alt="diff image"
              className={`max-h-[70vh] w-full object-contain bg-surface-2 ${showCaptureUnderneath ? 'absolute inset-0' : ''}`}
              style={showCaptureUnderneath ? { mixBlendMode: 'normal', opacity: 1 } : undefined}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showCaptureUnderneath}
              onChange={(e) => setShowCaptureUnderneath(e.target.checked)}
            />
            show capture underneath
          </label>
        </div>
      )}

      {canApprove && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Button type="button" onClick={approve} disabled={approving} className="self-start">
            Approve as baseline
          </Button>
          {approveError && <p className="text-sm text-status-fail">{approveError}</p>}
          {approveSuccess && <p className="text-sm text-status-pass">pending version created — review in Approvals</p>}
        </div>
      )}
    </div>
  );
}
