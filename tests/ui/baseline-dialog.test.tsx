// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BaselineDialog, type BaselineFormValues } from '@/components/baseline-dialog';
import { ApiClientError, type Baseline, type Viewport } from '@/lib/client';

afterEach(cleanup);

const viewports: Viewport[] = [
  { id: 'vp1', projectId: 'p1', name: 'mobile', width: 375, height: 812 },
  { id: 'vp2', projectId: 'p1', name: 'desktop', width: 1440, height: 900 },
];

function baseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    id: 'b1',
    projectId: 'p1',
    name: 'home',
    pagePath: '/home',
    elementSelector: '.hero',
    diffThreshold: 0.02,
    maskSelectors: ['.timestamp', '.ad-slot'],
    sourceType: 'capture',
    syncStatus: 'ok',
    targets: [
      { id: 't1', baselineId: 'b1', viewportId: 'vp1', versions: [] },
    ],
    ...overrides,
  };
}

// Controlled wrapper mirroring the real usage in projects/[id]/page.tsx — an
// external `open` boolean flipped by `onOpenChange`, so the dialog actually
// closes/stays open based on how `onSubmit`'s promise settles.
function Wrapper({
  onSubmit,
  editBaseline,
}: {
  onSubmit: (values: BaselineFormValues) => Promise<unknown>;
  editBaseline?: Baseline;
}) {
  const [open, setOpen] = useState(true);
  return (
    <BaselineDialog
      viewports={viewports}
      baseline={editBaseline}
      open={open}
      onOpenChange={setOpen}
      onSubmit={onSubmit}
    />
  );
}

describe('BaselineDialog', () => {
  it('parses one mask selector per line, dropping blank lines', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<Wrapper onSubmit={submit} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'home' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: '/home' } });
    fireEvent.change(screen.getByLabelText('Mask selectors (one per line)'), {
      target: { value: '.timestamp\n\n  .ad-slot  \n' },
    });
    fireEvent.click(screen.getByText('Create baseline'));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0].maskSelectors).toEqual(['.timestamp', '.ad-slot']);
  });

  it('prefills the form fields from the edited baseline', () => {
    render(<Wrapper onSubmit={vi.fn()} editBaseline={baseline()} />);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('home');
    expect((screen.getByLabelText('Page path') as HTMLInputElement).value).toBe('/home');
    expect((screen.getByLabelText('Element selector') as HTMLInputElement).value).toBe('.hero');
    expect((screen.getByLabelText('Diff threshold') as HTMLInputElement).value).toBe('0.02');
    expect((screen.getByLabelText('Mask selectors (one per line)') as HTMLTextAreaElement).value).toBe(
      '.timestamp\n.ad-slot'
    );
    expect(screen.getByText('Save changes')).toBeDefined();
  });

  it('hides the viewport checkboxes in edit mode', () => {
    render(<Wrapper onSubmit={vi.fn()} editBaseline={baseline()} />);
    expect(screen.queryByText('Viewports')).toBeNull();
    expect(screen.queryByLabelText('mobile 375×812')).toBeNull();
  });

  it('shows viewport checkboxes in create mode', () => {
    render(<Wrapper onSubmit={vi.fn()} />);
    expect(screen.getByText('Viewports')).toBeDefined();
    expect(screen.getByLabelText('mobile 375×812')).toBeDefined();
  });

  it('keeps the dialog open and shows the inline error when the submit is rejected', async () => {
    const submit = vi.fn().mockRejectedValue(new ApiClientError(409, 'a baseline for this page already exists'));
    render(<Wrapper onSubmit={submit} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'home' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: '/home' } });
    fireEvent.click(screen.getByText('Create baseline'));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(await screen.findByText('a baseline for this page already exists')).toBeDefined();
    // dialog stayed open — the name field (with the user's input still intact) is still in the document
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('home');
  });

  it('disables submit for a page path missing the leading slash', () => {
    render(<Wrapper onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'home' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: 'home' } });
    expect((screen.getByText('Create baseline') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: '/home' } });
    expect((screen.getByText('Create baseline') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables submit in create mode when no viewport is selected', () => {
    render(<Wrapper onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'home' } });
    fireEvent.change(screen.getByLabelText('Page path'), { target: { value: '/home' } });

    fireEvent.click(screen.getByLabelText('mobile 375×812'));
    fireEvent.click(screen.getByLabelText('desktop 1440×900'));
    expect((screen.getByText('Create baseline') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('mobile 375×812'));
    expect((screen.getByText('Create baseline') as HTMLButtonElement).disabled).toBe(false);
  });
});
