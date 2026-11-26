import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./usage/UsageView', () => ({ UsageView: () => <p>contenido de uso</p> }));

const { DashboardPage } = await import('./DashboardPage');

describe('DashboardPage', () => {
  it('shows the Dashboard title and the usage tab, selected, with its content', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    const tab = screen.getByRole('tab', { name: 'Uso y costos' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('contenido de uso')).toBeTruthy();
  });

  it('keeps the tab bar even with a single tab, so more can be added per client', () => {
    render(<DashboardPage />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tablist', { name: 'Secciones del Dashboard' })).toBeTruthy();
  });
});
