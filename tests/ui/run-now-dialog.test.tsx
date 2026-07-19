// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { RunNowDialog } from '@/components/run-now-dialog';
import { ApiClientError, type ProjectDetail } from '@/lib/client';

afterEach(cleanup);

const project: ProjectDetail = {
  id: 'p1', name: 'demo', diffThreshold: 0.01, createdAt: '', figmaTokenSet: false,
  environments: [
    { id: 'e1', projectId: 'p1', name: 'staging', baseUrl: 'http://s' },
    { id: 'e2', projectId: 'p1', name: 'production', baseUrl: 'http://p' },
  ],
  viewports: [
    { id: 'v1', projectId: 'p1', name: 'mobile', width: 375, height: 812 },
    { id: 'v2', projectId: 'p1', name: 'desktop', width: 1440, height: 900 },
  ],
  baselines: [],
};

function setup(triggerFn = vi.fn().mockResolvedValue({ id: 'r1' })) {
  render(<RunNowDialog project={project} onTriggered={vi.fn()} triggerFn={triggerFn} defaultOpen />);
  return triggerFn;
}

describe('RunNowDialog', () => {
  it('requires a reference environment for compare runs', () => {
    setup();
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByLabelText('compare'));
    const submit = screen.getByText('Start run') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('production'));
    expect(submit.disabled).toBe(false);
  });

  it('sends explicit viewportIds only for a subset', async () => {
    const trigger = setup();
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByLabelText('desktop 1440×900')); // uncheck
    fireEvent.click(screen.getByText('Start run'));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(trigger.mock.calls[0][1]).toMatchObject({ environmentId: 'e1', viewportIds: ['v1'] });
  });

  it('sends undefined viewportIds when all are selected', async () => {
    const trigger = setup();
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByText('Start run'));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(trigger.mock.calls[0][1].viewportIds).toBeUndefined();
  });

  it('surfaces a trigger failure inline instead of swallowing it', async () => {
    const trigger = vi.fn().mockRejectedValue(new ApiClientError(500, 'environment is unreachable'));
    setup(trigger);
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByText('Start run'));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(await screen.findByText('environment is unreachable')).toBeDefined();
  });
});
