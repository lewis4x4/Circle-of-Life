"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BellRing, Send } from "lucide-react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  getVapidPublicKeyBytes,
  invokeDispatchPushTest,
  subscribePushAndSave,
} from "@/lib/push-notifications";
import {
  formatNotificationsChannelsDisplay,
  formatNotificationsRoleTargetsDisplay,
} from "@/lib/admin/settings/notifications-display-copy";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type IncidentSeverity = Database["public"]["Enums"]["incident_severity"];
type StaffRole = Database["public"]["Enums"]["staff_role"];

type RouteRow = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  name: string;
  severity_min: IncidentSeverity;
  channels: string[] | null;
  staff_role_targets: StaffRole[] | null;
  is_active: boolean;
  facilities: { name: string } | null;
};

type FacilityOption = { id: string; name: string };

const SEVERITY_OPTIONS: Array<{ value: RouteRow["severity_min"]; label: string }> = [
  { value: "level_1", label: "Level 1 — FYI" },
  { value: "level_2", label: "Level 2 — Standard" },
  { value: "level_3", label: "Level 3 — Urgent" },
  { value: "level_4", label: "Level 4 — Critical" },
];

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS text" },
  { value: "push", label: "Device push" },
  { value: "in_app", label: "In-app" },
  { value: "call", label: "Phone call" },
];

const ROLE_OPTIONS: Array<{ value: StaffRole; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "ceo", label: "CEO" },
  { value: "coo", label: "COO" },
  { value: "cfo", label: "CFO" },
  { value: "administrator", label: "Administrator" },
  { value: "assistant_administrator", label: "Assistant administrator" },
  { value: "admin_support_coordinator", label: "Admin support coordinator" },
  { value: "marketing_consultant", label: "Marketing consultant" },
  { value: "resident_services_coordinator", label: "Resident services coordinator" },
  { value: "rn", label: "RN" },
  { value: "lpn", label: "LPN" },
  { value: "cna", label: "CNA" },
  { value: "medication_tech", label: "Medication tech" },
  { value: "resident_aide", label: "Resident aide" },
  { value: "maintenance_director", label: "Maintenance director" },
  { value: "maintenance", label: "Maintenance" },
  { value: "maintenance_standby", label: "Maintenance standby" },
  { value: "activities_director", label: "Activities director" },
  { value: "activity_aide", label: "Activity aide" },
  { value: "dietary_manager", label: "Dietary manager" },
  { value: "dietary_staff", label: "Dietary staff" },
  { value: "dietary_aide", label: "Dietary aide" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "driver", label: "Driver" },
  { value: "other", label: "Other" },
];

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function severityLabel(value: RouteRow["severity_min"]): string {
  return SEVERITY_OPTIONS.find((opt) => opt.value === value)?.label ?? value;
}

