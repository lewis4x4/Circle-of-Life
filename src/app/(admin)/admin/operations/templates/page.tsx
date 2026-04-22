"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Clock3,
  FileWarning,
  Layers3,
  RefreshCcw,
  Save,
  Sparkles,
} from "lucide-react";

import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  canAuthorOperationsTemplates,
  OCE_CADENCE_TYPES,
  OCE_PRIORITY_LEVELS,
  OCE_SHIFT_SCOPES,
  OCE_TEMPLATE_ASSIGNEE_ROLES,
  OPERATION_CATEGORY_LABELS,
} from "@/lib/operations/constants";
import {
  normalizeEscalationLadder,
  OPERATION_CADENCE_LABELS,
  type OperationTemplateRecord,
  type OperationTemplateScope,
} from "@/lib/operations/templates";

type FacilityOption = { id: string; name: string };
type LinkOption = { id: string; name: string };

type TemplateFormState = {
  scope: OperationTemplateScope;
  facility_id: string;
  name: string;
  description: string;
  category: string;
  cadence_type: string;
  shift_scope: string;
  day_of_week: string;
  day_of_month: string;
  month_of_year: string;
  assignee_role: string;
  required_role_fallback: string;
  priority: string;
  estimated_minutes: string;
  auto_complete_after_hours: string;
  compliance_requirement: string;
  escalation_ladder: string;
  asset_ref: string;
  vendor_booking_ref: string;
  linked_document_id: string;
  license_threatening: boolean;
  survey_readiness_impact: boolean;
  requires_dual_sign: boolean;
  is_active: boolean;
};

const EMPTY_LADDER = `[
  { "role": "facility_administrator", "sla_minutes": 30, "channel": "in_app", "enabled": true }
]`;

