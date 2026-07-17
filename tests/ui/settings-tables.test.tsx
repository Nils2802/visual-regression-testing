// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ViewportsTable } from '@/components/settings/viewports-table';
import { IgnoreRulesTable } from '@/components/settings/ignore-rules-table';

afterEach(cleanup);

describe('ViewportsTable', () => {
  it('quick-adds presets', () => {
    const onAdd = vi.fn();
    render(<ViewportsTable items={[]} onAdd={onAdd} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('mobile 375×812'));
    expect(onAdd).toHaveBeenCalledWith({ name: 'mobile', width: 375, height: 812 });
  });

  it('deletes a row', () => {
    const onDelete = vi.fn();
    render(
      <ViewportsTable
        items={[{ id: 'v1', projectId: 'p', name: 'desktop', width: 1440, height: 900 }]}
        onAdd={vi.fn()}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByLabelText('Delete desktop'));
    expect(onDelete).toHaveBeenCalledWith('v1');
  });
});

describe('IgnoreRulesTable', () => {
  it('disables add until reason and one criterion are set', () => {
    render(<IgnoreRulesTable items={[]} onAdd={vi.fn()} onDelete={vi.fn()} />);
    const button = screen.getByText('Add rule') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'third-party noise' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Message pattern'), { target: { value: 'analytics' } });
    expect(button.disabled).toBe(false);
  });
});
