"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, AlertCircle, ArrowUpRight, ArrowDownRight, Map as MapIcon, Maximize2 } from "lucide-react";

export default function AdminDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <Skeleton className="w-full h-[280px] lg:h-[340px] rounded-[2rem]" />
        <div className="grid gap-6 md:grid-cols-12">
          <Card className="col-span-8 shadow-soft"><CardContent><Skeleton className="w-full h-[400px]" /></CardContent></Card>
          <Card className="col-span-4 shadow-soft"><CardContent><Skeleton className="w-full h-[400px]" /></CardContent></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-2 pb-12">
      
      {/* 
        ======== LAYER 1: The Luxury Facility Command Banner ======== 
        This establishes physical reality and adds the "Premium B2B" photograph request.
      */}
      <div className="relative w-full h-[280px] lg:h-[340px] rounded-[2rem] overflow-hidden border border-slate-200/60 dark:border-slate-800 shadow-soft">
        
        {/* Background Graphic */}
        <div 
          className="absolute inset-0 bg-cover bg-center transition-transform hover:scale-105 duration-[15s] ease-out" 
          style={{ backgroundImage: "url('/facility-hero.png')" }} 
        />
        
        {/* Cinematic Darkness Gradient to ensure text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/50 to-transparent" />
        
        {/* Banner Content */}
        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
          <div className="max-w-xl">
            <Badge className="mb-4 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-md px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span className="uppercase tracking-widest text-[10px] font-bold">Live Synchronized</span>
            </Badge>
            <h1 className="text-4xl lg:text-5xl font-display font-bold text-white tracking-tight drop-shadow-md">
              Oakridge ALF
            </h1>
            <p className="text-slate-300 mt-2 font-medium drop-shadow-sm text-sm sm:text-base">
              Facility Command Center • Current Shift: Day (7:00 AM - 3:00 PM)
            </p>
          </div>
          
          <div className="flex gap-3 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0 scrollbar-hide shrink-0">
            {/* Minimalist Floating Glass Metrics */}
            <FloatingMetric title="Occupancy" value="42/50" sub="84% Capacity" />
            <FloatingMetric title="Active Staff" value="8" sub="Ratio 1:5" icon={<Users className="w-4 h-4 text-emerald-400" />} />
            <FloatingMetric title="Pending Alerts" value="2" sub="Requires Action" critical />
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-12 items-start">
        
        {/* 
          ======== LAYER 2: Front-line Resident Master List ======== 
        */}
        <Card className="col-span-12 lg:col-span-7 shadow-soft flex flex-col overflow-hidden border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950">
          <CardHeader className="flex flex-row items-center justify-between pb-4 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800">
            <div>
              <CardTitle className="font-display text-lg">Live Census Board</CardTitle>
              <CardDescription>Patient location, acuity, and shift status</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs font-medium tap-responsive">
              View Directory
            </Button>
          </CardHeader>
          <CardContent className="p-0 overflow-auto max-h-[700px]">
            <Table>
              <TableHeader className="bg-slate-50/80 dark:bg-slate-900/80 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow className="border-slate-100 dark:border-slate-800 hover:bg-transparent">
                  <TableHead className="font-medium">Resident</TableHead>
                  <TableHead className="font-medium hidden sm:table-cell">Room</TableHead>
                  <TableHead className="font-medium hidden md:table-cell">Acuity</TableHead>
                  <TableHead className="font-medium text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {censusData.map((res) => (
                  <TableRow key={res.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors cursor-pointer group">
                    <TableCell className="py-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="h-10 w-10 border-2 border-white shadow-sm ring-1 ring-slate-200 dark:border-slate-950 dark:ring-slate-800 group-hover:scale-105 transition-transform">
                          <AvatarImage src={`https://i.pravatar.cc/150?img=${res.id}`} alt={res.name} />
                          <AvatarFallback className="text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{res.initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{res.name}</span>
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 sm:hidden">Rm {res.room} • {res.dob}</span>
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 hidden sm:block">DOB: {res.dob}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-slate-700 dark:text-slate-300 hidden sm:table-cell">{res.room}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <AcuityBadge level={res.acuity} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <StatusIndicator status={res.status} />
                        <span className="text-[10px] uppercase font-bold text-slate-400">{res.lastNoteTime}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        
        {/* 
          ======== LAYER 3: Interactive Blueprint & Logs ======== 
        */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          
          {/* New Live Blueprint Widget */}
          <Card className="shadow-soft border-slate-200/60 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950 relative group">
            <CardHeader className="absolute top-0 inset-x-0 z-10 bg-gradient-to-b from-slate-950/80 to-transparent pt-4 pb-8 border-none flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <MapIcon className="w-5 h-5 text-teal-400" />
                <CardTitle className="text-white drop-shadow-md">Campus Live View</CardTitle>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 rounded-full bg-black/40 backdrop-blur-md">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <div className="relative w-full aspect-video bg-slate-950">
              {/* Graphic Blueprint Image */}
              <div 
                className="absolute inset-0 bg-cover bg-center transition-transform duration-[10s] group-hover:scale-[1.03] opacity-80" 
                style={{ backgroundImage: "url('/campus-map.png')" }} 
              />
              {/* Simulation Dots */}
              <div className="absolute top-1/4 left-1/3 w-3 h-3 bg-red-500 rounded-full shadow-[0_0_15px_rgba(239,68,68,1)] animate-pulse" />
              <div className="absolute top-1/2 left-2/3 w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,1)]" />
              <div className="absolute bottom-1/3 left-1/2 w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,1)]" />
            </div>
            <div className="bg-slate-900 border-t border-slate-800 p-3 flex justify-between items-center px-4">
               <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Sector B Active</span>
               <span className="text-xs font-bold text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> 1 Alarm Location</span>
            </div>
          </Card>

          {/* Real-time Activity Sidebar */}
          <Card className="shadow-soft flex flex-col overflow-hidden border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950 h-full max-h-[400px]">
            <CardHeader className="pb-4 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="font-display text-lg">Shift Log</CardTitle>
              <CardDescription>Real-time operational events</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 relative">
              <ScrollArea className="h-full px-5 py-4">
                <div className="space-y-5 relative before:absolute before:inset-0 before:ml-[11px] before:h-full before:w-[2px] before:bg-gradient-to-b before:from-slate-200 before:via-slate-200 dark:before:via-slate-800 before:to-transparent">
                  {activityLog.map((event, i) => (
                    <div key={i} className="relative flex items-start gap-4">
                      {/* Timeline Dot */}
                      <div className="flex items-center justify-center w-6 h-6 rounded-full border-[3px] border-white dark:border-slate-950 bg-slate-200 dark:bg-slate-800 shrink-0 z-10 mt-0.5">
                        <div className={`w-2 h-2 rounded-full ${event.type === 'critical' ? 'bg-red-500' : event.type === 'warning' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                      </div>
                      <div className="flex flex-col flex-1 pb-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{event.user}</span>
                          <span className="text-xs font-medium text-slate-400">{event.time}</span>
                        </div>
                        <p className={`text-sm mt-0.5 font-medium ${event.type === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {event.message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function FloatingMetric({ title, value, sub, critical, icon }: any) {
  return (
    <div className={`shrink-0 flex flex-col justify-center rounded-2xl border ${critical ? 'border-red-500/30 bg-red-950/40' : 'border-white/10 bg-slate-950/40'} backdrop-blur-md p-4 w-[140px] shadow-[0_8px_30px_rgb(0,0,0,0.12)]`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1 opacity-80">{title}</span>
      <div className="flex items-center gap-2">
         <span className={`text-2xl font-bold tracking-tight ${critical ? 'text-red-400' : 'text-white'}`}>{value}</span>
         {icon}
      </div>
      <span className={`text-[10px] font-semibold mt-0.5 ${critical ? 'text-red-300/80' : 'text-slate-400'}`}>{sub}</span>
    </div>
  )
}

function AcuityBadge({ level }: { level: 1 | 2 | 3 }) {
  const map = {
    1: { label: "Routine", class: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50" },
    2: { label: "Observation", class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50" },
    3: { label: "Critical", class: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800/50" },
  };
  const cfg = map[level];
  return <Badge variant="outline" className={`${cfg.class} font-bold tracking-wide uppercase text-[10px]`}>{cfg.label}</Badge>;
}

function StatusIndicator({ status }: { status: string }) {
  const isOut = status.includes("Hospital") || status.includes("LOA");
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{status}</span>
      <div className={`w-2 h-2 rounded-full shadow-sm ${isOut ? 'bg-amber-500' : 'bg-emerald-500'}`} />
    </div>
  );
}

// ---- Dummy Data Arrays ----

const censusData = [
  { id: "12", name: "Margaret Sullivan", initials: "MS", dob: "04/12/1938", room: "101-A", acuity: 2 as const, status: "In Room", lastNoteTime: "2 hrs ago" },
  { id: "44", name: "Arthur Pendelton", initials: "AP", dob: "11/05/1942", room: "102-B", acuity: 1 as const, status: "In Facility", lastNoteTime: "4 hrs ago" },
  { id: "33", name: "Eleanor Vance", initials: "EV", dob: "08/22/1935", room: "104-A", acuity: 3 as const, status: "Hospital (ER)", lastNoteTime: "1 hr ago" },
  { id: "49", name: "Robert Chen", initials: "RC", dob: "02/14/1945", room: "201-A", acuity: 1 as const, status: "In Room", lastNoteTime: "3 hrs ago" },
  { id: "65", name: "Lucille Booth", initials: "LB", dob: "09/30/1931", room: "205-B", acuity: 2 as const, status: "In Facility", lastNoteTime: "15 mins ago" },
  { id: "69", name: "William Hastings", initials: "WH", dob: "12/08/1940", room: "206-A", acuity: 1 as const, status: "LOA (Family)", lastNoteTime: "Yesterday" },
  { id: "27", name: "Dorothy Parker", initials: "DP", dob: "03/15/1939", room: "208-B", acuity: 2 as const, status: "In Room", lastNoteTime: "5 hrs ago" },
];

const activityLog = [
  { time: "Just Now", user: "System Guard", message: "Eleanor Vance (104-A) status updated to Hospital (ER).", type: "critical" },
  { time: "15m ago", user: "Maria G (CNA)", message: "Lucille Booth (205-B) requested PRN pain medication.", type: "warning" },
  { time: "1h ago", user: "John D (RN)", message: "EMS dispatched for Eleanor Vance (Fall protocol).", type: "critical" },
  { time: "2h ago", user: "Automated System", message: "Margaret Sullivan missed scheduled vitals block.", type: "warning" },
  { time: "3h ago", user: "Theresa W (PT)", message: "Finished Robert Chen's morning physical therapy.", type: "normal" },
  { time: "4h ago", user: "Kitchen API", message: "Breakfast service completed for East Wing.", type: "normal" },
  { time: "5h ago", user: "John D (RN)", message: "Wound dressing changed for Dorothy Parker.", type: "normal" },
];
