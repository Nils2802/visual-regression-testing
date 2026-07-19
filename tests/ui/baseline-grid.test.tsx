// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BaselineGrid } from '@/components/baseline-grid';
import type { Baseline, Viewport } from '@/lib/client';

afterEach(cleanup);

const viewports: Viewport[] = [{ id: 'vp1', projectId: 'p', name: 'desktop', width: 1440, height: 900 }];

function baseline(overrides: Partial<Baseline>): Baseline {
  return {
    id: 'b1',
    projectId: 'p',
    name: 'home',
    pagePath: '/',
    elementSelector: null,
    diffThreshold: null,
    maskSelectors: [],
    sourceType: 'capture',
    syncStatus: 'ok',
    syncError: null,
    targets: [
      {
        id: 't1',
        baselineId: 'b1',
        viewportId: 'vp1',
        figmaFileKey: null,
        figmaNodeId: null,
        versions: [{ id: 'v1', targetId: 't1', imagePath: 'baselines/x.png', status: 'approved', isActive: true, createdAt: '' }],
      },
    ],
    ...overrides,
  };
}

describe('BaselineGrid', () => {
  it('shows active-version thumbnail when present, placeholder otherwise', () => {
    render(
      <BaselineGrid
        baselines={[baseline({}), baseline({ id: 'b2', name: 'nav', targets: [{ id: 't2', baselineId: 'b2', viewportId: 'vp1', figmaFileKey: null, figmaNodeId: null, versions: [] }] })]}
        viewports={viewports}
        onUpload={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain('/api/images/baselines/x.png');
    expect(screen.getByText('no baseline yet')).toBeDefined();
  });

  it('flags sync errors', () => {
    render(
      <BaselineGrid baselines={[baseline({ syncStatus: 'sync-error' })]} viewports={viewports} onUpload={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText('sync-error')).toBeDefined();
  });
});
