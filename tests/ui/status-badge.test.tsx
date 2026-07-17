// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('renders the value with the matching status class', () => {
    render(<StatusBadge kind="visual" value="diff" />);
    const badge = screen.getByText('diff');
    expect(badge.className).toContain('status-diff');
  });

  it('falls back to muted styling for unknown values', () => {
    render(<StatusBadge kind="run" value="queued" />);
    expect(screen.getByText('queued').className).toContain('muted');
  });
});