export default function OperationsTemplatesPage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, loading: authLoading } = useHavenAuth();

  const [templates, setTemplates] = useState<OperationTemplateRecord[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [assets, setAssets] = useState<LinkOption[]>([]);
  const [vendors, setVendors] = useState<LinkOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorTemplateId, setEditorTemplateId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<keyof typeof OPERATION_CATEGORY_LABELS | "all">("all");
  const [cadenceFilter, setCadenceFilter] = useState<(typeof OCE_CADENCE_TYPES)[number] | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [scopeFilter, setScopeFilter] = useState<"all" | "org" | "facility">("all");
  const [form, setForm] = useState<TemplateFormState>(() => createEmptyForm(""));

  useEffect(() => {
    if (authLoading) return;
    if (!canAuthorOperationsTemplates(appRole)) {
      router.replace("/admin/operations");
    }
  }, [appRole, authLoading, router]);

  const loadOptions = useCallback(async () => {
    try {
      const facilityResponse = await fetch("/api/admin/facilities?page=1&page_size=100");
      const facilityJson = await facilityResponse.json();
      if (!facilityResponse.ok) throw new Error(facilityJson.error || "Failed to load facilities");
      setFacilities((facilityJson.facilities || []).map((facility: FacilityOption) => ({ id: facility.id, name: facility.name })));

      if (!selectedFacilityId) {
        setAssets([]);
        setVendors([]);
        return;
      }

      const [assetResponse, vendorResponse] = await Promise.all([
        fetch(`/api/admin/operations/assets?facility_id=${encodeURIComponent(selectedFacilityId)}`),
        fetch(`/api/admin/operations/vendors?facility_id=${encodeURIComponent(selectedFacilityId)}`),
      ]);
      const assetJson = await assetResponse.json();
      const vendorJson = await vendorResponse.json();
      if (!assetResponse.ok) throw new Error(assetJson.error || "Failed to load assets");
      if (!vendorResponse.ok) throw new Error(vendorJson.error || "Failed to load vendors");
      setAssets((assetJson.assets || []).map((asset: LinkOption) => ({ id: asset.id, name: asset.name })));
      setVendors((vendorJson.vendors || []).map((vendor: LinkOption) => ({ id: vendor.id, name: vendor.name })));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load template options.");
    }
  }, [selectedFacilityId]);

  const loadTemplates = useCallback(async () => {
    if (authLoading) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedFacilityId) params.set("facility_id", selectedFacilityId);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (cadenceFilter !== "all") params.set("cadence", cadenceFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (scopeFilter !== "all") params.set("scope", scopeFilter);

      const response = await fetch(`/api/admin/operations/templates?${params.toString()}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to load templates");
      setTemplates((json.templates || []) as OperationTemplateRecord[]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  }, [authLoading, cadenceFilter, categoryFilter, scopeFilter, selectedFacilityId, statusFilter]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (editorTemplateId) return;
    setForm((current) => {
      if (current.facility_id || !selectedFacilityId) return current;
      return { ...current, facility_id: selectedFacilityId, scope: "facility" };
    });
  }, [editorTemplateId, selectedFacilityId]);

  const summary = useMemo(() => {
    const active = templates.filter((template) => template.is_active).length;
    const orgWide = templates.filter((template) => !template.facility_id).length;
    const licenseThreatening = templates.filter((template) => template.license_threatening).length;
    const inactive = templates.filter((template) => !template.is_active).length;
    return { active, orgWide, licenseThreatening, inactive };
  }, [templates]);

  const facilityOptions = useMemo(() => {
    if (!selectedFacilityId) return facilities;
    const selected = facilities.find((facility) => facility.id === selectedFacilityId);
    return selected ? [selected, ...facilities.filter((facility) => facility.id !== selectedFacilityId)] : facilities;
  }, [facilities, selectedFacilityId]);

  async function saveTemplate() {
    setError(null);
    if (!form.name.trim() || !form.description.trim()) {
      setError("Name and description are required.");
      return;
    }
    if (form.scope === "facility" && !form.facility_id) {
      setError("Select a facility for facility-scoped templates.");
      return;
    }
    if (form.category === "maintenance" && form.scope === "facility" && !form.asset_ref && assets.length > 0) {
      setError("Select an asset or switch the category away from maintenance.");
      return;
    }
    if (form.category === "vendor_management" && form.scope === "facility" && !form.vendor_booking_ref && vendors.length > 0) {
      setError("Select a vendor or switch the category away from vendor management.");
      return;
    }

    const ladderText = form.escalation_ladder.trim();
    if (ladderText && ladderText !== "[]" && normalizeEscalationLadder(ladderText).length === 0) {
      setError("Escalation ladder JSON is invalid.");
      return;
    }

    const payload = {
      facility_id: form.scope === "org" ? null : form.facility_id || null,
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category,
      cadence_type: form.cadence_type,
      shift_scope: form.shift_scope || null,
      day_of_week: form.day_of_week ? Number.parseInt(form.day_of_week, 10) : null,
      day_of_month: form.day_of_month ? Number.parseInt(form.day_of_month, 10) : null,
      month_of_year: form.month_of_year ? Number.parseInt(form.month_of_year, 10) : null,
      assignee_role: form.assignee_role || null,
      required_role_fallback: form.required_role_fallback || null,
      priority: form.priority,
      estimated_minutes: form.estimated_minutes ? Number.parseInt(form.estimated_minutes, 10) : null,
      auto_complete_after_hours: form.auto_complete_after_hours ? Number.parseInt(form.auto_complete_after_hours, 10) : null,
      compliance_requirement: form.compliance_requirement.trim() || null,
      escalation_ladder: ladderText || "[]",
      asset_ref: form.scope === "facility" ? form.asset_ref || null : null,
      vendor_booking_ref: form.scope === "facility" ? form.vendor_booking_ref || null : null,
      linked_document_id: form.linked_document_id.trim() || null,
      license_threatening: form.license_threatening,
      survey_readiness_impact: form.survey_readiness_impact,
      requires_dual_sign: form.requires_dual_sign,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      const response = await fetch(
        editorTemplateId ? `/api/admin/operations/templates/${editorTemplateId}` : "/api/admin/operations/templates",
        {
          method: editorTemplateId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to save template");
      setEditorTemplateId(null);
      setForm(createEmptyForm(selectedFacilityId || ""));
      await loadTemplates();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTemplate(template: OperationTemplateRecord) {
    setTogglingId(template.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/operations/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !template.is_active }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Failed to update template status");
      await loadTemplates();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to update template status.");
    } finally {
      setTogglingId(null);
    }
  }

  function beginCreate() {
    setEditorTemplateId(null);
    setForm(createEmptyForm(selectedFacilityId || ""));
    setError(null);
  }

  function beginEdit(template: OperationTemplateRecord) {
    setEditorTemplateId(template.id);
    setForm({
      scope: template.facility_id ? "facility" : "org",
      facility_id: template.facility_id ?? selectedFacilityId ?? "",
      name: template.name,
      description: template.description,
      category: template.category,
      cadence_type: template.cadence_type,
      shift_scope: template.shift_scope ?? "",
      day_of_week: template.day_of_week?.toString() ?? "",
      day_of_month: template.day_of_month?.toString() ?? "",
      month_of_year: template.month_of_year?.toString() ?? "",
      assignee_role: template.assignee_role ?? "",
      required_role_fallback: template.required_role_fallback ?? "",
      priority: template.priority,
      estimated_minutes: template.estimated_minutes?.toString() ?? "",
      auto_complete_after_hours: template.auto_complete_after_hours?.toString() ?? "",
      compliance_requirement: template.compliance_requirement ?? "",
      escalation_ladder: JSON.stringify(normalizeEscalationLadder(template.escalation_ladder), null, 2),
      asset_ref: template.asset_ref ?? "",
      vendor_booking_ref: template.vendor_booking_ref ?? "",
      linked_document_id: template.linked_document_id ?? "",
      license_threatening: template.license_threatening,
      survey_readiness_impact: template.survey_readiness_impact,
      requires_dual_sign: template.requires_dual_sign,
      is_active: template.is_active,
    });
    setError(null);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Operations Cadence Engine</p>
        <h1 className="text-3xl font-semibold tracking-tight">Template Authoring</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Version and govern the recurring operations templates that feed Today, Pager, calendar, escalation, and scheduler runs.
        </p>
      </div>

      <OperationsViewNav />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Active templates" value={String(summary.active)} icon={ClipboardList} />
        <SummaryCard label="Org-wide" value={String(summary.orgWide)} icon={Layers3} tone="sky" />
        <SummaryCard label="License threatening" value={String(summary.licenseThreatening)} icon={FileWarning} tone="red" />
        <SummaryCard label="Inactive history" value={String(summary.inactive)} icon={Clock3} tone="amber" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[420px,1fr]">
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{editorTemplateId ? "Edit template" : "New template"}</CardTitle>
                <CardDescription>
                  {editorTemplateId
                    ? "Saving creates a new template version and retires the previous active version."
                    : "Author a reusable task definition for facility or org-wide operations cadence."}
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={beginCreate}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <ToggleField
                id="scope-org"
                label="Org-wide"
                checked={form.scope === "org"}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    scope: checked ? "org" : "facility",
                    facility_id: checked ? "" : current.facility_id || selectedFacilityId || "",
                    asset_ref: "",
                    vendor_booking_ref: "",
                  }))
                }
              />
              <ToggleField
                id="template-active"
                label="Active"
                checked={form.is_active}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, is_active: checked }))}
              />
            </div>

            {form.scope === "facility" ? (
              <Field label="Facility">
                <select
                  value={form.facility_id}
                  onChange={(event) => setForm((current) => ({ ...current, facility_id: event.target.value, asset_ref: "", vendor_booking_ref: "" }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select facility</option>
                  {facilityOptions.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Field label="Name">
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                rows={4}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Category">
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.target.value,
                      asset_ref: event.target.value === "maintenance" ? current.asset_ref : "",
                      vendor_booking_ref: event.target.value === "vendor_management" ? current.vendor_booking_ref : "",
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(OPERATION_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cadence">
                <select
                  value={form.cadence_type}
                  onChange={(event) => setForm((current) => ({ ...current, cadence_type: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {OCE_CADENCE_TYPES.map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {OPERATION_CADENCE_LABELS[cadence]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Assignee role">
                <select
                  value={form.assignee_role}
                  onChange={(event) => setForm((current) => ({ ...current, assignee_role: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Unassigned</option>
                  {OCE_TEMPLATE_ASSIGNEE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fallback role">
                <select
                  value={form.required_role_fallback}
                  onChange={(event) => setForm((current) => ({ ...current, required_role_fallback: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">None</option>
                  {OCE_TEMPLATE_ASSIGNEE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Priority">
                <select
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {OCE_PRIORITY_LEVELS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shift scope">
                <select
                  value={form.shift_scope}
                  onChange={(event) => setForm((current) => ({ ...current, shift_scope: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Not set</option>
                  {OCE_SHIFT_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Day of week">
                <Input value={form.day_of_week} onChange={(event) => setForm((current) => ({ ...current, day_of_week: event.target.value }))} placeholder="1-7" />
              </Field>
              <Field label="Day of month">
                <Input value={form.day_of_month} onChange={(event) => setForm((current) => ({ ...current, day_of_month: event.target.value }))} placeholder="1-31" />
              </Field>
              <Field label="Month of year">
                <Input value={form.month_of_year} onChange={(event) => setForm((current) => ({ ...current, month_of_year: event.target.value }))} placeholder="1-12" />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Estimated minutes">
                <Input value={form.estimated_minutes} onChange={(event) => setForm((current) => ({ ...current, estimated_minutes: event.target.value }))} placeholder="30" />
              </Field>
              <Field label="Auto-complete after hours">
                <Input
                  value={form.auto_complete_after_hours}
                  onChange={(event) => setForm((current) => ({ ...current, auto_complete_after_hours: event.target.value }))}
                  placeholder="Optional"
                />
              </Field>
            </div>

            {form.scope === "facility" && form.category === "maintenance" ? (
              <Field label="Linked asset">
                <select
                  value={form.asset_ref}
                  onChange={(event) => setForm((current) => ({ ...current, asset_ref: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">No linked asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {form.scope === "facility" && form.category === "vendor_management" ? (
              <Field label="Linked vendor">
                <select
                  value={form.vendor_booking_ref}
                  onChange={(event) => setForm((current) => ({ ...current, vendor_booking_ref: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">No linked vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Field label="Compliance requirement">
              <Input
                value={form.compliance_requirement}
                onChange={(event) => setForm((current) => ({ ...current, compliance_requirement: event.target.value }))}
                placeholder="AHCA 59A-36.007"
              />
            </Field>

            <Field label="Escalation ladder JSON">
              <Textarea
                value={form.escalation_ladder}
                onChange={(event) => setForm((current) => ({ ...current, escalation_ladder: event.target.value }))}
                rows={6}
                placeholder={EMPTY_LADDER}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <ToggleField
                id="license-threat"
                label="License threatening"
                checked={form.license_threatening}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, license_threatening: checked }))}
              />
              <ToggleField
                id="survey-impact"
                label="Survey readiness impact"
                checked={form.survey_readiness_impact}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, survey_readiness_impact: checked }))}
              />
              <ToggleField
                id="dual-sign"
                label="Requires dual sign"
                checked={form.requires_dual_sign}
                onCheckedChange={(checked) => setForm((current) => ({ ...current, requires_dual_sign: checked }))}
              />
            </div>

            <Button className="w-full" onClick={() => void saveTemplate()} disabled={saving || authLoading}>
              {saving ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editorTemplateId ? "Save new version" : "Create template"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Refine the authoring queue by template class, cadence, activity state, and scope.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <Field label="Category">
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All</option>
                  {Object.entries(OPERATION_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cadence">
                <select
                  value={cadenceFilter}
                  onChange={(event) => setCadenceFilter(event.target.value as typeof cadenceFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All</option>
                  {OCE_CADENCE_TYPES.map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {OPERATION_CADENCE_LABELS[cadence]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Scope">
                <select
                  value={scopeFilter}
                  onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="org">Org-wide</option>
                  <option value="facility">Facility only</option>
                </select>
              </Field>
            </CardContent>
          </Card>

          {loading ? (
            <Card>
              <CardContent className="py-10 text-sm text-muted-foreground">Loading template registry…</CardContent>
            </Card>
          ) : templates.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No templates matched the current authoring filters.
              </CardContent>
            </Card>
          ) : (
            templates.map((template) => (
              <Card key={template.id} className={!template.is_active ? "border-dashed opacity-80" : undefined}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      <CardDescription>
                        {template.facility_name ?? "Org-wide"} · {OPERATION_CATEGORY_LABELS[template.category] || template.category}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{OPERATION_CADENCE_LABELS[template.cadence_type]}</Badge>
                      <Badge variant="outline">v{template.version}</Badge>
                      {!template.is_active ? <Badge variant="secondary">Inactive</Badge> : null}
                      {template.license_threatening ? <Badge className="bg-rose-600 text-white">License risk</Badge> : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{template.description}</p>

                  <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                    <MetaItem label="Assignee" value={template.assignee_role?.replaceAll("_", " ") || "Unassigned"} />
                    <MetaItem label="Fallback" value={template.required_role_fallback?.replaceAll("_", " ") || "None"} />
                    <MetaItem label="Priority" value={template.priority} />
                    <MetaItem label="Shift scope" value={template.shift_scope || "Not set"} />
                    <MetaItem label="Estimated" value={template.estimated_minutes ? `${template.estimated_minutes} min` : "—"} />
                    <MetaItem label="Compliance" value={template.compliance_requirement || "—"} />
                    <MetaItem label="Asset" value={template.asset_name || "—"} />
                    <MetaItem label="Vendor" value={template.vendor_name || "—"} />
                    <MetaItem label="Auto-complete" value={template.auto_complete_after_hours ? `${template.auto_complete_after_hours}h` : "—"} />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {template.survey_readiness_impact ? <Badge variant="outline">Survey readiness</Badge> : null}
                    {template.requires_dual_sign ? <Badge variant="outline">Dual sign</Badge> : null}
                    {normalizeEscalationLadder(template.escalation_ladder).length > 0 ? (
                      <Badge variant="outline">
                        {normalizeEscalationLadder(template.escalation_ladder).length} escalation step(s)
                      </Badge>
                    ) : (
                      <Badge variant="outline">No escalation ladder</Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => beginEdit(template)}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void toggleTemplate(template)}
                      disabled={togglingId === template.id}
                    >
                      {togglingId === template.id ? (
                        <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {template.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function createEmptyForm(selectedFacilityId: string): TemplateFormState {
  return {
    scope: selectedFacilityId ? "facility" : "org",
    facility_id: selectedFacilityId,
    name: "",
    description: "",
    category: "daily_rounds",
    cadence_type: "daily",
    shift_scope: "all",
    day_of_week: "",
    day_of_month: "",
    month_of_year: "",
    assignee_role: "",
    required_role_fallback: "",
    priority: "normal",
    estimated_minutes: "",
    auto_complete_after_hours: "",
    compliance_requirement: "",
    escalation_ladder: EMPTY_LADDER,
    asset_ref: "",
    vendor_booking_ref: "",
    linked_document_id: "",
    license_threatening: false,
    survey_readiness_impact: false,
    requires_dual_sign: false,
    is_active: true,
  };
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: typeof ClipboardList;
  tone?: "default" | "sky" | "amber" | "red";
}) {
  const toneClass =
    tone === "sky"
      ? "border-sky-200 bg-sky-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "red"
          ? "border-rose-200 bg-rose-50"
          : "";
  return (
    <Card className={toneClass}>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-semibold">{value}</div>
        </div>
        <Icon className="h-7 w-7 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleField({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
