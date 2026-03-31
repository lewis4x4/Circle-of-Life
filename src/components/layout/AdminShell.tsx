"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, UserCircle2, ChevronDown, Check } from "lucide-react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { selectedFacilityId, availableFacilities, setSelectedFacility } = useFacilityStore();
  const currentFacility = availableFacilities.find(f => f.id === selectedFacilityId) || availableFacilities[0];

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white shadow-soft hidden lg:flex lg:flex-col">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <span className="text-lg font-semibold font-display text-slate-900 tracking-tight">Haven Admin</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {[
            { href: "/admin", label: "Dashboard", enabled: true },
            { href: "/admin/residents", label: "Residents", enabled: true },
            { href: "/admin/incidents", label: "Incidents", enabled: true },
            { href: "#", label: "Staff", enabled: false },
            { href: "#", label: "Billing", enabled: false },
            { href: "#", label: "Daily Operations", enabled: false },
          ].map((item) => {
            const isActive = pathname === item.href;
            if (!item.enabled) {
              return (
                <span
                  key={item.label}
                  className="block cursor-not-allowed rounded-md px-2 py-2 text-sm font-medium text-slate-400"
                >
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-2 py-2 text-sm font-medium tap-responsive ${
                  isActive
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 lg:px-8 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-200 bg-white shadow-sm cursor-pointer hover:bg-slate-50 tap-responsive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-slate-50">
                <span className="text-sm font-medium text-slate-900 truncate max-w-[150px]">
                  {selectedFacilityId ? currentFacility?.name : "Select Facility..."}
                </span>
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[220px]">
                <DropdownMenuItem 
                  onClick={() => setSelectedFacility(null)}
                  className="font-medium flex justify-between items-center cursor-pointer"
                >
                  All Facilities
                  {selectedFacilityId === null && <Check className="h-4 w-4 text-emerald-600" />}
                </DropdownMenuItem>
                
                {availableFacilities.map((facility) => (
                  <DropdownMenuItem 
                    key={facility.id}
                    onClick={() => setSelectedFacility(facility.id)}
                    className="flex justify-between items-center cursor-pointer"
                  >
                    {facility.name}
                    {selectedFacilityId === facility.id && <Check className="h-4 w-4 text-emerald-600" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500 tap-responsive" aria-label="Search">
              <Search className="w-5 h-5" />
            </button>
            <button className="relative p-2 rounded-full hover:bg-slate-100 text-slate-500 tap-responsive" aria-label="Notifications">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-600 border-2 border-white"></span>
            </button>
            <button className="p-1.5 rounded-full hover:bg-slate-100 tap-responsive" aria-label="Profile">
              <UserCircle2 className="w-6 h-6 text-slate-400" />
            </button>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
