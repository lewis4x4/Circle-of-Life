import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeMedicalReviewers } from './EmployeeMedicalReviewers';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('clears prior employee reviewer names, options and grants before a failed next-employee request', async () => {
  let resolveSecond!: (response: { ok: boolean; json: () => Promise<{ error: string }> }) => void;
  const secondRequest = new Promise((resolve) => { resolveSecond = resolve; });
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({
    profiles: [{ id: 'reviewer-a', full_name: 'Employee A designated reviewer', app_role: 'manager' }],
    grants: [{ id: 'grant-a', user_id: 'reviewer-a', granted_at: '2026-09-01T12:00:00Z' }],
  }) }).mockReturnValueOnce(secondRequest);
  vi.stubGlobal('fetch', fetchMock);
  const onChange = vi.fn().mockResolvedValue(undefined);
  const view = render(<EmployeeMedicalReviewers staffId="employee-a" onChange={onChange} />);
  expect(await screen.findByText('Employee A designated reviewer · Access granted')).toBeVisible();
  expect(screen.getByRole('option', { name: 'Employee A designated reviewer · manager' })).toBeInTheDocument();
  view.rerender(<EmployeeMedicalReviewers staffId="employee-b" onChange={onChange} />);
  expect(screen.queryByText(/Employee A/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save access change' })).not.toBeInTheDocument();
  await act(async () => { resolveSecond({ ok: false, json: async () => ({ error: 'Employee B reviewer access denied.' }) }); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Employee B reviewer access denied.');
  expect(screen.queryByText(/Employee A/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Access granted/)).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/staff/employee-b/employee-file/requirements', { cache: 'no-store' });
  expect(onChange).not.toHaveBeenCalled();
});
