import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotFeedbackLauncher } from './PilotFeedbackLauncher';
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/stand-up' }));
afterEach(cleanup);
describe('Pilot feedback launcher', () => {
  it('preserves the existing uncontrolled launcher behavior', async () => {
    render(<PilotFeedbackLauncher shellKind="admin" compact />);
    fireEvent.click(screen.getByRole('button', { name: 'Pilot feedback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pilot Feedback' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /^Close$/ })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Pilot feedback' })).toBeInTheDocument();
  });
  it('supports an external trigger without losing its dialog when that trigger disappears', async () => {
    const returnFocus = createRef<HTMLButtonElement>();
    function Controlled() {
      const [open, setOpen] = useState(false);
      return <><button ref={returnFocus}>More actions</button>{!open && <button onClick={() => setOpen(true)}>Feedback from popover</button>}<PilotFeedbackLauncher shellKind="admin" hideTrigger open={open} onOpenChange={setOpen} returnFocusRef={returnFocus} /></>;
    }
    render(<Controlled />); fireEvent.click(screen.getByRole('button', { name: 'Feedback from popover' }));
    expect(screen.queryByRole('button', { name: 'Feedback from popover' })).not.toBeInTheDocument();
    const dialog = await screen.findByRole('dialog', { name: 'Pilot Feedback' });
    expect(within(dialog).getByLabelText('Category')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(returnFocus.current).toHaveFocus();
  });
});
