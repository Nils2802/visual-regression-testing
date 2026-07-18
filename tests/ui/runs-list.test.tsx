// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RunsList } from '@/components/runs-list';
import type { RunSummary } from '@/lib/client';

afterEach(cleanup);

const environment = { id: 'e1', name: 'production' };

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    id: 'run1',
    projectId: 'p1',
    environmentId: 'e1',
    referenceEnvironmentId: null,
    type: 'visual',
    trigger: 'manual',
    status: 'done',
    viewportIds: [],
    expectedResultCount: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    environment,
    resultCount: 0,
    failedResultCount: 0,
    ...overrides,
  };
}

describe('RunsList', () => {
  it('uses expectedResultCount as the denominator when present', () => {
    const run = makeRun({ status: 'running', resultCount: 3, failedResultCount: 1, expectedResultCount: 50 });
    render(<RunsList runs={[run]} />);
    expect(screen.getByText('1/50')).toBeDefined();
  });

  it('falls back to resultCount when expectedResultCount is null', () => {
    const run = makeRun({ resultCount: 4, failedResultCount: 0, expectedResultCount: null });
    render(<RunsList runs={[run]} />);
    expect(screen.getByText('0/4')).toBeDefined();
  });
});
