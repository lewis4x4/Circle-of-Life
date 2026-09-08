import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeTrainingEvidence } from './EmployeeTrainingEvidence';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('removes employee A training immediately on navigation and keeps it absent when employee B fails to load', async () => {
  let rejectSecond!: (reason: Error) => void;
  const secondRequest = new Promise((_, reject) => { rejectSecond = reject; });
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({
    completions: [{ id: 'employee-a-course', completed_at: '2026-09-01', expires_at: null, training_programs: { name: 'Employee A medication course' } }],
    certificates: [{ id: 'employee-a-certificate', certification_name: 'Employee A CPR certificate', issue_date: '2026-09-01', expiration_date: null, status: 'current' }],
    demonstrations: [{ id: 'employee-a-demonstration', status: 'passed' }],
  }) }).mockReturnValueOnce(secondRequest);
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<EmployeeTrainingEvidence staffId="employee-a" canManage />);
  await userEvent.setup().click(screen.getByText('Existing training and credentials'));
  expect(await screen.findByText(/Employee A medication course/)).toBeVisible();
  expect(screen.getByText('Evidence reference: competency:employee-a-demonstration')).toBeVisible();
  view.rerender(<EmployeeTrainingEvidence staffId="employee-b" canManage />);
  expect(screen.queryByText(/Employee A/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Evidence reference:/)).not.toBeInTheDocument();
  await act(async () => { rejectSecond(new Error('Employee B evidence unavailable.')); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Employee B evidence unavailable.');
  expect(screen.queryByText(/Employee A/)).not.toBeInTheDocument();
  expect(screen.queryByText(/employee-a-/)).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/staff/employee-b/employee-file/training', { cache: 'no-store' });
});
