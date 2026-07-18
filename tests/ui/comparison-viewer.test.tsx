// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ComparisonViewer } from '@/components/comparison-viewer';
import { ApiClientError, type BaselineVersion, type RunResult } from '@/lib/client';

afterEach(cleanup);

function result(overrides: Partial<RunResult>): RunResult {
  return {
    id: 'r1',
    runId: 'run1',
    baselineId: 'b1',
    viewportId: 'vp1',
    captureImagePath: null,
    referenceImagePath: null,
    baselineImagePath: null,
    diffImagePath: null,
    visualStatus: 'pass',
    functionalStatus: 'pass',
    diffRatio: null,
    sizeMismatch: false,
    error: null,
    baseline: { id: 'b1', name: 'home', elementSelector: null },
    viewport: { id: 'vp1', projectId: 'p1', name: 'desktop', width: 1440, height: 900 },
    logEntries: [],
    ...overrides,
  };
}

// compare run: reference (live) captured alongside test (dev) capture + diff
const compareResult = result({
  id: 'r-compare',
  visualStatus: 'diff',
  captureImagePath: 'captures/r-compare.png',
  referenceImagePath: 'references/r-compare.png',
  diffImagePath: 'diffs/r-compare.png',
  diffRatio: 0.12345,
});

// visual run: capture diffed against the active baseline (no left-side image
// is persisted on RunResult for visual runs — only compare runs store
// referenceImagePath, see src/lib/runner.ts)
const visualResult = result({
  id: 'r-visual',
  visualStatus: 'diff',
  captureImagePath: 'captures/r-visual.png',
  diffImagePath: 'diffs/r-visual.png',
  diffRatio: 0.045,
});

// visual run, no approved baseline yet: capture becomes a pending version
const newResult = result({
  id: 'r-new',
  visualStatus: 'new',
  captureImagePath: 'captures/r-new.png',
});

function promoteFn(resolved: BaselineVersion = { id: 'v1', targetId: 't1', imagePath: 'baselines/x.png', status: 'pending', isActive: false, createdAt: '' }) {
  return vi.fn().mockResolvedValue(resolved);
}

