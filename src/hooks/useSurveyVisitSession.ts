"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ROLES_MANAGE_SESSION = new Set(["owner", "org_admin", "facility_admin"]);
const ROLES_LOG_ACCESS = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

export function useSurveyVisitSession(facilityId: string | null | undefined) {
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

  const fid =
    typeof facilityId === "string" && isValidFacilityIdForQuery(facilityId) ? facilityId : null;

  const canManage = ROLES_MANAGE_SESSION.has(appRole);
  const canLog = ROLES_LOG_ACCESS.has(appRole);
  const active = !!activeSessionId;

  const refresh = useCallback(async () => {
    if (!fid) {
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
        supabase.from("facilities").select("organization_id").eq("id", fid).maybeSingle(),
        supabase.from("survey_visit_sessions").select("id").eq("facility_id", fid).is("deactivated_at", null).maybeSingle(),
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
  }, [supabase, fid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activateSession = useCallback(async () => {
    if (!canManage || !userId || !fid) return;
    if (!orgId) {
      setMessage("Organization could not be loaded for this facility. Refresh the page or check access.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.from("survey_visit_sessions").insert({
        facility_id: fid,
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
  }, [canManage, userId, fid, orgId, supabase, refresh]);

  const deactivateSession = useCallback(async () => {
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
  }, [canManage, userId, activeSessionId, supabase, refresh]);

  const submitLog = useCallback(async () => {
    if (!canLog || !userId || !activeSessionId || !fid) return;
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
        facility_id: fid,
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
  }, [canLog, userId, activeSessionId, fid, orgId, logDescription, supabase]);

  return {
    facilityId: fid,
    loading,
    busy,
    active,
    canManage,
    canLog,
    loadError,
    message,
    userId,
    orgId,
    activeSessionId,
    logDescription,
    setLogDescription,
    activateSession,
    deactivateSession,
    submitLog,
    refresh,
    supabase,
  };
}

export type SurveyVisitSessionApi = ReturnType<typeof useSurveyVisitSession>;
