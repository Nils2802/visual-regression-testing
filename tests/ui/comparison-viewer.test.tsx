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
});