describe('ComparisonViewer', () => {
  it('renders three mode tabs and switching to slider shows the range input', () => {
    render(<ComparisonViewer result={compareResult} runType="compare" promoteFn={promoteFn()} onPromoted={vi.fn()} />);
    const tabs = screen.getByRole('group', { name: 'Comparison mode' });
    expect(within(tabs).getByText('side by side')).toBeDefined();
    expect(within(tabs).getByText('slider')).toBeDefined();
    expect(within(tabs).getByText('diff')).toBeDefined();

    fireEvent.click(within(tabs).getByText('slider'));
    expect(screen.getByLabelText('comparison slider')).toBeDefined();
  });

  it('hides the approve button for compare runs', () => {
    render(<ComparisonViewer result={compareResult} runType="compare" promoteFn={promoteFn()} onPromoted={vi.fn()} />);
    expect(screen.queryByText('Approve as baseline')).toBeNull();
  });

  it('shows the approve button for visual runs and promotes on click', async () => {
    const trigger = promoteFn();
    const onPromoted = vi.fn();
    render(<ComparisonViewer result={visualResult} runType="visual" promoteFn={trigger} onPromoted={onPromoted} />);

    fireEvent.click(screen.getByText('Approve as baseline'));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('r-visual'));
    expect(await screen.findByText('pending version created — review in Approvals')).toBeDefined();
    expect(onPromoted).toHaveBeenCalled();
  });

  it('surfaces an ApiClientError from approve inline', async () => {
    const trigger = vi.fn().mockRejectedValue(new ApiClientError(409, 'result already promoted'));
    render(<ComparisonViewer result={visualResult} runType="visual" promoteFn={trigger} onPromoted={vi.fn()} />);

    fireEvent.click(screen.getByText('Approve as baseline'));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(await screen.findByText('result already promoted')).toBeDefined();
  });

  it('disables slider and diff tabs and shows the no-baseline placeholder for a new result', () => {
    render(<ComparisonViewer result={newResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />);

    expect(screen.getByText('no baseline')).toBeDefined();

    const sliderTab = screen.getByText('slider').closest('button') as HTMLButtonElement;
    const diffTab = screen.getByText('diff').closest('button') as HTMLButtonElement;
    expect(sliderTab.disabled).toBe(true);
    expect(diffTab.disabled).toBe(true);
    expect(sliderTab.title.length).toBeGreaterThan(0);
    expect(diffTab.title.length).toBeGreaterThan(0);
  });

  it('shows the size-mismatch warning and diffRatio to 4 decimals', () => {
    render(
      <ComparisonViewer
        result={result({ ...compareResult, sizeMismatch: true })}
        runType="compare"
        promoteFn={promoteFn()}
        onPromoted={vi.fn()}
      />
    );
    expect(screen.getByText('⚠ size mismatch')).toBeDefined();
    expect(screen.getByText('0.1235')).toBeDefined();
  });

  it('distinguishes "no baseline" (new) from "baseline image not available" (diff-status visual result)', () => {
    const { rerender } = render(
      <ComparisonViewer result={newResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />
    );
    expect(screen.getByText('no baseline')).toBeDefined();
    expect(screen.queryByText('baseline image not available')).toBeNull();

    rerender(<ComparisonViewer result={visualResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />);
    expect(screen.getByText('baseline image not available')).toBeDefined();
    expect(screen.queryByText('no baseline')).toBeNull();

    const sliderTab = screen.getByText('slider').closest('button') as HTMLButtonElement;
    expect(sliderTab.disabled).toBe(true);
    expect(sliderTab.title).toBe('baseline image not available');
  });

  it('renders the pinned baseline image and enables slider for visual-run results', () => {
    const pinnedResult = result({
      id: 'r-pinned',
      visualStatus: 'diff',
      captureImagePath: 'captures/r-pinned.png',
      diffImagePath: 'diffs/r-pinned.png',
      baselineImagePath: 'baselines/t1-123.png',
    });
    render(<ComparisonViewer result={pinnedResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />);

    expect(screen.getByAltText('baseline image')).toBeDefined();
    expect(screen.queryByText('baseline image not available')).toBeNull();

    const sliderTab = screen.getByText('slider').closest('button') as HTMLButtonElement;
    expect(sliderTab.disabled).toBe(false);
  });

  it('persists the selected mode across a result switch when still available', () => {
    const otherCompareResult = result({
      id: 'r-compare-2',
      visualStatus: 'diff',
      captureImagePath: 'captures/r-compare-2.png',
      referenceImagePath: 'references/r-compare-2.png',
      diffImagePath: 'diffs/r-compare-2.png',
    });
    const { rerender } = render(
      <ComparisonViewer result={compareResult} runType="compare" promoteFn={promoteFn()} onPromoted={vi.fn()} />
    );
    fireEvent.click(within(screen.getByRole('group', { name: 'Comparison mode' })).getByText('slider'));
    expect(screen.getByLabelText('comparison slider')).toBeDefined();

    // switching to a different result that also supports slider mode — same
    // component instance (rerender, not unmount) — should keep the mode
    rerender(<ComparisonViewer result={otherCompareResult} runType="compare" promoteFn={promoteFn()} onPromoted={vi.fn()} />);
    expect(screen.getByLabelText('comparison slider')).toBeDefined();
  });

  it('falls back to side by side when the selected mode becomes unavailable after switching', () => {
    const { rerender } = render(
      <ComparisonViewer result={compareResult} runType="compare" promoteFn={promoteFn()} onPromoted={vi.fn()} />
    );
    fireEvent.click(within(screen.getByRole('group', { name: 'Comparison mode' })).getByText('slider'));
    expect(screen.getByLabelText('comparison slider')).toBeDefined();

    // visualResult has no left image at all, so slider is unavailable there
    rerender(<ComparisonViewer result={visualResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />);
    expect(screen.queryByLabelText('comparison slider')).toBeNull();
    // fallen back to side-by-side content
    expect(screen.getByText('baseline image not available')).toBeDefined();
  });

  it('clears a lingering approve success note when the user switches to a different result', async () => {
    const trigger = promoteFn();
    const { rerender } = render(
      <ComparisonViewer result={visualResult} runType="visual" promoteFn={trigger} onPromoted={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Approve as baseline'));
    expect(await screen.findByText('pending version created — review in Approvals')).toBeDefined();

    rerender(<ComparisonViewer result={newResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />);
    expect(screen.queryByText('pending version created — review in Approvals')).toBeNull();
  });

  it('does not show a promote note on the newly-selected result when an earlier in-flight approve resolves after switching', async () => {
    let resolvePromote: ((v: BaselineVersion) => void) | undefined;
    const trigger = vi.fn(
      () =>
        new Promise<BaselineVersion>((resolve) => {
          resolvePromote = resolve;
        })
    );
    const onPromoted = vi.fn();
    const { rerender } = render(
      <ComparisonViewer result={visualResult} runType="visual" promoteFn={trigger} onPromoted={onPromoted} />
    );
    fireEvent.click(screen.getByText('Approve as baseline'));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('r-visual'));

    // switch to a different result before the in-flight promote resolves
    rerender(<ComparisonViewer result={newResult} runType="visual" promoteFn={promoteFn()} onPromoted={vi.fn()} />);

    // now let the stale request resolve
    resolvePromote?.({ id: 'v1', targetId: 't1', imagePath: 'baselines/x.png', status: 'pending', isActive: false, createdAt: '' });
    await waitFor(() => expect(onPromoted).toHaveBeenCalled());

    expect(screen.queryByText('pending version created — review in Approvals')).toBeNull();
  });
});
