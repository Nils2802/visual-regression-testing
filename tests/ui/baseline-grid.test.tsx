// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BaselineGrid } from '@/components/baseline-grid';
import type { Baseline, BaselineDetail, Viewport } from '@/lib/client';

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

  it('shows a Sync button on figma baselines only', () => {
    render(
      <BaselineGrid
        baselines={[baseline({ id: 'b1', sourceType: 'figma' }), baseline({ id: 'b2', sourceType: 'capture' })]}
        viewports={viewports}
        onUpload={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button', { name: /sync/i })).toHaveLength(1);
  });

  it('clicking Sync calls the injected syncFn with the baseline id, then onSynced on success', async () => {
    const syncFn = vi.fn().mockResolvedValue({} as BaselineDetail);
    const onSynced = vi.fn();
    render(
      <BaselineGrid
        baselines={[baseline({ id: 'b1', sourceType: 'figma' })]}
        viewports={viewports}
        onUpload={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        syncFn={syncFn}
        onSynced={onSynced}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(syncFn).toHaveBeenCalledWith('b1');
    await waitFor(() => expect(onSynced).toHaveBeenCalled());
  });

  it('surfaces sync failure via onSyncError instead of throwing', async () => {
    const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
    const onSyncError = vi.fn();
    render(
      <BaselineGrid
        baselines={[baseline({ id: 'b1', sourceType: 'figma' })]}
        viewports={viewports}
        onUpload={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        syncFn={syncFn}
        onSyncError={onSyncError}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    await waitFor(() => expect(onSyncError).toHaveBeenCalled());
  });

  it('shows the syncError message text (truncated, full text in title) on sync-error baselines', () => {
    const longMessage = 'a'.repeat(200);
    render(
      <BaselineGrid
        baselines={[baseline({ syncStatus: 'sync-error', syncError: longMessage })]}
        viewports={viewports}
        onUpload={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const el = screen.getByTitle(longMessage);
    expect(el).toBeDefined();
    expect(el.className).toContain('text-status-fail');
  });
});
