"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  useTransition,
  type ComponentProps,
  type MouseEvent,
} from "react";

import { cn } from "@/lib/utils";


/** Transient per-page callbacks only; no draft values or identity are persisted here. */
let routeTransitionPending = false;
const transitionListeners = new Set<() => void>();
let runShellTransition: ((work: () => void) => void) | null = null;
function setRouteTransitionPending(value: boolean) {
  if (routeTransitionPending === value) return;
  routeTransitionPending = value;
  for (const listener of transitionListeners) listener();
}
export function isRouteTransitionPending(): boolean { return routeTransitionPending; }
export function useRouteTransitionPending(): boolean {
  return useSyncExternalStore(listener => { transitionListeners.add(listener); return () => { transitionListeners.delete(listener); }; }, isRouteTransitionPending, () => false);
}
function sameRoute(href: string): boolean {
  const next = new URL(href, window.location.href);
  return next.origin === window.location.origin && next.pathname === window.location.pathname && next.search === window.location.search;
}
const routeLeaveGuards = new Set<(silent?: boolean) => boolean>();
export function registerRouteLeaveGuard(guard: (silent?: boolean) => boolean): () => void {
  routeLeaveGuards.add(guard);
  return () => { routeLeaveGuards.delete(guard); };
}
export function allowRouteLeave(href?: string, silent = false): boolean {
  if (href && typeof window !== 'undefined') {
    const next = new URL(href, window.location.href);
    const current = new URL(window.location.href);
    if (next.origin === current.origin && next.pathname === current.pathname && next.search === current.search) return true;
  }
  return [...routeLeaveGuards].every(guard => guard(silent));
}
// App Router has no public beforePopState API. Navigation events let us cancel
// an eligible browser traversal before its URL changes, without editing Next's
// private history state or guessing a history.go delta.
type BrowserNavigationEvent = Event & { destination: { url: string }; navigationType: string; downloadRequest?: string | null };
type BrowserNavigation = EventTarget;
export function supportsRouteLeaveProtection(): boolean {
  return typeof window !== 'undefined' && !!(window as Window & { navigation?: BrowserNavigation }).navigation;
}

function isStandUpPath(pathname: string): boolean { return pathname === '/admin/stand-up' || pathname.startsWith('/admin/stand-up/'); }
export function needsStandUpDocumentNavigation(href: string): boolean {
  if (typeof window === 'undefined' || supportsRouteLeaveProtection()) return false;
  const destination = new URL(href, window.location.href);
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) return false;
  return destination.origin === window.location.origin && (isStandUpPath(destination.pathname) || isStandUpPath(window.location.pathname));
}
/** Use before any shell router.push; a legacy browser gets real document history. */
export function navigateWithLeaveGuard(href: string, push: (href: string) => void): boolean {
  if (!allowRouteLeave(href)) return false;
  if (sameRoute(href)) { push(href); return true; }
  setRouteTransitionPending(true);
  try {
    if (needsStandUpDocumentNavigation(href)) window.location.assign(href);
    else if (runShellTransition) runShellTransition(() => push(href));
    else push(href);
  } catch (error) { setRouteTransitionPending(false); throw error; }
  return true;
}
/** null means navigation timing is unavailable, so safe entry cannot be established. */
export function standUpHasDocumentEntry(): boolean | null {
  if (supportsRouteLeaveProtection()) return true;
  const entry = performance.getEntriesByType('navigation')[0];
  if (!entry?.name) return null;
  const original = new URL(entry.name);
  return isStandUpPath(original.pathname) && original.origin === window.location.origin && original.pathname === window.location.pathname;
}

type NavigationPendingContextValue = {
  isNavigating: boolean;
  navigate: (href: string) => void;
};

const NavigationPendingContext = createContext<NavigationPendingContextValue | null>(null);

function isPrimaryNavigationClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.button === 0
  );
}

export function NavigationPendingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isRoutePending = useRouteTransitionPending();
  const wasPending = useRef(false);
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      navigateWithLeaveGuard(href, destination => router.push(destination));
    },
    [router],
  );

  useLayoutEffect(() => {
    runShellTransition = startTransition;
    return () => { if (runShellTransition === startTransition) runShellTransition = null; setRouteTransitionPending(false); };
  }, [startTransition]);
  useEffect(() => {
    if (isPending) wasPending.current = true;
    else if (wasPending.current) { wasPending.current = false; setRouteTransitionPending(false); }
  }, [isPending]);
  useEffect(() => { setRouteTransitionPending(false); }, [pathname]);
  useEffect(() => {
    const click = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      if (!allowRouteLeave(anchor.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
      else if (needsStandUpDocumentNavigation(anchor.href)) { event.preventDefault(); event.stopImmediatePropagation(); setRouteTransitionPending(true); window.location.assign(anchor.href); }
      else if (!anchor.hasAttribute('data-haven-nav-link') && !sameRoute(anchor.href)) setRouteTransitionPending(true);
    };
    const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
    const navigate = (raw: Event) => {
      const event = raw as BrowserNavigationEvent;
      // Push/replace from Next is already guarded before router.push. The native
      // event may fire at commit time, so it must not second-guess a route whose
      // React transition was previously allowed. Browser Back/Forward is earlier.
      if (event.navigationType !== 'traverse' || event.downloadRequest != null) return;
      if (event.cancelable && !allowRouteLeave(event.destination.url)) event.preventDefault();
      else if (!sameRoute(event.destination.url)) setRouteTransitionPending(true);
    };
    document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', navigate);
    const settled = () => setRouteTransitionPending(false);
    navigation?.addEventListener('navigateerror', settled);
    navigation?.addEventListener('navigatesuccess', settled);
    return () => { document.removeEventListener('click', click, true); navigation?.removeEventListener('navigate', navigate); navigation?.removeEventListener('navigateerror', settled); navigation?.removeEventListener('navigatesuccess', settled); };
  }, []);

  return (
    <NavigationPendingContext.Provider value={{ isNavigating: isPending || isRoutePending, navigate }}>
      {children}
    </NavigationPendingContext.Provider>
  );
}

export function useNavigationPending(): NavigationPendingContextValue {
  const ctx = useContext(NavigationPendingContext);
  if (!ctx) {
    throw new Error("useNavigationPending must be used within NavigationPendingProvider");
  }
  return ctx;
}

export function NavPendingIndicator({ className }: { className?: string }) {
  const { isNavigating } = useNavigationPending();

  return (
    <div
      data-testid="admin-navigation-feedback"
      role="progressbar"
      aria-hidden={!isNavigating}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={isNavigating ? "Loading page" : undefined}
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15",
        className,
      )}
    >
      <div
        className={cn(
          "h-full w-1/3 bg-primary transition-opacity duration-150",
          isNavigating ? "animate-[haven-nav-pending_1.1s_ease-in-out_infinite] opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

type HavenNavLinkProps = ComponentProps<typeof Link>;

/** Internal admin link — routes through a transition so pending UI shows immediately. */
export function HavenNavLink({ href, onClick, ...props }: HavenNavLinkProps) {
  const ctx = useContext(NavigationPendingContext);
  const hrefString = typeof href === "string" ? href : undefined;

  return (
    <Link
      href={href}
      data-haven-nav-link
      onClick={(event) => {
        onClick?.(event);
        if (ctx && hrefString && (!props.target || props.target === '_self') && !props.download && isPrimaryNavigationClick(event)) {
          event.preventDefault();
          ctx.navigate(hrefString);
        }
      }}
      {...props}
    />
  );
}
