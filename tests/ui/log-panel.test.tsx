// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { LogPanel } from '@/components/log-panel';
import { ApiClientError, type LogEntry } from '@/lib/client';

afterEach(cleanup);

function entry(overrides: Partial<LogEntry>): LogEntry {
  return {
    id: 'e1',
    type: 'console-error',
    origin: 'test',
    message: 'something went wrong',
    url: null,
    httpStatus: null,
    stack: null,
    ignored: false,
    ignoreRuleId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('LogPanel', () => {
  it('groups entries by type in LOG_TYPES order with a mono count per group, omitting empty groups', () => {
    render(
      <LogPanel
        entries={[
          entry({ id: 'e1', type: 'http-error', message: 'a' }),
          entry({ id: 'e2', type: 'console-error', message: 'b' }),
          entry({ id: 'e3', type: 'console-error', message: 'c' }),
        ]}
        ignoreFn={vi.fn()}
        onIgnored={vi.fn()}
      />
    );

    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    // console-error comes before http-error in LOG_TYPES order
    expect(headings.indexOf('console-error')).toBeLessThan(headings.indexOf('http-error'));
    // no page-error/network-error groups rendered since no entries of that type
    expect(headings).not.toContain('page-error');
    expect(headings).not.toContain('network-error');

    const consoleErrorGroup = screen.getByRole('heading', { name: 'console-error' }).closest('[data-testid^="log-group-"]') as HTMLElement;
    expect(within(consoleErrorGroup).getByText('2')).toBeDefined();
  });

  it('hides ignored entries under a per-group toggle until clicked', () => {
    render(
      <LogPanel
        entries={[
          entry({ id: 'e1', message: 'visible one', ignored: false }),
          entry({ id: 'e2', message: 'hidden one', ignored: true }),
        ]}
        ignoreFn={vi.fn()}
        onIgnored={vi.fn()}
      />
    );

    expect(screen.getByText('visible one')).toBeDefined();
    expect(screen.queryByText('hidden one')).toBeNull();

    const toggle = screen.getByText('1 ignored');
    fireEvent.click(toggle);
    expect(screen.getByText('hidden one')).toBeDefined();
  });

  it('shows a reference tag and no ignore button for reference-origin entries', () => {
    render(
      <LogPanel
        entries={[entry({ id: 'e1', message: 'from reference capture', origin: 'reference' })]}
        ignoreFn={vi.fn()}
        onIgnored={vi.fn()}
      />
    );

    expect(screen.getByText('reference')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'ignore' })).toBeNull();
  });

  it('shows the ignore button for a non-reference entry', () => {
    render(
      <LogPanel
        entries={[entry({ id: 'e1', message: 'test-origin entry', origin: 'test' })]}
        ignoreFn={vi.fn()}
        onIgnored={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'ignore' })).toBeDefined();
  });

  it('calls ignoreFn with (id, reason) after typing a reason and confirming, then calls onIgnored', async () => {
    const ignoreFn = vi.fn().mockResolvedValue({ rule: {}, entry: entry({ id: 'e1', ignored: true }) });
    const onIgnored = vi.fn();
    render(
      <LogPanel entries={[entry({ id: 'e1', message: 'noisy console error' })]} ignoreFn={ignoreFn} onIgnored={onIgnored} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'ignore' }));
    fireEvent.change(screen.getByLabelText('Ignore reason'), { target: { value: 'known flaky third-party script' } });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    await waitFor(() => expect(ignoreFn).toHaveBeenCalledWith('e1', 'known flaky third-party script'));
    await waitFor(() => expect(onIgnored).toHaveBeenCalled());
  });

  it('surfaces an ApiClientError from ignoreFn inline', async () => {
    const ignoreFn = vi.fn().mockRejectedValue(new ApiClientError(409, 'already ignored'));
    render(
      <LogPanel entries={[entry({ id: 'e1', message: 'noisy console error' })]} ignoreFn={ignoreFn} onIgnored={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'ignore' }));
    fireEvent.change(screen.getByLabelText('Ignore reason'), { target: { value: 'reason' } });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    expect(await screen.findByText('already ignored')).toBeDefined();
  });

  it('shows httpStatus and url when set', () => {
    render(
      <LogPanel
        entries={[entry({ id: 'e1', message: 'bad request', url: 'https://example.com/api', httpStatus: 404 })]}
        ignoreFn={vi.fn()}
        onIgnored={vi.fn()}
      />
    );

    expect(screen.getByText('404')).toBeDefined();
    expect(screen.getByText('https://example.com/api')).toBeDefined();
  });

  it('expands a truncated message on click', () => {
    const longMessage = 'a'.repeat(300);
    render(<LogPanel entries={[entry({ id: 'e1', message: longMessage })]} ignoreFn={vi.fn()} onIgnored={vi.fn()} />);

    const messageEl = screen.getByText(longMessage);
    expect(messageEl.className).toContain('line-clamp-1');
    fireEvent.click(messageEl);
    expect(messageEl.className).not.toContain('line-clamp-1');
  });

  it('renders nothing but a placeholder when there are no entries', () => {
    render(<LogPanel entries={[]} ignoreFn={vi.fn()} onIgnored={vi.fn()} />);
    expect(screen.getByText('No log entries.')).toBeDefined();
  });
});
