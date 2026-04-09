"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CalendarHeart,
  CreditCard,
  Loader2,
  LogOut,
  MessageSquare,
  UserCircle2,
  HeartPulse
} from "lucide-react";
import { useTheme } from "next-themes";

import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const themeSet = useRef(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  useEffect(() => {
    if (!themeSet.current) {
      setTheme("light");
      themeSet.current = true;
    }
  }, [setTheme]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setSessionEmail(data.session?.user?.email ?? null);
      } catch {
        if (!cancelled) setSessionEmail(null);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setSessionEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="family-shell min-h-screen text-stone-900 flex flex-col font-sans selection:bg-rose-100 selection:text-rose-900 relative">
      
      {/* Floating Top-Right Utilities */}
      <div className="absolute top-4 right-4 md:top-6 md:right-6 z-50 flex items-center gap-2">
         <button className="relative p-3 rounded-full bg-stone-50/60 backdrop-blur-xl border border-white/60 shadow-[0_4px_20px_rgb(0,0,0,0.05)] text-stone-600 hover:text-stone-900 tap-responsive transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-rose-400"></span>
         </button>

         <DropdownMenu>
            <DropdownMenuTrigger className="p-3 rounded-full bg-stone-50/60 backdrop-blur-xl border border-white/60 shadow-[0_4px_20px_rgb(0,0,0,0.05)] text-stone-600 hover:text-stone-900 tap-responsive transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50">
               <UserCircle2 className="w-5 h-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 glass-card-light rounded-2xl p-2 mt-2 border-white/70 shadow-lg">
               <DropdownMenuGroup>
                 <DropdownMenuLabel className="font-medium text-stone-600">
                    {sessionEmail ?? "Family Portal"}
                 </DropdownMenuLabel>
                 <DropdownMenuSeparator className="bg-stone-200/50 my-1" />
                 <DropdownMenuItem
                    variant="destructive"
                    className="cursor-pointer rounded-xl font-medium focus:bg-rose-50 focus:text-rose-600 tap-responsive"
                    disabled={signingOut}
                    onClick={() => void handleSignOut()}
                 >
                    {signingOut ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing out…
                      </>
                    ) : (
                      <>
                        <LogOut className="mr-2 h-4 w-4" />
                        Sign out
                      </>
                    )}
                  </DropdownMenuItem>
               </DropdownMenuGroup>
            </DropdownMenuContent>
         </DropdownMenu>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 w-full pb-32 relative z-10">
        {children}
      </main>

      {/* Floating iPadOS Style Dock */}
      <div className="fixed bottom-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
         <nav className="glass-card-light pointer-events-auto rounded-[2.5rem] px-2 py-2 flex items-center gap-1 shadow-[0_12px_40px_rgb(0,0,0,0.08)] bg-white/70">
           <DockTab
              href="/family"
              label="Journal"
              icon={<CalendarHeart className="h-6 w-6" />}
              active={pathname === "/family" || pathname === "/family/"}
            />
            <DockTab
              href="/family/calendar"
              label="Calendar"
              icon={<CalendarDays className="h-6 w-6" />}
              active={pathname.startsWith("/family/calendar")}
            />
            <DockTab
              href="/family/care-plan"
              label="Care Team"
              icon={<HeartPulse className="h-6 w-6" />}
              active={pathname.startsWith("/family/care-plan")}
            />
            <DockTab
              href="/family/billing"
              label="Billing"
              icon={<CreditCard className="h-6 w-6" />}
              active={
                pathname.startsWith("/family/billing") ||
                pathname.startsWith("/family/invoices") ||
                pathname.startsWith("/family/payments")
              }
            />
            <DockTab
              href="/family/messages"
              label="Messages"
              icon={<MessageSquare className="h-6 w-6" />}
              active={pathname.startsWith("/family/messages")}
            />
         </nav>
      </div>

    </div>
  );
}

function DockTab({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`relative flex flex-col items-center justify-center gap-1 w-16 h-16 md:w-[4.5rem] md:h-[4.5rem] rounded-[1.8rem] tap-responsive transition-all ${
        active 
          ? "bg-white shadow-[0_2px_15px_rgb(0,0,0,0.04)] text-stone-900 border border-white" 
          : "text-stone-500 hover:text-stone-800 hover:bg-white/40 border border-transparent"
      }`}
    >
      <div className={`${active ? "text-rose-500 scale-110 drop-shadow-sm" : "scale-100 text-stone-400"} transition-all duration-300`}>
        {icon}
      </div>
      <span className={`text-[10px] tracking-wide transition-all ${active ? "font-bold text-stone-800" : "font-medium"}`}>{label}</span>
      
      {/* Active Dot Indicator underneath */}
      {active && (
         <div className="absolute -bottom-[2px] w-1 h-1 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]"></div>
      )}
    </Link>
  );
}
