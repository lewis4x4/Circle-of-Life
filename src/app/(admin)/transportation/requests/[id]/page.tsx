"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addHours, format, parseISO } from "date-fns";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  TRANSPORT_REQUEST_DETAIL_LOADING_PROFILE_COPY,
  TRANSPORT_REQUEST_DETAIL_LOADING_REQUEST_COPY,
} from "@/lib/transport/transport-request-detail-display-copy";
import {
  isTransportRequestDetailSubmitBlocked,
  resolveTransportRequestDetailEffectiveOrganizationId,
  resolveTransportRequestDetailFetchErrorBannerMessage,
  resolveTransportRequestDetailOrganizationGapMessage,
  resolveTransportRequestDetailSignInGapMessage,
  resolveTransportRequestDetailSubmitButtonLabel,
} from "@/lib/transport/transport-request-detail-page-state";
import { triggerFileDownload } from "@/lib/csv-export";
import { DEFAULT_MILEAGE_RATE_CENTS } from "@/lib/transport/mileage-defaults";
import { formatCentsPerMileUsd, getOrganizationMileageRateCents } from "@/lib/transport/org-mileage-rate";
import {
  mileageLogLinkSchema,
  normalizeTimeForDb,
  residentTransportRequestUpdateSchema,
} from "@/lib/transport/transport-request-schemas";
import {
  buildGoogleCalendarTemplateUrl,
  buildOutlookCalendarComposeUrl,
} from "@/lib/transport/google-calendar-template-url";
import {
  isCredentialDateValid,
  wheelchairVehicleError,
} from "@/lib/transport/transport-request-validation";
import { buildTransportRequestsIcs } from "@/lib/transportation/transport-requests-ics";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type TransportType = Database["public"]["Enums"]["transport_type"];
type TransportStatus = Database["public"]["Enums"]["transport_request_status"];

