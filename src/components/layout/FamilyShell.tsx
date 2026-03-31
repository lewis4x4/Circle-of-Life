"use client";

import React, { useEffect } from "react";
import { MessageSquare, Bell, UserCircle2 } from "lucide-react";
import { useTheme } from "next-themes";

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();

  // Family shell strictly operates in light mode for the hospitality feel
  useEffect(() => {
    setTheme("light");
  }, [setTheme]);

  return (
    <div className="family-shell min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans">
      {/* Hospitality Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-serif font-medium text-stone-800 tracking-tight">Haven</span>
            <span className="w-1 h-1 rounded-full bg-stone-300"></span>
            <span className="text-stone-600 font-medium">Sarah Davis</span>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="text-stone-400 hover:text-stone-600 tap-responsive" aria-label="Messages">
              <MessageSquare className="w-5 h-5" />
            </button>
            <button className="relative text-stone-400 hover:text-stone-600 tap-responsive" aria-label="Notifications">
              <Bell className="w-5 h-5" />
            </button>
            <button className="text-stone-300 hover:text-stone-500 tap-responsive" aria-label="Profile">
              <UserCircle2 className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* Navigation Tabs - Desktop */}
        <div className="hidden md:flex max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-x-8">
          <div className="py-3 border-b-2 border-orange-600 text-stone-900 font-medium text-sm">Today</div>
          <div className="py-3 border-b-2 border-transparent text-stone-500 hover:text-stone-700 font-medium text-sm cursor-pointer tap-responsive">Care Plan</div>
          <div className="py-3 border-b-2 border-transparent text-stone-500 hover:text-stone-700 font-medium text-sm cursor-pointer tap-responsive">Calendar</div>
          <div className="py-3 border-b-2 border-transparent text-stone-500 hover:text-stone-700 font-medium text-sm cursor-pointer tap-responsive">Documents</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {children}
      </main>

      {/* Mobile Bottom Navigation (only visible md and below) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] bg-white border-t border-stone-200 flex justify-around items-center px-4 pb-[env(safe-area-inset-bottom)] pt-1 z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
        <div className="flex flex-col items-center justify-center text-orange-600 tap-responsive">
          <span className="text-xs font-semibold">Today</span>
        </div>
        <div className="flex flex-col items-center justify-center text-stone-400 tap-responsive">
          <span className="text-xs font-medium">Care</span>
        </div>
        <div className="flex flex-col items-center justify-center text-stone-400 tap-responsive">
          <span className="text-xs font-medium">Chat</span>
        </div>
      </nav>
    </div>
  );
}
