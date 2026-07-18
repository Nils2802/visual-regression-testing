// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ResultList } from '@/components/result-list';
import type { RunResult, Viewport } from '@/lib/client';

afterEach(cleanup);

const viewportDesktop: Viewport = { id: 'vp-desktop', projectId: 'p', name: 'desktop', width: 1440, height: 900 };
const viewportMobile: Viewport = { id: 'vp-mobile', projectId: 'p', name: 'mobile', width: 375, height: 667 };
const viewports = [viewportDesktop, viewportMobile];

function result(overrides: Partial<RunResult>): RunResult {
  return {
    id: 'r1',
    runId: 'run1',
    baselineId: 'b1',
    viewportId: viewportDesktop.id,
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
    viewport: viewportDesktop,
    logEntries: [],
    ...overrides,
  };
}

const resultPass = result({ id: 'r-pass', baseline: { id: 'b1', name: 'home', elementSelector: null }, viewport: viewportDesktop, viewportId: viewportDesktop.id });
const resultDiff = result({
  id: 'r-diff',
  baseline: { id: 'b1', name: 'home', elementSelector: null },
  viewport: viewportMobile,
  viewportId: viewportMobile.id,
  visualStatus: 'diff',
  diffRatio: 0.12345,
});
const resultFunctionalFail = result({
  id: 'r-func-fail',
  baseline: { id: 'b2', name: 'nav', elementSelector: null },
  viewport: viewportDesktop,
  viewportId: viewportDesktop.id,
  visualStatus: 'pass',
  functionalStatus: 'fail',
});
const resultCaptureFail = result({
  id: 'r-capture-fail',
  baseline: { id: 'b3', name: 'footer', elementSelector: null },
  viewport: viewportDesktop,
  viewportId: viewportDesktop.id,
  visualStatus: 'fail',
  functionalStatus: null,
  error: 'element not found',
});

const allResults = [resultPass, resultDiff, resultFunctionalFail, resultCaptureFail];

function renderList(overrides: Partial<React.ComponentProps<typeof ResultList>> = {}) {
  const onSelect = vi.fn();
  const onFilterChange = vi.fn();
  const onViewportFilterChange = vi.fn();
  render(
    <ResultList
      results={allResults}
      selectedId={null}
      onSelect={onSelect}
      statusFilter="all"
      onFilterChange={onFilterChange}
      viewportFilter={null}
      onViewportFilterChange={onViewportFilterChange}
      viewports={viewports}
      {...overrides}
    />
  );
  return { onSelect, onFilterChange, onViewportFilterChange };
}

describe('ResultList', () => {
  it('groups results by baseline name', () => {
    renderList();
    expect(screen.getByText('home')).toBeDefined();
    expect(screen.getByText('nav')).toBeDefined();
    expect(screen.getByText('footer')).toBeDefined();
  });

  it('shows diffRatio to 4 decimals when set', () => {
    renderList();
    expect(screen.getByText('0.1235')).toBeDefined();
  });

  it('filter visual-fail shows only diff+fail rows', () => {
    renderList({ statusFilter: 'visual-fail' });
    expect(screen.queryByText('home')).toBeDefined();
    // resultDiff (mobile) present, resultPass (desktop, home) absent
    expect(screen.queryAllByText('mobile').length).toBeGreaterThan(0);
    expect(screen.queryByText('nav')).toBeNull();
    expect(screen.getByText('footer')).toBeDefined();
  });

  it('filter functional-fail shows the functional failure', () => {
    renderList({ statusFilter: 'functional-fail' });
    expect(screen.getByText('nav')).toBeDefined();
    expect(screen.queryByText('home')).toBeNull();
    expect(screen.queryByText('footer')).toBeNull();
  });

  it('filter pass shows only fully-passing rows', () => {
    renderList({ statusFilter: 'pass' });
    expect(screen.getByText('home')).toBeDefined();
    expect(screen.queryByText('nav')).toBeNull();
    expect(screen.queryByText('footer')).toBeNull();
  });

  it('viewport filter narrows results', () => {
    renderList({ viewportFilter: viewportMobile.id });
    // only resultDiff is on mobile
    expect(screen.queryByText('nav')).toBeNull();
    expect(screen.queryByText('footer')).toBeNull();
    expect(screen.getByText('home')).toBeDefined();
  });

  it('clicking a row calls onSelect with the result id', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByTestId(`result-row-${resultPass.id}`));
    expect(onSelect).toHaveBeenCalledWith(resultPass.id);
  });

  it('shows a size-mismatch warning icon with title', () => {
    renderList({ results: [result({ id: 'r-mismatch', sizeMismatch: true })] });
    const icon = screen.getByTitle('size mismatch');
    expect(icon).toBeDefined();
  });

  it('counts only non-ignored test-origin log entries in the badge', () => {
    const withLogs = result({
      id: 'r-logs',
      logEntries: [
        { id: 'l1', type: 'console', origin: 'test', message: 'a', url: null, httpStatus: null, stack: null, ignored: false, ignoreRuleId: null, timestamp: '' },
        { id: 'l2', type: 'console', origin: 'test', message: 'b', url: null, httpStatus: null, stack: null, ignored: true, ignoreRuleId: 'ir1', timestamp: '' },
        { id: 'l3', type: 'console', origin: 'reference', message: 'c', url: null, httpStatus: null, stack: null, ignored: false, ignoreRuleId: null, timestamp: '' },
      ],
    });
    renderList({ results: [withLogs] });
    const row = screen.getByTestId(`result-row-${withLogs.id}`);
    expect(within(row).getByText('1 log')).toBeDefined();
  });
});