type RequestRow = Database["public"]["Tables"]["resident_transport_requests"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

const TRANSPORT_TYPES: { value: TransportType; label: string }[] = [
  { value: "facility_vehicle", label: "Facility vehicle" },
  { value: "staff_personal_vehicle", label: "Staff personal vehicle" },
  { value: "third_party", label: "Third-party" },
];

const STATUS_OPTIONS: { value: TransportStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function EditResidentTransportRequestPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [row, setRow] = useState<RequestRow | null>(null);
  const [facilityName, setFacilityName] = useState<string>("Facility");

  const [staffOptions, setStaffOptions] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [fleetOptions, setFleetOptions] = useState<
    { id: string; name: string; wheelchair_accessible: boolean }[]
  >([]);
  const [driverCredByStaff, setDriverCredByStaff] = useState<
    Record<string, { license_expires_on: string | null; medical_card_expires_on: string | null }>
  >({});

  const [transportType, setTransportType] = useState<TransportType>("facility_vehicle");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [purpose, setPurpose] = useState("");
  const [wheelchairRequired, setWheelchairRequired] = useState(false);
  const [escortRequired, setEscortRequired] = useState(false);
  const [escortStaffId, setEscortStaffId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverStaffId, setDriverStaffId] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [status, setStatus] = useState<TransportStatus>("requested");
  const [cancellationReason, setCancellationReason] = useState("");
  const [notes, setNotes] = useState("");

  const [mileageOrigin, setMileageOrigin] = useState("");
  const [mileageDestination, setMileageDestination] = useState("");
  const [mileageMiles, setMileageMiles] = useState("");
  const [mileageRoundTrip, setMileageRoundTrip] = useState(false);
  const [orgMileageRateCents, setOrgMileageRateCents] = useState(DEFAULT_MILEAGE_RATE_CENTS);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }
    if (!id || !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data: req, error: reqErr }, { data: fac, error: facErr }, staffRes, fleetRes, credRes] = await Promise.all([
        supabase
          .from("resident_transport_requests")
          .select("*, residents(first_name, last_name)")
          .eq("id", id)
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase.from("facilities").select("name").eq("id", selectedFacilityId).maybeSingle(),
        supabase
          .from("staff")
          .select("id, first_name, last_name")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("last_name", { ascending: true })
          .limit(200),
        supabase
          .from("fleet_vehicles")
          .select("id, name, wheelchair_accessible")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(80),
        supabase
          .from("driver_credentials")
          .select("staff_id, license_expires_on, medical_card_expires_on")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null),
      ]);
      if (reqErr) throw reqErr;
      if (facErr) throw facErr;
      if (staffRes.error) throw staffRes.error;
      if (fleetRes.error) throw fleetRes.error;
      if (credRes.error) throw credRes.error;
      if (!req) {
        setLoadError("Request not found.");
        setRow(null);
        return;
      }
      const r = req as RequestRow;
      setRow(r);
      const rateCents = await getOrganizationMileageRateCents(supabase, r.organization_id);
      setOrgMileageRateCents(rateCents);
      if (fac?.name) setFacilityName(fac.name);
      setStaffOptions((staffRes.data ?? []) as { id: string; first_name: string; last_name: string }[]);
      setFleetOptions(
        (fleetRes.data ?? []) as { id: string; name: string; wheelchair_accessible: boolean }[],
      );
      const credMap: Record<string, { license_expires_on: string | null; medical_card_expires_on: string | null }> =
        {};
      for (const c of credRes.data ?? []) {
        credMap[c.staff_id] = {
          license_expires_on: c.license_expires_on,
          medical_card_expires_on: c.medical_card_expires_on,
        };
      }
      setDriverCredByStaff(credMap);

      setTransportType(r.transport_type);
      setAppointmentDate(r.appointment_date);
      setAppointmentTime(r.appointment_time ? r.appointment_time.slice(0, 5) : "");
      setDestinationName(r.destination_name);
      setDestinationAddress(r.destination_address ?? "");
      setPurpose(r.purpose);
      setWheelchairRequired(r.wheelchair_required);
      setEscortRequired(r.escort_required);
      setEscortStaffId(r.escort_staff_id ?? "");
      setVehicleId(r.vehicle_id ?? "");
      setDriverStaffId(r.driver_staff_id ?? "");
      setPickupTime(r.pickup_time ? r.pickup_time.slice(0, 5) : "");
      setReturnTime(r.return_time ? r.return_time.slice(0, 5) : "");
      setStatus(r.status);
      setCancellationReason(r.cancellation_reason ?? "");
      setNotes(r.notes ?? "");
      setMileageOrigin(fac?.name ? `${fac.name} (departure)` : "Facility");
      setMileageDestination(r.destination_name);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load.");
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [authLoading, supabase, id, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedVehicle = useMemo(
    () => fleetOptions.find((v) => v.id === vehicleId) ?? null,
    [fleetOptions, vehicleId],
  );

  const driverLicenseOk = useMemo(() => {
    if (!driverStaffId) return true;
    const c = driverCredByStaff[driverStaffId];
    if (!c) return false;
    return isCredentialDateValid(c.license_expires_on) || isCredentialDateValid(c.medical_card_expires_on);
  }, [driverCredByStaff, driverStaffId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
    const effectiveOrganizationId = resolveTransportRequestDetailEffectiveOrganizationId(
      organizationId,
      row?.organization_id,
    );
    if (
      isTransportRequestDetailSubmitBlocked({
        saving,
        authLoading,
        user,
        effectiveOrganizationId,
        facilityReady,
        hasRow: Boolean(row),
      })
    ) {
      return;
    }
    if (!row || !selectedFacilityId || !user || !effectiveOrganizationId) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = residentTransportRequestUpdateSchema.safeParse({
        transport_type: transportType,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime.trim() || null,
        destination_name: destinationName,
        destination_address: destinationAddress.trim() || null,
        purpose,
        wheelchair_required: wheelchairRequired,
        escort_required: escortRequired,
        escort_staff_id: escortStaffId,
        vehicle_id: vehicleId,
        driver_staff_id: driverStaffId,
        pickup_time: pickupTime.trim() || null,
        return_time: returnTime.trim() || null,
        status,
        cancellation_reason: cancellationReason.trim() || null,
        notes: notes.trim() || null,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((x) => x.message).join(" ") || "Invalid form.");
      }

      const whErr = wheelchairVehicleError(
        parsed.data.wheelchair_required,
        selectedVehicle ? selectedVehicle.wheelchair_accessible : null,
      );
      if (whErr && parsed.data.vehicle_id) throw new Error(whErr);

      if (parsed.data.driver_staff_id && !driverLicenseOk) {
        throw new Error(
          "Driver license (or medical card) on file appears expired. Update driver credentials before assigning.",
        );
      }

      const pt = normalizeTimeForDb(parsed.data.pickup_time ?? undefined);
      const rt = normalizeTimeForDb(parsed.data.return_time ?? undefined);
      const at = normalizeTimeForDb(parsed.data.appointment_time ?? undefined);

      const { error: upErr } = await supabase
        .from("resident_transport_requests")
        .update({
          transport_type: parsed.data.transport_type,
          appointment_date: parsed.data.appointment_date,
          appointment_time: at,
          destination_name: parsed.data.destination_name,
          destination_address: parsed.data.destination_address,
          purpose: parsed.data.purpose,
          wheelchair_required: parsed.data.wheelchair_required,
          escort_required: parsed.data.escort_required,
          escort_staff_id: parsed.data.escort_staff_id,
          vehicle_id: parsed.data.vehicle_id,
          driver_staff_id: parsed.data.driver_staff_id,
          pickup_time: pt,
          return_time: rt,
          status: parsed.data.status,
          cancellation_reason: parsed.data.cancellation_reason,
          notes: parsed.data.notes,
          updated_by: user.id,
        })
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);

      if (
        parsed.data.status === "completed" &&
        parsed.data.transport_type === "staff_personal_vehicle" &&
        parsed.data.driver_staff_id &&
        mileageMiles.trim() !== ""
      ) {
        const ml = mileageLogLinkSchema.safeParse({
          origin: mileageOrigin,
          destination: mileageDestination,
          miles: mileageMiles,
          round_trip: mileageRoundTrip,
        });
        if (!ml.success) throw new Error(ml.error.issues.map((x) => x.message).join(" "));
        const milesNum = ml.data.miles;
        const totalMiles = ml.data.round_trip ? milesNum * 2 : milesNum;
        const rateCents = await getOrganizationMileageRateCents(supabase, effectiveOrganizationId);
        const reimbursement_amount_cents = Math.round(totalMiles * rateCents);

        const { data: existingMl } = await supabase
          .from("mileage_logs")
          .select("id")
          .eq("transport_request_id", row.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!existingMl) {
          const { error: mErr } = await supabase.from("mileage_logs").insert({
            organization_id: effectiveOrganizationId,
            facility_id: selectedFacilityId,
            staff_id: parsed.data.driver_staff_id,
            trip_date: parsed.data.appointment_date,
            purpose: parsed.data.purpose,
            origin: ml.data.origin,
            destination: ml.data.destination,
            round_trip: ml.data.round_trip,
            miles: milesNum,
            reimbursement_rate_cents: rateCents,
            reimbursement_amount_cents,
            resident_id: row.resident_id,
            transport_request_id: row.id,
            created_by: user.id,
            updated_by: user.id,
          });
          if (mErr) throw mErr;
        }
      }

      router.refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const hasOrgScopedData = Boolean(row?.organization_id);
  const effectiveOrganizationId = resolveTransportRequestDetailEffectiveOrganizationId(
    organizationId,
    row?.organization_id,
  );
  const organizationGapMessage = resolveTransportRequestDetailOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });
  const signInGapMessage = resolveTransportRequestDetailSignInGapMessage({
    authLoading,
    user,
  });
  const saveErrorBannerMessage = resolveTransportRequestDetailFetchErrorBannerMessage({
    authLoading,
    fetchError: error,
  });
  const loadErrorBannerMessage = resolveTransportRequestDetailFetchErrorBannerMessage({
    authLoading,
    fetchError: loadError,
  });
  const submitBlocked = isTransportRequestDetailSubmitBlocked({
    saving,
    authLoading,
    user,
    effectiveOrganizationId,
    facilityReady,
    hasRow: Boolean(row),
  });
  const selectClass = cn(
    "h-9 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  const showMileageHint = transportType === "staff_personal_vehicle" && Boolean(driverStaffId);

  const externalCalendarHandoff = useMemo(() => {
    if (!row) return null;
    if (!appointmentDate) return null;
    const timePart = appointmentTime.trim() || "09:00";
    const start = new Date(`${appointmentDate}T${timePart}:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = addHours(start, 1);
    const rn = row.residents
      ? `${row.residents.first_name} ${row.residents.last_name}`
      : "Resident";
    const calParams = {
      title: `Transport: ${rn} — ${destinationName}`,
      details: [purpose.trim(), notes.trim()].filter(Boolean).join("\n\n") || undefined,
      location: [destinationName.trim(), destinationAddress.trim()].filter(Boolean).join(" — ") || undefined,
      start,
      end,
    };
    return {
      google: buildGoogleCalendarTemplateUrl(calParams),
      outlook: buildOutlookCalendarComposeUrl(calParams),
    };
  }, [row, appointmentDate, appointmentTime, destinationName, destinationAddress, purpose, notes]);

  const downloadTripIcs = useCallback(() => {
    if (!row || !appointmentDate) return;
    const at = normalizeTimeForDb(appointmentTime);
    const ics = buildTransportRequestsIcs(
      [
        {
          id: row.id,
          appointment_date: appointmentDate,
          appointment_time: at,
          destination_name: destinationName,
          purpose,
          status,
          destination_address: destinationAddress.trim() || null,
          residents: row.residents,
        },
      ],
      "Haven transport (one trip)",
    );
    triggerFileDownload(`haven-transport-${row.id}.ics`, ics, "text/calendar;charset=utf-8");
  }, [
    row,
    appointmentDate,
    appointmentTime,
    destinationName,
    destinationAddress,
    purpose,
    status,
  ]);

  if (!facilityReady && !authLoading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-warning">Select a facility first.</p>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {TRANSPORT_REQUEST_DETAIL_LOADING_PROFILE_COPY}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {TRANSPORT_REQUEST_DETAIL_LOADING_REQUEST_COPY}
        </p>
      </div>
    );
  }

  if (loadErrorBannerMessage || !row) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        {loadErrorBannerMessage ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            {loadErrorBannerMessage}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Request not found.</p>
        )}
        <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to transportation
        </Link>
      </div>
    );
  }

  const residentName = row.residents
    ? `${row.residents.first_name} ${row.residents.last_name}`
    : "Resident";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <RecordDetailHeader
        title="Transport request"
        subtitle={residentName}
        backLink={{ label: "Back to transportation", href: "/admin/transportation" }}
      />

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {signInGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{signInGapMessage}</CardContent>
        </Card>
      ) : null}

      {saveErrorBannerMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {saveErrorBannerMessage}
        </p>
      ) : null}

      <RecordDetailSection
        title="Schedule & assignment"
        description="Assign vehicle/driver on site; license and wheelchair rules validated on save (spec 15)."
      >
        <form className="space-y-4" onSubmit={(e) => void save(e)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Appointment date (ET)</Label>
              <Input
                type="date"
                required
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Appointment time</Label>
              <Input type="time" value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} />
            </div>
          </div>
          {/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) ? (
            <p className="text-sm text-muted-foreground">
              <Link
                href={`/admin/transportation/calendar?date=${encodeURIComponent(appointmentDate)}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                View on transportation calendar
              </Link>
              <span className="text-muted-foreground"> — week containing this appointment.</span>
            </p>
          ) : null}
          {externalCalendarHandoff ? (
            <p className="text-sm text-muted-foreground">
              <span>Add to calendar: </span>
              <a
                href={externalCalendarHandoff.google}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Google
              </a>
              <span className="text-muted-foreground"> · </span>
              <a
                href={externalCalendarHandoff.outlook}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Outlook
              </a>
              <span className="text-muted-foreground"> · </span>
              <button
                type="button"
                onClick={() => downloadTripIcs()}
                className="inline bg-transparent p-0 font-medium text-primary underline-offset-4 hover:underline"
              >
                Download .ics
              </button>
              <span className="text-muted-foreground">
                {" "}
                — one-way handoff, not a live sync. Use .ics for Apple Calendar.
              </span>
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="tt">Transport type</Label>
            <select
              id="tt"
              className={selectClass}
              value={transportType}
              onChange={(e) => setTransportType(e.target.value as TransportType)}
            >
              {TRANSPORT_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dest">Destination name</Label>
            <Input id="dest" required value={destinationName} onChange={(e) => setDestinationName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desta">Destination address</Label>
            <Input id="desta" value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purp">Purpose</Label>
            <Input id="purp" required value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wheelchairRequired}
                onChange={(e) => setWheelchairRequired(e.target.checked)}
                className="rounded border-input"
              />
              Wheelchair required
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={escortRequired}
                onChange={(e) => setEscortRequired(e.target.checked)}
                className="rounded border-input"
              />
              Escort required
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Vehicle</Label>
              <select className={selectClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">— None —</option>
                {(wheelchairRequired ? fleetOptions.filter((v) => v.wheelchair_accessible) : fleetOptions).map(
                  (v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.wheelchair_accessible ? " (WC)" : ""}
                    </option>
                  ),
                )}
              </select>
              {wheelchairRequired ? (
                <p className="text-xs text-muted-foreground">Only wheelchair-accessible units are listed.</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Driver (staff)</Label>
              <select
                className={selectClass}
                value={driverStaffId}
                onChange={(e) => setDriverStaffId(e.target.value)}
              >
                <option value="">— None —</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name}, {s.first_name}
                  </option>
                ))}
              </select>
              {driverStaffId && !driverLicenseOk ? (
                <p className="text-xs text-warning">
                  No valid license/medical card on file for this driver (or credentials missing).
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Escort (optional)</Label>
            <select className={selectClass} value={escortStaffId} onChange={(e) => setEscortStaffId(e.target.value)}>
              <option value="">— None —</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.last_name}, {s.first_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Pickup time</Label>
              <Input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Return time</Label>
              <Input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as TransportStatus)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {status === "cancelled" ? (
            <div className="space-y-2">
              <Label>Cancellation reason</Label>
              <Input value={cancellationReason} onChange={(e) => setCancellationReason(e.target.value)} />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {showMileageHint ? (
            <div className="rounded-[8px] border border-border bg-muted/40 p-[14px]">
              <h3 className="text-sm font-semibold text-foreground">
                Optional mileage log (staff personal vehicle)
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                If you set status to Completed, you can log reimbursable miles linked to this request. Effective rate:{" "}
                <strong>{formatCentsPerMileUsd(orgMileageRateCents)}</strong> per mile (snapshotted on the mileage log).{" "}
                <Link href="/admin/transportation/settings" className="underline underline-offset-2 hover:text-foreground">
                  Organization reimbursement settings
                </Link>
                . Leave miles blank to skip.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Trip origin</Label>
                  <Input value={mileageOrigin} onChange={(e) => setMileageOrigin(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Trip destination label</Label>
                  <Input value={mileageDestination} onChange={(e) => setMileageDestination(e.target.value)} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Miles (one-way)</Label>
                  <Input
                    inputMode="decimal"
                    value={mileageMiles}
                    onChange={(e) => setMileageMiles(e.target.value)}
                    placeholder="e.g. 12.5"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={mileageRoundTrip}
                    onChange={(e) => setMileageRoundTrip(e.target.checked)}
                    className="rounded border-input"
                  />
                  Round trip (doubles miles)
                </label>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitBlocked}>
              {resolveTransportRequestDetailSubmitButtonLabel({
                saving,
                authLoading,
                user,
                effectiveOrganizationId,
              })}
            </Button>
            <Link href={`/admin/residents/${row.resident_id}`} className={cn(buttonVariants({ variant: "ghost" }))}>
              View resident
            </Link>
          </div>
        </form>
      </RecordDetailSection>

      <p className="text-xs text-muted-foreground">
        Created {format(parseISO(row.created_at), "PPp")}. Facility: {facilityName}.
      </p>
    </div>
  );
}
