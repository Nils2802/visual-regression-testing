// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RunProgress } from '@/components/run-progress';
import type { RunDetail } from '@/lib/client';

afterEach(cleanup);

const environment = { id: 'e1', projectId: 'p1', name: 'production', baseUrl: 'https://example.com' };

function run(overrides: Partial<RunDetail>): RunDetail {
  return {
    id: 'run1',
    projectId: 'p1',
    environmentId: 'e1',
    referenceEnvironmentId: null,
    type: 'visual',
    trigger: 'manual',
    status: 'running',
    viewportIds: [],
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    environment,
    referenceEnvironment: null,
    results: [],
    ...overrides,
  };
}

describe('RunProgress', () => {
  it('shows a bare completed count with an indeterminate bar while the total is unknown (queued/running)', () => {
    render(<RunProgress run={run({ status: 'running' })} expectedCount={null} completedCount={3} />);
    expect(screen.getByText('3 results')).toBeDefined();
    expect(screen.queryByText(/\//)).toBeNull();
    expect(screen.getByTestId('run-progress-indeterminate')).toBeDefined();
  });

  it('uses singular "result" for a count of one', () => {
    render(<RunProgress run={run({ status: 'queued' })} expectedCount={null} completedCount={1} />);
    expect(screen.getByText('1 result')).toBeDefined();
  });

  it('shows completed/expected and a fractional bar once the total is known (terminal run)', () => {
    render(<RunProgress run={run({ status: 'done' })} expectedCount={5} completedCount={5} />);
    expect(screen.getByText('5/5')).toBeDefined();
    // terminal run: no progress bar of either kind
    expect(screen.queryByTestId('run-progress-indeterminate')).toBeNull();
  });

  it('renders no progress bar once the run is terminal, even mid-count', () => {
    render(<RunProgress run={run({ status: 'failed' })} expectedCount={2} completedCount={1} />);
    expect(screen.getByText('1/2')).toBeDefined();
    expect(screen.queryByTestId('run-progress-indeterminate')).toBeNull();
  });
});