export default function AdminNotificationsSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, appRole } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [vapidConfigured, setVapidConfigured] = useState(false);

  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);

  const [routeName, setRouteName] = useState("");
  const [routeFacilityId, setRouteFacilityId] = useState("");
  const [routeSeverity, setRouteSeverity] = useState<RouteRow["severity_min"]>("level_2");
  const [routeChannels, setRouteChannels] = useState<string[]>(["email", "push"]);
  const [routeRoles, setRouteRoles] = useState<StaffRole[]>(["administrator", "assistant_administrator"]);
  const [routeActive, setRouteActive] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setPushSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );
    setVapidConfigured(!!getVapidPublicKeyBytes());
  }, []);

  const loadRoutes = useCallback(async () => {
    setRoutesLoading(true);
    setErr(null);

    if (!organizationId) {
      setErr("Organization scope is not ready yet.");
      setRoutes([]);
      setFacilities([]);
      setRoutesLoading(false);
      return;
    }

    const [routeRes, facilityRes] = await Promise.all([
      supabase
        .from("notification_routes")
        .select(
          "id, organization_id, facility_id, name, severity_min, channels, staff_role_targets, is_active, facilities(name)",
        )
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("is_active", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("facilities")
        .select("id, name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
    ]);

    if (routeRes.error) {
      setErr(routeRes.error.message || "Failed to load notification routes.");
      setRoutes([]);
    } else {
      setRoutes((routeRes.data ?? []) as RouteRow[]);
    }

    if (facilityRes.error) {
      setErr((prev) => prev ?? facilityRes.error.message ?? "Failed to load facilities.");
      setFacilities([]);
    } else {
      setFacilities((facilityRes.data ?? []) as FacilityOption[]);
    }

    setRoutesLoading(false);
  }, [organizationId, supabase]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const onSubscribe = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (!organizationId) {
        setErr("Organization scope is not ready yet.");
        return;
      }
      if (!user) {
        setErr("Sign in required.");
        return;
      }
      const result = await subscribePushAndSave({
        supabase,
        organizationId,
        userId: user.id,
      });
      if (!result.ok) {
        setErr(result.error);
        return;
      }
      setMsg("Browser subscribed — subscription saved for this device.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Subscribe failed.");
    } finally {
      setBusy(false);
    }
  }, [organizationId, supabase, user]);

  const onTestDispatch = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (!organizationId) {
        setErr("Organization scope is not ready yet.");
        return;
      }
      if (!["owner", "org_admin"].includes(role)) {
        setErr("Only owner or org admin can send a test push from this screen.");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setErr("Session expired.");
        return;
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
      const anonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
      if (!supabaseUrl || !anonKey) {
        setErr("Supabase is not configured.");
        return;
      }
      if (!user) {
        setErr("Sign in required.");
        return;
      }
      const result = await invokeDispatchPushTest({
        supabaseUrl,
        anonKey,
        accessToken: session.access_token,
        userId: user.id,
        title: "Haven test",
        body: "Push pipeline is working.",
      });
      if (!result.ok) {
        setErr(result.message);
        return;
      }
      setMsg("Test notification sent to saved subscriptions.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test notification failed.");
    } finally {
      setBusy(false);
    }
  }, [organizationId, role, supabase, user]);

  const canDispatch = role === "owner" || role === "org_admin";
  const canManageRoutes = role === "owner" || role === "org_admin" || role === "facility_admin";

  const onSaveRoute = useCallback(async () => {
    setErr(null);
    setMsg(null);

    if (!canManageRoutes) {
      setErr("Only owner, org admin, or facility admin can change notification routes.");
      return;
    }
    if (!organizationId) {
      setErr("Organization scope is not ready yet.");
      return;
    }
    if (!routeName.trim()) {
      setErr("Route name is required.");
      return;
    }

    if (routeChannels.length === 0) {
      setErr("Choose at least one channel.");
      return;
    }
    const channels = routeChannels;
    const roles = routeRoles;

    setBusy(true);
    try {
      if (editingId) {
        const { error: updateError } = await supabase
          .from("notification_routes")
          .update({
            name: routeName.trim(),
            facility_id: routeFacilityId || null,
            severity_min: routeSeverity,
            channels,
            staff_role_targets: roles.length > 0 ? roles : null,
            is_active: routeActive,
          })
          .eq("id", editingId)
          .eq("organization_id", organizationId)
          .is("deleted_at", null);
        if (updateError) throw updateError;
        setMsg("Notification route updated.");
      } else {
        const { error: insertError } = await supabase.from("notification_routes").insert({
          organization_id: organizationId,
          facility_id: routeFacilityId || null,
          name: routeName.trim(),
          severity_min: routeSeverity,
          channels,
          staff_role_targets: roles.length > 0 ? roles : null,
          is_active: routeActive,
        });
        if (insertError) throw insertError;
        setMsg("Notification route created.");
      }

      setRouteName("");
      setRouteFacilityId("");
      setRouteSeverity("level_2");
      setRouteChannels(["email", "push"]);
      setRouteRoles(["administrator", "assistant_administrator"]);
      setRouteActive(true);
      setEditingId(null);
      await loadRoutes();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save route.");
    } finally {
      setBusy(false);
    }
  }, [
    canManageRoutes,
    editingId,
    loadRoutes,
    organizationId,
    routeActive,
    routeChannels,
    routeFacilityId,
    routeName,
    routeRoles,
    routeSeverity,
    supabase,
  ]);

  const startEdit = useCallback((route: RouteRow) => {
    setEditingId(route.id);
    setRouteName(route.name);
    setRouteFacilityId(route.facility_id ?? "");
    setRouteSeverity(route.severity_min);
    setRouteChannels(route.channels ?? []);
    setRouteRoles(route.staff_role_targets ?? []);
    setRouteActive(route.is_active);
    setMsg(null);
    setErr(null);
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <Link
          href="/admin/settings"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 -ml-2 gap-1")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Settings
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
          <BellRing className="h-7 w-7 text-slate-600 dark:text-slate-300" aria-hidden />
          Notifications
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage browser push and alert routing for your facilities.
        </p>
      </div>

      {err && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {err}
        </p>
      )}
      {msg && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {msg}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Notification routes</CardTitle>
          <CardDescription>
            Configure where alerts go, what severity starts a route, and which roles receive it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManageRoutes && role ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Your role can view notification settings, but only owner, org admin, or facility admin can change routes.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-medium">Route name *</span>
              <input
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                disabled={busy || !canManageRoutes}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Example: Round Check 30 Min Overdue"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-medium">Facility</span>
              <select
                value={routeFacilityId}
                onChange={(e) => setRouteFacilityId(e.target.value)}
                disabled={busy || !canManageRoutes}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">All facilities (organization-wide)</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-medium">Severity starts at</span>
              <select
                value={routeSeverity}
                onChange={(e) => setRouteSeverity(e.target.value as RouteRow["severity_min"])}
                disabled={busy || !canManageRoutes}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-medium">Active status</span>
              <select
                value={routeActive ? "active" : "inactive"}
                onChange={(e) => setRouteActive(e.target.value === "active")}
                disabled={busy || !canManageRoutes}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-medium">Channels *</span>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                {CHANNEL_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={routeChannels.includes(option.value)}
                      onChange={() => setRouteChannels((current) => toggleValue(current, option.value))}
                      disabled={busy || !canManageRoutes}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </label>
            <label className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="font-medium">Target roles</span>
              <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2 dark:border-slate-700">
                {ROLE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={routeRoles.includes(option.value)}
                      onChange={() => setRouteRoles((current) => toggleValue(current, option.value))}
                      disabled={busy || !canManageRoutes}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void onSaveRoute()} disabled={busy || !canManageRoutes}>
              {busy ? "Saving…" : editingId ? "Update route" : "Create route"}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setRouteName("");
                  setRouteFacilityId("");
                  setRouteSeverity("level_2");
                  setRouteChannels(["email", "push"]);
                  setRouteRoles(["administrator", "assistant_administrator"]);
                  setRouteActive(true);
                }}
                disabled={busy}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>

          {routesLoading ? (
            <p className="text-sm text-slate-500">Loading routes…</p>
          ) : routes.length === 0 ? (
            <p className="text-sm text-slate-500">No routes found for your organization yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead>
                  <tr className="border-b bg-slate-50 dark:bg-slate-900/40">
                    <th className="px-3 py-2">Route</th>
                    <th className="px-3 py-2">Facility</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Channels</th>
                    <th className="px-3 py-2">Target roles</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{route.name}</td>
                      <td className="px-3 py-2">{route.facilities?.name ?? "All facilities"}</td>
                      <td className="px-3 py-2">{severityLabel(route.severity_min)}</td>
                      <td className="px-3 py-2">{formatNotificationsChannelsDisplay(route.channels)}</td>
                      <td className="px-3 py-2">
                        {formatNotificationsRoleTargetsDisplay(route.staff_role_targets)}
                      </td>
                      <td className="px-3 py-2">{route.is_active ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(route)} disabled={!canManageRoutes}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Web Push</CardTitle>
          <CardDescription>
            Requires a supported browser and secure connection. Ask an administrator to complete web push setup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pushSupported && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              This browser does not support service workers or push messaging.
            </p>
          )}
          {!vapidConfigured && (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Ask an administrator to complete web push setup before enabling notifications on this device.
            </p>
          )}
          <Button
            type="button"
            onClick={() => void onSubscribe()}
            disabled={busy || !pushSupported || !vapidConfigured}
            className="gap-2"
          >
            <BellRing className="h-4 w-4" aria-hidden />
            {busy ? "Working…" : "Enable notifications on this device"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test dispatch</CardTitle>
          <CardDescription>
            Sends a test notification to your saved subscriptions (owner / org admin only).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onTestDispatch()}
            disabled={busy || !canDispatch}
            className="gap-2"
          >
            <Send className="h-4 w-4" aria-hidden />
            Send test to my devices
          </Button>
          {!canDispatch && role !== null && (
            <p className="mt-2 text-sm text-slate-500">Ask an owner or org admin to run a test dispatch.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
