"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Users, AlertCircle, Clock } from "lucide-react";

export default function AdminDashboardPage() {
  // Simulate network loading state
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Artificial 2-second delay to beautifully demonstrate the Skelton phase
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div>
          <Skeleton className="h-10 w-[250px] mb-2" />
          <Skeleton className="h-4 w-[400px]" />
        </div>

        {/* 4-Card Top Row Skeletons */}
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

        {/* Large Chart/Table Area Skeletons */}
        <div className="grid gap-6 md:grid-cols-7">
          <Card className="col-span-4 shadow-soft">
            <CardHeader>
              <Skeleton className="h-6 w-[180px] mb-2" />
              <Skeleton className="h-4 w-[250px]" />
            </CardHeader>
            <CardContent>
              <Skeleton className="w-full h-[300px] rounded-sm" />
            </CardContent>
          </Card>
          
          <Card className="col-span-3 shadow-soft">
            <CardHeader>
              <Skeleton className="h-6 w-[150px] mb-2" />
              <Skeleton className="h-4 w-[200px]" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[120px]" />
                    <Skeleton className="h-3 w-[80px]" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Active Data State
  return (
    <div className="space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-2">
      <div>
        <h2 className="text-3xl font-semibold font-display tracking-tight text-slate-900 dark:text-slate-50">
          Facility Overview
        </h2>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Real-time metrics for Oakridge ALF starting October 24th.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard 
          title="Total Residents" 
          value="42/50" 
          trend="+2 this month" 
          icon={<Users className="h-4 w-4 text-emerald-600" />} 
        />
        <MetricCard 
          title="Critical Incidents (7d)" 
          value="1" 
          trend="-3 from last week" 
          icon={<AlertCircle className="h-4 w-4 text-severity-4" />} 
          critical
        />
        <MetricCard 
          title="Staff Ratio" 
          value="1:8" 
          trend="Healthy (Target: 1:10)" 
          icon={<Activity className="h-4 w-4 text-teal-600" />} 
        />
        <MetricCard 
          title="Upcoming Meds" 
          value="18" 
          trend="Next 2 hours" 
          icon={<Clock className="h-4 w-4 text-amber-600" />} 
        />
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        <Card className="col-span-4 shadow-soft">
          <CardHeader>
            <CardTitle className="font-display">Occupancy Trends</CardTitle>
            <CardDescription>Admissions vs. Discharges over 6 months</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 outline-dashed outline-2 outline-slate-200 dark:outline-slate-800 outline-offset-[-10px] m-4 rounded-lg">
            <span className="text-sm font-medium text-slate-400">Chart Component renders here</span>
          </CardContent>
        </Card>
        
        <Card className="col-span-3 shadow-soft flex flex-col">
          <CardHeader>
            <CardTitle className="font-display">Actionable Alerts</CardTitle>
            <CardDescription>Items severely impacting compliance</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto pr-2">
            <div className="space-y-4">
              {alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-4 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-colors tap-responsive cursor-pointer group">
                  <div className={`mt-0.5 w-2 h-2 rounded-full ${alert.color} shadow-sm group-hover:scale-110 transition-transform`} />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{alert.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{alert.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, icon, critical = false }: { title: string, value: string, trend: string, icon: React.ReactNode, critical?: boolean }) {
  return (
    <Card className={`shadow-soft border ${critical ? 'border-red-200/50 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/20' : 'border-slate-200/60 dark:border-slate-800'}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold tracking-tight ${critical ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-50'}`}>
          {value}
        </div>
        <p className={`text-xs mt-1 ${critical ? 'text-red-600/80 dark:text-red-400/80' : 'text-slate-500 dark:text-slate-400'}`}>
          {trend}
        </p>
      </CardContent>
    </Card>
  );
}

const alerts = [
  { title: "Medication Refusal", description: "John Smith refused evening Lisinopril.", color: "bg-severity-3" },
  { title: "Fall Incident Draft", description: "Unsigned fall report for Sarah Davis (2 hrs ago).", color: "bg-severity-4" },
  { title: "CNA Recertification", description: "Maria Garcia's BLS expires in 14 days.", color: "bg-severity-2" },
  { title: "Care Plan Review Due", description: "Assessment requires RN signature by tomorrow.", color: "bg-severity-2" },
  { title: "Dietary Note", description: "New fluid restriction ordered for Room 204.", color: "bg-brand-500" },
  { title: "Environmental Issue", description: "HVAC malfunction reported in East Wing.", color: "bg-severity-1" },
];
