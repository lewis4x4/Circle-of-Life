"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ComponentProps,
  type MouseEvent,
} from "react";

import { cn } from "@/lib/utils";

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
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  return (
    <NavigationPendingContext.Provider value={{ isNavigating: isPending, navigate }}>
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
      onClick={(event) => {
        if (ctx && hrefString && isPrimaryNavigationClick(event)) {
          event.preventDefault();
          ctx.navigate(hrefString);
        }
        onClick?.(event);
      }}
      {...props}
    />
  );
}
