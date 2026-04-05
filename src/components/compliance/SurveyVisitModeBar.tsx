"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ClipboardList, Power, PowerOff } from "lucide-react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ROLES_MANAGE_SESSION = new Set(["owner", "org_admin", "facility_admin"]);
const ROLES_LOG_ACCESS = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

export function SurveyVisitModeBar() {
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [appRole, setAppRole] = useState<string>("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logDescription, setLogDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canManage = ROLES_MANAGE_SESSION.has(appRole);
  const canLog = ROLES_LOG_ACCESS.has(appRole);
  const active = !!activeSessionId;

  const refresh = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setUserId(null);
      setAppRole("");
      setOrgId(null);
      setActiveSessionId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    setLoadError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setUserId(null);
        setAppRole("");
        setOrgId(null);
        setActiveSessionId(null);
        return;
      }
      setUserId(user.id);
      const [prof, fac, sess] = await Promise.all([
        supabase.from("user_profiles").select("app_role").eq("id", user.id).maybeSingle(),
        supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).maybeSingle(),
        supabase
          .from("survey_visit_sessions")
          .select("id")
          .eq("facility_id", selectedFacilityId)
          .is("deactivated_at", null)
          .maybeSingle(),
      ]);
      if (prof.error) {
        setLoadError(prof.error.message);
        setAppRole("");
      } else if (prof.data?.app_role) {
        setAppRole(prof.data.app_role as string);
      } else {
        setAppRole("");
      }
      if (fac.error) {
        setLoadError((prev) => prev ?? fac.error.message);
        setOrgId(null);
      } else if (!fac.data?.organization_id) {
        setLoadError((prev) => prev ?? "Facility organization not found or access denied.");
        setOrgId(null);
      } else {
        setOrgId(fac.data.organization_id);
      }
      if (sess.error) {
        setLoadError((prev) => prev ?? sess.error?.message ?? "Could not load survey session.");
        setActiveSessionId(null);
      } else {
        setActiveSessionId(sess.data?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function activateSession() {
    if (!canManage || !userId || !selectedFacilityId) return;
    if (!orgId) {
      setMessage("Organization could not be loaded for this facility. Refresh the page or check access.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.from("survey_visit_sessions").insert({
        facility_id: selectedFacilityId,
        organization_id: orgId,
        activated_by: userId,
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deactivateSession() {
    if (!canManage || !userId || !activeSessionId) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("survey_visit_sessions")
        .update({
          deactivated_at: new Date().toISOString(),
          deactivated_by: userId,
        })
        .eq("id", activeSessionId);
      if (error) {
        setMessage(error.message);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitLog() {
    if (!canLog || !userId || !activeSessionId || !selectedFacilityId) return;
    if (!orgId) {
      setMessage("Organization could not be loaded for this facility. Refresh the page or check access.");
      return;
    }
    const desc = logDescription.trim();
    if (!desc) {
      setMessage("Describe what was accessed.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.from("survey_visit_log_entries").insert({
        session_id: activeSessionId,
        facility_id: selectedFacilityId,
        organization_id: orgId,
        accessed_by: userId,
        record_type: "other",
        record_description: desc,
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      setLogDescription("");
      setMessage("Access logged.");
    } finally {
      setBusy(false);
    }
  }

  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
    return null;
  }

  if (loading) {
    return (
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
        Survey visit mode…
      </div>
    );
  }

  return (
    <div
      className={`border-b px-4 py-3 dark:border-slate-800 ${
        active ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-slate-200 bg-white dark:bg-slate-950"
      }`}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList
            className={`h-5 w-5 shrink-0 ${active ? "text-amber-700 dark:text-amber-400" : "text-slate-400"}`}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Survey visit mode</p>
            <p className="truncate text-xs text-slate-600 dark:text-slate-400">
              {active
                ? "Session active — log each record pull for the survey trail."
                : "Activate when a surveyor is on site (one active session per facility)."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              {!active ? (
                <Button type="button" size="sm" variant="default" disabled={busy} onClick={() => void activateSession()}>
                  <Power className="mr-1.5 h-4 w-4" />
                  Activate
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void deactivateSession()}>
                  <PowerOff className="mr-1.5 h-4 w-4" />
                  Deactivate
                </Button>
              )}
            </>
          )}
          {!canManage && active && canLog ? (
            <span className="text-xs font-medium text-amber-800 dark:text-amber-200">Survey mode active</span>
          ) : null}
        </div>
      </div>

      {active && canLog ? (
        <div className="mx-auto mt-3 flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="survey-log-desc">
              Log chart / record access
            </label>
            <Input
              id="survey-log-desc"
              value={logDescription}
              onChange={(e) => setLogDescription(e.target.value)}
              placeholder="e.g. Eleanor Martinez — care plan review"
              className="dark:bg-slate-900"
            />
          </div>
          <Button type="button" size="sm" disabled={busy} onClick={() => void submitLog()}>
            Log access
          </Button>
        </div>
      ) : null}

      {loadError ? (
        <p className="mx-auto mt-2 max-w-6xl text-xs text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}
      {message ? <p className="mx-auto mt-2 max-w-6xl text-xs text-slate-600 dark:text-slate-400">{message}</p> : null}
    </div>
  );
}
