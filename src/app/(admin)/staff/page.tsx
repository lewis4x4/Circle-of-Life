"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronRight, UserCog, UserRoundCheck } from "lucide-react";

import {
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBar,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StaffRole = "nurse" | "caregiver" | "med_tech" | "admin";
type StaffStatus = "active" | "on_leave" | "off_shift";
type CertificationStatus = "current" | "expiring_soon" | "expired";

type StaffRow = {
  id: string;
  name: string;
  initials: string;
  role: StaffRole;
  status: StaffStatus;
  certifications: CertificationStatus;
  nextShift: string;
  overtimeRisk: "low" | "medium" | "high";
};

const DEFAULT_FILTERS = {
  search: "",
  role: "all",
  status: "all",
  cert: "all",
};

export default function AdminStaffPage() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [role, setRole] = useState(DEFAULT_FILTERS.role);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [cert, setCert] = useState(DEFAULT_FILTERS.cert);

  const loadStaff = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      setRows(mockStaff);
    } catch {
      setError("Staff directory feed is unavailable. Please retry.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStaff();
  }, []);

  const filteredRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.name.toLowerCase().includes(loweredSearch) ||
        row.nextShift.toLowerCase().includes(loweredSearch);
      const matchesRole = role === "all" || row.role === role;
      const matchesStatus = status === "all" || row.status === status;
      const matchesCert = cert === "all" || row.certifications === cert;
      return matchesSearch && matchesRole && matchesStatus && matchesCert;
    });
  }, [rows, search, role, status, cert]);

  const activeCount = rows.filter((row) => row.status === "active").length;
  const certRiskCount = rows.filter((row) => row.certifications !== "current").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Staffing Roster
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Certification-aware team directory with shift visibility and overtime risk cues.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-slate-200 bg-white px-3 py-1 dark:border-slate-800 dark:bg-slate-900"
          >
            <UserRoundCheck className="mr-1 h-3.5 w-3.5" />
            {activeCount} on staff
          </Badge>
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <UserCog className="mr-1 h-3.5 w-3.5" />
            {certRiskCount} cert attention
          </Badge>
        </div>
      </header>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search staff name or shift..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "role",
            value: role,
            onChange: setRole,
            options: [
              { value: "all", label: "All Roles" },
              { value: "nurse", label: "Nurse" },
              { value: "caregiver", label: "Caregiver" },
              { value: "med_tech", label: "Med Tech" },
              { value: "admin", label: "Admin" },
            ],
          },
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All Statuses" },
              { value: "active", label: "Active" },
              { value: "off_shift", label: "Off Shift" },
              { value: "on_leave", label: "On Leave" },
            ],
          },
          {
            id: "cert",
            value: cert,
            onChange: setCert,
            options: [
              { value: "all", label: "All Certification States" },
              { value: "current", label: "Current" },
              { value: "expiring_soon", label: "Expiring Soon" },
              { value: "expired", label: "Expired" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setRole(DEFAULT_FILTERS.role);
          setStatus(DEFAULT_FILTERS.status);
          setCert(DEFAULT_FILTERS.cert);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminErrorState title="Could not load staff" message={error} onRetry={loadStaff} />
      ) : null}
      {!isLoading && !error && filteredRows.length === 0 ? (
        <AdminEmptyState
          title="No staff match the current filters"
          description="Try broadening role, status, or certification filters to restore the roster results."
        />
      ) : null}

      {!isLoading && !error && filteredRows.length > 0 ? (
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30">
            <CardTitle className="text-lg font-display">Team Directory</CardTitle>
            <CardDescription>Scaffolded staffing table for scheduling, certifications, and time records modules.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/70 dark:bg-slate-900/60">
                <TableRow className="border-slate-100 hover:bg-transparent dark:border-slate-800">
                  <TableHead className="pl-4 font-medium">Staff</TableHead>
                  <TableHead className="font-medium">Role</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium">Certifications</TableHead>
                  <TableHead className="font-medium">Next Shift</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Overtime Risk
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((staff) => (
                  <TableRow key={staff.id} className="border-slate-100 dark:border-slate-800">
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <Avatar size="default" className="ring-1 ring-slate-200 dark:ring-slate-700">
                          <AvatarImage src={`https://i.pravatar.cc/80?u=${staff.id}`} alt={staff.name} />
                          <AvatarFallback className="bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100">
                            {staff.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{staff.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={staff.role} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={staff.status} />
                    </TableCell>
                    <TableCell>
                      <CertificationBadge certifications={staff.certifications} />
                    </TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{staff.nextShift}</TableCell>
                    <TableCell>
                      <OvertimeRiskBadge risk={staff.overtimeRisk} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Open ${staff.name}`}>
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RoleBadge({ role }: { role: StaffRole }) {
  const map: Record<StaffRole, { label: string; className: string }> = {
    nurse: { label: "Nurse", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    caregiver: {
      label: "Caregiver",
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    med_tech: {
      label: "Med Tech",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    },
    admin: { label: "Admin", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  };
  return <Badge className={map[role].className}>{map[role].label}</Badge>;
}

function StatusBadge({ status }: { status: StaffStatus }) {
  const map: Record<StaffStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    off_shift: {
      label: "Off Shift",
      className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    },
    on_leave: { label: "On Leave", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  const map: Record<CertificationStatus, { label: string; className: string }> = {
    current: { label: "Current", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    expiring_soon: {
      label: "Expiring Soon",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    expired: { label: "Expired", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  };
  return <Badge className={map[certifications].className}>{map[certifications].label}</Badge>;
}

function OvertimeRiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const map = {
    low: { label: "Low", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    medium: { label: "Medium", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    high: { label: "High", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  } as const;
  return <Badge className={map[risk].className}>{map[risk].label}</Badge>;
}

const mockStaff: StaffRow[] = [
  {
    id: "staff-001",
    name: "John Davis",
    initials: "JD",
    role: "nurse",
    status: "active",
    certifications: "current",
    nextShift: "Today 3:00 PM",
    overtimeRisk: "low",
  },
  {
    id: "staff-002",
    name: "Maria Gomez",
    initials: "MG",
    role: "caregiver",
    status: "active",
    certifications: "expiring_soon",
    nextShift: "Today 11:00 PM",
    overtimeRisk: "medium",
  },
  {
    id: "staff-003",
    name: "Theresa Walker",
    initials: "TW",
    role: "med_tech",
    status: "off_shift",
    certifications: "current",
    nextShift: "Tomorrow 7:00 AM",
    overtimeRisk: "low",
  },
  {
    id: "staff-004",
    name: "Samuel Ortiz",
    initials: "SO",
    role: "caregiver",
    status: "on_leave",
    certifications: "expired",
    nextShift: "Pending Return",
    overtimeRisk: "high",
  },
];
