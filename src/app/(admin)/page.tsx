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
import { Activity, Users, AlertCircle, Bed, ArrowUpRight, ArrowDownRight } from "lucide-react";

export default function AdminDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div>
          <Skeleton className="h-10 w-[250px] mb-2" />
          <Skeleton className="h-4 w-[400px]" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="shadow-soft border-slate-200/60 dark:border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[60px] mb-2" />
                <Skeleton className="h-3 w-[120px]" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-12">
          <Card className="col-span-8 shadow-soft">
            <CardHeader><Skeleton className="h-6 w-[180px] mb-2" /></CardHeader>
            <CardContent><Skeleton className="w-full h-[400px] rounded-sm" /></CardContent>
          </Card>
          <Card className="col-span-4 shadow-soft">
            <CardHeader><Skeleton className="h-6 w-[150px] mb-2" /></CardHeader>
            <CardContent><Skeleton className="w-full h-[400px] rounded-sm" /></CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-2">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-semibold font-display tracking-tight text-slate-900 dark:text-slate-50">
            Facility Command
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Real-time census, clinical alerts, and operations for Oakridge ALF.
          </p>
        </div>
        <div className="flex gap-2 text-sm font-medium">
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400 px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 -ml-1 animate-pulse" />
            Live Sync
          </Badge>
          <span className="text-slate-500 dark:text-slate-400 py-1 px-2">Last updated just now</span>
        </div>
      </div>

      {/* Layer 2: The Command Module (Metrics Grid) */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard 
          title="Occupancy" 
          value="42/50" 
          trend="84% utilization"
          trendDir="up" 
          icon={<Bed className="h-4 w-4 text-brand-600" />} 
        />
        <MetricCard 
          title="Critical Alerts" 
          value="2" 
          trend="Requires action"
          trendDir="down" 
          icon={<AlertCircle className="h-4 w-4 text-severity-4" />} 
          critical
        />
        <MetricCard 
          title="Active Staff" 
          value="8" 
          trend="Ratio 1:5 (Healthy)" 
          trendDir="up"
          icon={<Users className="h-4 w-4 text-teal-600" />} 
        />
        <MetricCard 
          title="eMAR Status" 
          value="Pending" 
          trend="12 meds due next hour"
          trendDir="neutral" 
          icon={<Activity className="h-4 w-4 text-amber-600" />} 
        />
      </div>

      <div className="grid gap-6 md:grid-cols-12 lg:h-[600px]">
        {/* Layer 3: Census Board (Table) */}
        <Card className="col-span-12 md:col-span-8 shadow-soft flex flex-col overflow-hidden border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950">
          <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800">
            <div>
              <CardTitle className="font-display text-lg">Live Census Board</CardTitle>
              <CardDescription>Patient location, acuity, and shift status</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs font-medium tap-responsive">
              View All 42 Residents
            </Button>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-900/50 sticky top-0 z-10">
                <TableRow className="border-slate-100 dark:border-slate-800 hover:bg-transparent">
                  <TableHead className="font-medium">Resident</TableHead>
                  <TableHead className="font-medium">Room</TableHead>
                  <TableHead className="font-medium">Acuity</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="text-right font-medium">Last Care Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {censusData.map((res) => (
                  <TableRow key={res.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 border border-slate-200 dark:border-slate-700 shadow-sm">
                          <AvatarImage src={`https://i.pravatar.cc/150?u=${res.id}`} alt={res.name} />
                          <AvatarFallback className="text-[10px] font-medium bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100">{res.initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{res.name}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">DOB: {res.dob}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-slate-700 dark:text-slate-300">{res.room}</TableCell>
                    <TableCell>
                      <AcuityBadge level={res.acuity} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={res.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{res.lastNote}</span>
                        <span className="text-xs text-slate-400">{res.lastNoteTime}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        
        {/* Layer 4: Activity Sidebar */}
        <Card className="col-span-12 md:col-span-4 shadow-soft flex flex-col overflow-hidden border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950">
          <CardHeader className="pb-4 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="font-display text-lg">Shift Log</CardTitle>
            <CardDescription>Real-time clinical & operational events</CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            <ScrollArea className="h-full px-6 py-4">
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 dark:before:via-slate-800 before:to-transparent">
                {activityLog.map((event, i) => (
                  <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    {/* Timestamp Marker */}
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border border-white dark:border-slate-950 bg-slate-200 dark:bg-slate-800 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 transition-colors group-hover:bg-brand-500">
                      <div className={`w-2 h-2 rounded-full ${event.type === 'critical' ? 'bg-severity-4' : event.type === 'warning' ? 'bg-severity-3' : 'bg-brand-500'}`} />
                    </div>
                    {/* Content Card */}
                    <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] py-2 px-3 border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 rounded shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{event.time}</span>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{event.user}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-tight">
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
  );
}

// Sub-components

function MetricCard({ title, value, trend, trendDir, icon, critical = false }: { title: string, value: string, trend: string, trendDir: 'up'|'down'|'neutral', icon: React.ReactNode, critical?: boolean }) {
  return (
    <Card className={`shadow-soft border transition-all hover:shadow-elevated ${critical ? 'border-red-200 bg-red-50/30 dark:border-red-900/30 dark:bg-red-950/20' : 'border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950'}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {title}
        </CardTitle>
        <div className={`p-1.5 rounded-md ${critical ? 'bg-red-100 dark:bg-red-900/50' : 'bg-slate-100 dark:bg-slate-800'}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold tracking-tight ${critical ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-50'}`}>
          {value}
        </div>
        <div className="flex items-center mt-2 gap-1.5">
          {trendDir === 'up' && <ArrowUpRight className={`h-3.5 w-3.5 ${critical ? 'text-red-600' : 'text-emerald-500'}`} />}
          {trendDir === 'down' && <ArrowDownRight className={`h-3.5 w-3.5 ${critical ? 'text-red-600' : 'text-brand-500'}`} />}
          {trendDir === 'neutral' && <span className="h-1.5 w-1.5 rounded-full bg-slate-400 ml-1 mr-0.5" />}
          <p className={`text-xs font-medium ${critical ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {trend}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AcuityBadge({ level }: { level: 1 | 2 | 3 }) {
  const map = {
    1: { label: "Routine", class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/50" },
    2: { label: "Observation", class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50" },
    3: { label: "Critical", class: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800/50" },
  };
  const cfg = map[level];
  return <Badge variant="outline" className={`${cfg.class} font-medium tracking-wide`}>{cfg.label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const isOut = status.includes("Hospital") || status.includes("LOA");
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${isOut ? 'bg-amber-500' : 'bg-brand-500'}`} />
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{status}</span>
    </div>
  );
}

// Dummy Data Arrays

const censusData = [
  { id: "101", name: "Margaret Sullivan", initials: "MS", dob: "04/12/1938", room: "101-A", acuity: 2 as const, status: "In Room", lastNote: "Refused am vitals", lastNoteTime: "2 hrs ago" },
  { id: "102", name: "Arthur Pendelton", initials: "AP", dob: "11/05/1942", room: "102-B", acuity: 1 as const, status: "In Facility", lastNote: "Breakfast consumed 80%", lastNoteTime: "4 hrs ago" },
  { id: "103", name: "Eleanor Vance", initials: "EV", dob: "08/22/1935", room: "104-A", acuity: 3 as const, status: "Hospital (ER)", lastNote: "Transferred via EMS", lastNoteTime: "1 hr ago" },
  { id: "104", name: "Robert Chen", initials: "RC", dob: "02/14/1945", room: "201-A", acuity: 1 as const, status: "In Room", lastNote: "Morning walk completed", lastNoteTime: "3 hrs ago" },
  { id: "105", name: "Lucille Booth", initials: "LB", dob: "09/30/1931", room: "205-B", acuity: 2 as const, status: "In Facility", lastNote: "Awaiting PRN Tylenol", lastNoteTime: "15 mins ago" },
  { id: "106", name: "William Hastings", initials: "WH", dob: "12/08/1940", room: "206-A", acuity: 1 as const, status: "LOA (Family)", lastNote: "Signed out by daughter", lastNoteTime: "Yesterday" },
  { id: "107", name: "Dorothy Parker", initials: "DP", dob: "03/15/1939", room: "208-B", acuity: 2 as const, status: "In Room", lastNote: "Wound care complete", lastNoteTime: "5 hrs ago" },
];

const activityLog = [
  { time: "Just Now", user: "System", message: "Eleanor Vance (104-A) status updated to Hospital (ER).", type: "critical" },
  { time: "15m ago", user: "Maria G (CNA)", message: "Lucille Booth (205-B) requested PRN pain medication.", type: "warning" },
  { time: "1h ago", user: "John D (RN)", message: "EMS dispatched for Eleanor Vance (Fall protocol).", type: "critical" },
  { time: "2h ago", user: "System", message: "Margaret Sullivan missed scheduled vitals block.", type: "warning" },
  { time: "3h ago", user: "Theresa W (PT)", message: "Finished Robert Chen's morning physical therapy.", type: "normal" },
  { time: "4h ago", user: "Kitchen", message: "Breakfast service completed for East Wing.", type: "normal" },
  { time: "5h ago", user: "John D (RN)", message: "Wound dressing changed for Dorothy Parker.", type: "normal" },
];
