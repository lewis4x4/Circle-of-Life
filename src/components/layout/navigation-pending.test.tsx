import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Link from 'next/link';
import type { Window as HappyWindow } from 'happy-dom';
import type { ComponentProps } from 'react';
import { NavigationPendingProvider, HavenNavLink, useNavigationPending, registerRouteLeaveGuard, navigateWithLeaveGuard, standUpHasDocumentEntry, useRouteTransitionPending } from './navigation-pending';

const mocks = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn(), linkPrefetch: [] as unknown[] }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/stand-up', useRouter: () => ({ push: mocks.push, prefetch: mocks.prefetch }) }));
vi.mock('next/link', () => ({ default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: unknown }) => { mocks.linkPrefetch.push(prefetch); return <a {...props} />; } }));
let removeGuard = () => {};
const originalHref = window.location.href;
const navigationSettings = (window as unknown as HappyWindow).happyDOM.settings.navigation;
const originalNavigationSettings = { ...navigationSettings };
beforeEach(() => {
  mocks.push.mockReset();
  mocks.prefetch.mockReset();
  mocks.linkPrefetch.length = 0;
  // Assertions concern event cancellation/router dispatch; never perform real
  // network navigation from the DOM-only test environment.
  Object.assign(navigationSettings, { disableMainFrameNavigation: true, disableChildPageNavigation: true, disableFallbackToSetURL: true });
  window.history.replaceState(null, '', '/admin/stand-up');
  Object.defineProperty(window, 'navigation', { configurable: true, value: new EventTarget() });
});
afterEach(() => { cleanup(); removeGuard(); removeGuard = () => {}; vi.restoreAllMocks(); window.history.replaceState(null, '', originalHref); Object.assign(navigationSettings, originalNavigationSettings); });
function PendingForm() { const pending = useRouteTransitionPending(); return <input aria-label="Route-bound entry" disabled={pending} />; }
function Routes() {
  const { navigate } = useNavigationPending();
  return <><PendingForm /><HavenNavLink href="/admin/facilities">Sidebar facilities</HavenNavLink><HavenNavLink href="/admin/reports" target="_blank">Open reports in new tab</HavenNavLink><Link href="/admin/staff">Plain staff link</Link><button onClick={() => navigate('/admin/executive')}>Palette selection</button></>;
}
function setupGuard() { const guard = vi.fn(() => false); removeGuard = registerRouteLeaveGuard(guard); render(<NavigationPendingProvider><Routes /></NavigationPendingProvider>); return guard; }
describe('shared pending navigation protection', () => {
  it('blocks actual HavenNavLink, plain links and provider palette navigation before router.push', () => {
    const guard = setupGuard();
    fireEvent.click(screen.getByText('Sidebar facilities')); fireEvent.click(screen.getByText('Plain staff link')); fireEvent.click(screen.getByText('Palette selection'));
    expect(guard).toHaveBeenCalledTimes(3); expect(mocks.push).not.toHaveBeenCalled();
    expect(navigateWithLeaveGuard('/admin/settings', mocks.push)).toBe(false); expect(mocks.push).not.toHaveBeenCalled();
  });
  it('allows modified clicks and a new-tab target while retaining the old page', () => {
    const guard = setupGuard();
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }); screen.getByText('Sidebar facilities').dispatchEvent(modified);
    const newTab = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }); screen.getByText('Open reports in new tab').dispatchEvent(newTab);
    expect(modified.defaultPrevented).toBe(false); expect(newTab.defaultPrevented).toBe(false); expect(guard).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  });
  it('asks once when a guarded sidebar navigation is accepted', () => {
    const guard = vi.fn(() => true);
    removeGuard = registerRouteLeaveGuard(guard);
    render(<NavigationPendingProvider><Routes /></NavigationPendingProvider>);
    fireEvent.click(screen.getByText('Sidebar facilities'));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/admin/facilities');
  });
  it('cancels eligible browser traversal before any history mutation and releases when clean', () => {
    setupGuard();
    const navigation = (window as unknown as { navigation: EventTarget }).navigation;
    const historySpy = vi.spyOn(window.history, 'go');
    const event = new Event('navigate', { cancelable: true }); Object.assign(event, { navigationType: 'traverse', destination: { url: new URL('/admin/executive', window.location.origin).href }, downloadRequest: null });
    act(() => navigation.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true); expect(historySpy).not.toHaveBeenCalled();
    removeGuard(); const permitted = new Event('navigate', { cancelable: true }); Object.assign(permitted, { navigationType: 'traverse', destination: { url: new URL('/admin/executive', window.location.origin).href } });
    act(() => navigation.dispatchEvent(permitted)); expect(permitted.defaultPrevented).toBe(false);
  });
  it('does not override a non-cancelable browser escape or modify Next private history state', () => {
    const guard = setupGuard(); const event = new Event('navigate', { cancelable: false }); Object.assign(event, { navigationType: 'traverse', destination: { url: 'https://example.com' } });
    act(() => (window as unknown as { navigation: EventTarget }).navigation.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(guard).not.toHaveBeenCalled();
  });
  it('freezes existing fields before a slow accepted link commits, then releases on navigation abort', () => {
    render(<NavigationPendingProvider><Routes /></NavigationPendingProvider>);
    expect(screen.getByLabelText('Route-bound entry')).toBeEnabled();
    fireEvent.click(screen.getByText('Plain staff link'));
    expect(screen.getByLabelText('Route-bound entry')).toBeDisabled();
    act(() => (window as unknown as { navigation: EventTarget }).navigation.dispatchEvent(new Event('navigateerror')));
    expect(screen.getByLabelText('Route-bound entry')).toBeEnabled();
  });
  it('uses full document navigation in legacy browsers after leave checks, and detects SPA entry', () => {
    Object.defineProperty(window, 'navigation', { configurable: true, value: undefined });
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    expect(navigateWithLeaveGuard('/admin/executive', mocks.push)).toBe(true); expect(assign).toHaveBeenCalledWith('/admin/executive'); expect(mocks.push).not.toHaveBeenCalled();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: new URL('/admin/executive', window.location.origin).href } as PerformanceEntry]);
    expect(standUpHasDocumentEntry()).toBe(false);
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ name: window.location.href } as PerformanceEntry]); expect(standUpHasDocumentEntry()).toBe(true);
    removeGuard = registerRouteLeaveGuard(() => false); expect(navigateWithLeaveGuard('/admin/facilities', mocks.push)).toBe(false); expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe('HavenNavLink prefetch (COL-674)', () => {
  it('does not prefetch on sight, and prefetches once on hover or focus', () => {
    render(<NavigationPendingProvider><HavenNavLink href="/admin/referrals">Pipeline</HavenNavLink></NavigationPendingProvider>);
    expect(mocks.linkPrefetch.at(-1)).toBe(false);
    expect(mocks.prefetch).not.toHaveBeenCalled();
    const link = screen.getByText('Pipeline');
    fireEvent.mouseEnter(link);
    fireEvent.focus(link);
    fireEvent.mouseEnter(link);
    expect(mocks.prefetch).toHaveBeenCalledTimes(1);
    expect(mocks.prefetch).toHaveBeenCalledWith('/admin/referrals');
  });

  it('leaves an explicit prefetch choice to Next', () => {
    render(<NavigationPendingProvider><HavenNavLink href="/admin/residents" prefetch>Residents</HavenNavLink></NavigationPendingProvider>);
    expect(mocks.linkPrefetch.at(-1)).toBe(true);
    fireEvent.mouseEnter(screen.getByText('Residents'));
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });
});
