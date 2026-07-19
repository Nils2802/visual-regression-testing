// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProjectCard } from '@/components/project-card';
import type { ProjectSummary } from '@/lib/client';

afterEach(cleanup);

const base: ProjectSummary = {
  id: 'p1',
  name: 'marketing-site',
  diffThreshold: 0.01,
  createdAt: new Date().toISOString(),
  lastRun: { id: 'r1', status: 'done', createdAt: new Date().toISOString() },
  failedResultCount: 3,
  figmaTokenSet: false,
  syncBeforeRun: false,
};

describe('ProjectCard', () => {
  it('shows name, last-run status, and failing count', () => {
    render(<ProjectCard project={base} />);
    expect(screen.getByText('marketing-site')).toBeDefined();
    expect(screen.getByText('done')).toBeDefined();
    expect(screen.getByText('3 failing')).toBeDefined();
  });

  it('omits failing badge at zero and handles no runs', () => {
    render(<ProjectCard project={{ ...base, lastRun: null, failedResultCount: 0 }} />);
    expect(screen.queryByText(/failing/)).toBeNull();
    expect(screen.getByText('no runs yet')).toBeDefined();
  });

  it('links to the project page', () => {
    render(<ProjectCard project={base} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects/p1');
  });
});
