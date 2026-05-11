"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  Flame,
  Zap,
  Calendar,
  FileText,
  Wrench,
} from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type ChecklistItem = {
  id: string;
  checklist_type: string;
  title: string;
  description: string | null;
  frequency_days: number;
  next_due_date: string;
  last_completed_at: string | null;
  last_participants: string[] | null;
  last_notes: string | null;
  overdue: boolean;
};

type CompletionDialogState = {
  open: boolean;
  itemId: string | null;
  participants: string;
  notes: string;
};

type FacilityOrganizationRow = {
  organization_id: string | null;
};

type EmergencyChecklistItemRow = {
  id: string;
  checklist_type: string;
  title: string;
  description: string | null;
  frequency_days: number;
  next_due_date: string;
  last_completed_at: string | null;
  last_completed_by: string | null;
  last_participants: string[] | null;
  last_notes: string | null;
};

type EmergencyChecklistCompletionInsert = {
  checklist_item_id: string;
  facility_id: string;
  organization_id: string;
  completed_by: string;
  participants: string[];
  notes: string | null;
};

type EmergencyChecklistItemCompletionUpdate = {
  last_completed_at: string;
  last_completed_by: string;
  last_participants: string[];
  last_notes: string | null;
  next_due_date: string;
};

type EmergencyChecklistItemInsert = {
  facility_id: string;
  organization_id: string;
  checklist_type: string;
  title: string;
  description: string | null;
  frequency_days: number;
  next_due_date: string;
};

type DrillType = "fire" | "elopement" | "tornado";

type DrillLogRow = {
  id: string;
  drill_type: DrillType;
  drill_date: string;
  drill_time: string;
  pull_station_activated: boolean;
  staff_present_count: number | null;
  residents_present_count: number | null;
  notes: string | null;
};

type DrillLogInsert = {
  facility_id: string;
  organization_id: string;
  drill_type: DrillType;
  drill_date: string;
  drill_time: string;
  pull_station_activated: boolean;
  staff_present_count: number | null;
  residents_present_count: number | null;
  notes: string | null;
};

type MaintenanceTicketRow = {
  id: string;
  asset_description: string;
  issue_description: string;
  priority: "urgent" | "high" | "normal" | "low";
  status: "open" | "assigned" | "in_progress" | "completed" | "cancelled";
  opened_at: string;
};

type MaintenanceTicketInsert = {
  facility_id: string;
  organization_id: string;
  asset_description: string;
  issue_description: string;
  priority: "urgent" | "high" | "normal" | "low";
};

type MaintenanceCompletionRow = {
  id: string;
  task_type: string;
  completed_at: string;
  completed_by_vendor: string | null;
  notes: string | null;
  related_ticket_id: string | null;
};

type MaintenanceCompletionInsert = {
  facility_id: string;
  organization_id: string;
  task_type: string;
  completed_by_user_id: string | null;
  completed_by_vendor: string | null;
  notes: string | null;
  related_ticket_id: string | null;
};

const CHECKLIST_TYPES = [
  { value: "generator_test", label: "Generator Test", icon: Zap },
  { value: "fire_drill", label: "Fire Drill", icon: Flame },
  { value: "evacuation_drill", label: "Evacuation Drill", icon: AlertTriangle },
  { value: "other", label: "Other", icon: FileText },
] as const;

export default function EmergencyPreparednessPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [drillLog, setDrillLog] = useState<DrillLogRow[]>([]);
  const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicketRow[]>([]);
  const [maintenanceCompletions, setMaintenanceCompletions] = useState<MaintenanceCompletionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Completion dialog state
  const [completionDialog, setCompletionDialog] = useState<CompletionDialogState>({
    open: false,
    itemId: null,
    participants: "",
    notes: "",
  });
  const [savingCompletion, setSavingCompletion] = useState(false);

  // New item form state
  const [newItemDialog, setNewItemDialog] = useState({
    open: false,
    type: "generator_test",
    title: "",
    description: "",
    frequency: 30,
  });
  const [savingNewItem, setSavingNewItem] = useState(false);
  const [newDrill, setNewDrill] = useState({
    drill_type: "fire" as DrillType,
    drill_date: new Date().toISOString().slice(0, 10),
    drill_time: "10:00",
    pull_station_activated: false,
    staff_present_count: "",
    residents_present_count: "",
    notes: "",
  });
  const [savingDrill, setSavingDrill] = useState(false);
  const [newTicket, setNewTicket] = useState({
    asset_description: "",
    issue_description: "",
    priority: "normal" as MaintenanceTicketInsert["priority"],
  });
  const [savingTicket, setSavingTicket] = useState(false);
  const [newCompletion, setNewCompletion] = useState({
    task_type: "monthly_leak_check",
    completed_by_vendor: "",
    notes: "",
    related_ticket_id: "",
  });
  const [savingCompletionLog, setSavingCompletionLog] = useState(false);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const loadItems = useCallback(async () => {
    if (!facilityReady) {
      setItems([]);
      setDrillLog([]);
      setMaintenanceTickets([]);
      setMaintenanceCompletions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [checklistData, drillData, ticketData, completionData] = await Promise.all([
        fetchEmergencyChecklistItems(supabase, selectedFacilityId!),
        fetchDrillLog(supabase, selectedFacilityId!),
        fetchMaintenanceTickets(supabase, selectedFacilityId!),
        fetchMaintenanceCompletions(supabase, selectedFacilityId!),
      ]);
      setItems(checklistData);
      setDrillLog(drillData);
      setMaintenanceTickets(ticketData);
      setMaintenanceCompletions(completionData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load checklist items");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, facilityReady, supabase]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const submitCompletion = async () => {
    if (!completionDialog.itemId || !facilityReady) return;

    setSavingCompletion(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("Not authenticated");
      }

      const organizationId = await loadOrganizationIdForFacility(supabase, selectedFacilityId!);

      if (!organizationId) {
        throw new Error("Could not determine organization ID");
      }

      // Create completion record
      const participants = completionDialog.participants.split(",").map((p) => p.trim()).filter(Boolean);
      await insertEmergencyChecklistCompletion(supabase, {
        checklist_item_id: completionDialog.itemId,
        facility_id: selectedFacilityId!,
        organization_id: organizationId,
        completed_by: user.id,
        participants,
        notes: completionDialog.notes || null,
      });

      // Update the checklist item

      const item = items.find((i) => i.id === completionDialog.itemId);
      if (!item) return;

      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + item.frequency_days);

      await updateEmergencyChecklistItemCompletion(
        supabase,
        completionDialog.itemId,
        {
          last_completed_at: new Date().toISOString(),
          last_completed_by: user.id,
          last_participants: participants,
          last_notes: completionDialog.notes || null,
          next_due_date: nextDueDate.toISOString().split("T")[0],
        }
      );

      // Close dialog and reload
      setCompletionDialog({ open: false, itemId: null, participants: "", notes: "" });
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record completion");
    } finally {
      setSavingCompletion(false);
    }
  };

  const submitNewItem = async () => {
    if (!facilityReady) return;

    setSavingNewItem(true);
    setError(null);

    try {
      const organizationId = await loadOrganizationIdForFacility(supabase, selectedFacilityId!);

      if (!organizationId) {
        throw new Error("Could not determine organization ID");
      }

      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + newItemDialog.frequency);

      await insertEmergencyChecklistItem(supabase, {
        facility_id: selectedFacilityId!,
        organization_id: organizationId,
        checklist_type: newItemDialog.type,
        title: newItemDialog.title,
        description: newItemDialog.description || null,
        frequency_days: newItemDialog.frequency,
        next_due_date: nextDueDate.toISOString().split("T")[0],
      });

      // Close dialog and reload
      setNewItemDialog({
        open: false,
        type: "generator_test",
        title: "",
        description: "",
        frequency: 30,
      });
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create checklist item");
    } finally {
      setSavingNewItem(false);
    }
  };

  const submitDrillLog = async () => {
    if (!facilityReady) return;
    setSavingDrill(true);
    setError(null);
    try {
      const organizationId = await loadOrganizationIdForFacility(supabase, selectedFacilityId!);
      if (!organizationId) throw new Error("Could not determine organization ID");
      const staffCount = newDrill.staff_present_count ? Number(newDrill.staff_present_count) : null;
      const residentCount = newDrill.residents_present_count ? Number(newDrill.residents_present_count) : null;
      if (!newDrill.drill_date || !newDrill.drill_time) {
        throw new Error("Drill date and time are required.");
      }
      if (staffCount !== null && (!Number.isFinite(staffCount) || staffCount < 0)) {
        throw new Error("Staff present count must be zero or greater.");
      }
      if (residentCount !== null && (!Number.isFinite(residentCount) || residentCount < 0)) {
        throw new Error("Residents present count must be zero or greater.");
      }
      await insertDrillLog(supabase, {
        facility_id: selectedFacilityId!,
        organization_id: organizationId,
        drill_type: newDrill.drill_type,
        drill_date: newDrill.drill_date,
        drill_time: newDrill.drill_time,
        pull_station_activated: newDrill.pull_station_activated,
        staff_present_count: staffCount,
        residents_present_count: residentCount,
        notes: newDrill.notes.trim() || null,
      });
      setNewDrill({ ...newDrill, notes: "", staff_present_count: "", residents_present_count: "" });
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save drill log");
    } finally {
      setSavingDrill(false);
    }
  };

  const submitMaintenanceTicket = async () => {
    if (!facilityReady || !newTicket.asset_description.trim() || !newTicket.issue_description.trim()) return;
    setSavingTicket(true);
    setError(null);
    try {
      const organizationId = await loadOrganizationIdForFacility(supabase, selectedFacilityId!);
      if (!organizationId) throw new Error("Could not determine organization ID");
      await insertMaintenanceTicket(supabase, {
        facility_id: selectedFacilityId!,
        organization_id: organizationId,
        asset_description: newTicket.asset_description.trim(),
        issue_description: newTicket.issue_description.trim(),
        priority: newTicket.priority,
      });
      setNewTicket({ asset_description: "", issue_description: "", priority: "normal" });
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create maintenance ticket");
    } finally {
      setSavingTicket(false);
    }
  };

  const submitMaintenanceCompletion = async () => {
    if (!facilityReady || !newCompletion.task_type.trim()) return;
    setSavingCompletionLog(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const organizationId = await loadOrganizationIdForFacility(supabase, selectedFacilityId!);
      if (!organizationId) throw new Error("Could not determine organization ID");
      await insertMaintenanceCompletion(supabase, {
        facility_id: selectedFacilityId!,
        organization_id: organizationId,
        task_type: newCompletion.task_type.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        completed_by_user_id: newCompletion.completed_by_vendor.trim() ? null : user.id,
        completed_by_vendor: newCompletion.completed_by_vendor.trim() || null,
        notes: newCompletion.notes.trim() || null,
        related_ticket_id: newCompletion.related_ticket_id || null,
      });
      setNewCompletion({ ...newCompletion, notes: "", related_ticket_id: "", completed_by_vendor: "" });
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log maintenance completion");
    } finally {
      setSavingCompletionLog(false);
    }
  };

  const getDaysUntilDue = (dueDate: string) => {
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getTypeIcon = (type: string) => {
    const found = CHECKLIST_TYPES.find((t) => t.value === type);
    return found?.icon || FileText;
  };

  const getTypeLabel = (type: string) => {
    const found = CHECKLIST_TYPES.find((t) => t.value === type);
    return found?.label || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-slate-500">Loading emergency preparedness checklist…</p>
      </div>
    );
  }

  if (!facilityReady) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle>Select a Facility</CardTitle>
          <CardDescription>Choose a facility to view emergency preparedness checklist.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Count overdue items
  const overdueCount = items.filter((i) => i.overdue).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Compliance Engine</p>
          <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Emergency Preparedness
          </h1>
        </div>
        <div className="flex gap-3">
          <Dialog
            open={newItemDialog.open}
            onOpenChange={(open) => setNewItemDialog({ ...newItemDialog, open })}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Emergency Preparedness Item</DialogTitle>
                <DialogDescription>
                  Create a new item for the emergency preparedness checklist.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={newItemDialog.type}
                    onValueChange={(v) => v && setNewItemDialog({ ...newItemDialog, type: v as typeof newItemDialog.type })}
                  >
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHECKLIST_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="h-4 w-4" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={newItemDialog.title}
                    onChange={(e) => setNewItemDialog({ ...newItemDialog, title: e.target.value })}
                    placeholder="e.g., Monthly Fire Safety Inspection"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={newItemDialog.description}
                    onChange={(e) => setNewItemDialog({ ...newItemDialog, description: e.target.value })}
                    placeholder="Optional description of this item..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequency (days)</Label>
                  <Input
                    id="frequency"
                    type="number"
                    value={newItemDialog.frequency}
                    onChange={(e) => setNewItemDialog({ ...newItemDialog, frequency: parseInt(e.target.value) || 30 })}
                    min="1"
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <Button
                    onClick={() => void submitNewItem()}
                    disabled={savingNewItem || !newItemDialog.title.trim()}
                  >
                    {savingNewItem ? "Creating…" : "Create"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overdue Alert */}
      {overdueCount > 0 && (
        <Card className="border-rose-500 bg-rose-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
              <div>
                <p className="font-semibold text-rose-900">
                  {overdueCount} overdue item{overdueCount !== 1 ? "s" : ""}
                </p>
                <p className="text-sm text-rose-700">
                  Please complete these items to maintain compliance.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500 bg-rose-50">
          <CardContent className="py-4">
            <p className="font-medium text-rose-900">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Checklist Items */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
              No Emergency Items Configured
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Add generator tests, fire drills, and evacuation drills to track emergency preparedness.
            </p>
            <Button onClick={() => setNewItemDialog({ ...newItemDialog, open: true })}>
              <Plus className="mr-2 h-4 w-4" />
              Add First Item
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const TypeIcon = getTypeIcon(item.checklist_type);
            const daysUntil = getDaysUntilDue(item.next_due_date);
            const isOverdue = daysUntil < 0;
            const isDueSoon = daysUntil >= 0 && daysUntil <= 7;

            return (
              <li key={item.id}>
                <Card
                  className={`transition-all ${
                    isOverdue
                      ? "border-rose-500 bg-rose-50"
                      : isDueSoon
                        ? "border-amber-500 bg-amber-50"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div
                          className={`p-3 rounded-lg ${
                            isOverdue
                              ? "bg-rose-100"
                              : isDueSoon
                                ? "bg-amber-100"
                                : "bg-slate-100"
                          }`}
                        >
                          <TypeIcon className={`h-5 w-5 ${
                            isOverdue
                              ? "text-rose-600"
                              : isDueSoon
                                ? "text-amber-600"
                                : "text-slate-600"
                          }`} />
                        </div>
                        <div className="flex-1 space-y-1">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.title}
                          </h3>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {getTypeLabel(item.checklist_type)}
                            </Badge>
                            {isOverdue && (
                              <Badge className="bg-rose-500 text-white text-xs">Overdue</Badge>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              {item.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 text-sm">
                            <Calendar className="h-4 w-4 text-slate-500" />
                            <span className={isOverdue ? "text-rose-600 font-medium" : isDueSoon ? "text-amber-600" : "text-slate-500"}>
                              {isOverdue
                                ? `Overdue by ${Math.abs(daysUntil)} days`
                                : isDueSoon
                                  ? `Due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`
                                  : `Due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                          {item.last_completed_at && (
                            <div className="text-xs text-slate-500">
                              Last completed: {new Date(item.last_completed_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                      <Dialog
                        open={completionDialog.open && completionDialog.itemId === item.id}
                        onOpenChange={(open) =>
                          setCompletionDialog({
                            open,
                            itemId: open ? item.id : null,
                            participants: "",
                            notes: "",
                          })
                        }
                      >
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <CheckCircle className="mr-1 h-4 w-4" />
                            Log Completion
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Log Completion: {item.title}</DialogTitle>
                            <DialogDescription>
                              Record the completion of this emergency preparedness item.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            {item.description && (
                              <p className="text-sm text-slate-600">{item.description}</p>
                            )}
                            <div className="space-y-2">
                              <Label htmlFor="participants">Participants (comma-separated)</Label>
                              <Input
                                id="participants"
                                value={completionDialog.participants}
                                onChange={(e) => setCompletionDialog({ ...completionDialog, participants: e.target.value })}
                                placeholder="Staff member names..."
                              disabled={savingCompletion}
                              className="font-mono"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void submitCompletion();
                                }
                              }}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="notes">Notes</Label>
                              <Textarea
                                id="notes"
                                value={completionDialog.notes}
                                onChange={(e) => setCompletionDialog({ ...completionDialog, notes: e.target.value })}
                                placeholder="Any observations or issues during the drill..."
                                rows={4}
                                disabled={savingCompletion}
                              />
                            </div>
                            <div className="flex justify-end">
                              <Button
                                onClick={() => void submitCompletion()}
                                disabled={savingCompletion}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                              >
                                {savingCompletion ? "Saving…" : "Save Completion"}
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Flame className="h-4 w-4" /> Drill Log (Slice 9F)</CardTitle>
          <CardDescription>Record fire/elopement/tornado drills in the new `drill_log` table.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Type">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={newDrill.drill_type} onChange={(e) => setNewDrill((current) => ({ ...current, drill_type: e.target.value as DrillType }))}>
                <option value="fire">Fire</option>
                <option value="elopement">Elopement</option>
                <option value="tornado">Tornado</option>
              </select>
            </Field>
            <Field label="Date"><Input type="date" value={newDrill.drill_date} onChange={(e) => setNewDrill((current) => ({ ...current, drill_date: e.target.value }))} /></Field>
            <Field label="Time"><Input type="time" value={newDrill.drill_time} onChange={(e) => setNewDrill((current) => ({ ...current, drill_time: e.target.value }))} /></Field>
            <Field label="Staff present"><Input inputMode="numeric" value={newDrill.staff_present_count} onChange={(e) => setNewDrill((current) => ({ ...current, staff_present_count: e.target.value }))} /></Field>
            <Field label="Residents present"><Input inputMode="numeric" value={newDrill.residents_present_count} onChange={(e) => setNewDrill((current) => ({ ...current, residents_present_count: e.target.value }))} /></Field>
            <Field label="Pull station"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={newDrill.pull_station_activated ? "yes" : "no"} onChange={(e) => setNewDrill((current) => ({ ...current, pull_station_activated: e.target.value === "yes" }))}><option value="no">No</option><option value="yes">Yes</option></select></Field>
          </div>
          <Field label="Notes"><Textarea rows={2} value={newDrill.notes} onChange={(e) => setNewDrill((current) => ({ ...current, notes: e.target.value }))} /></Field>
          <Button onClick={() => void submitDrillLog()} disabled={savingDrill}>{savingDrill ? "Saving…" : "Log drill"}</Button>
          <ul className="space-y-2 text-sm">
            {drillLog.slice(0, 5).map((entry) => (
              <li key={entry.id} className="rounded border p-2">{entry.drill_date} {entry.drill_time.slice(0,5)} · {entry.drill_type} · staff {entry.staff_present_count ?? "—"} / residents {entry.residents_present_count ?? "—"}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Maintenance Tickets</CardTitle>
          <CardDescription>Create and view work orders from `maintenance_tickets`.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Asset/area"><Input value={newTicket.asset_description} onChange={(e) => setNewTicket((current) => ({ ...current, asset_description: e.target.value }))} placeholder="Kitchen hood" /></Field>
            <Field label="Priority"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={newTicket.priority} onChange={(e) => setNewTicket((current) => ({ ...current, priority: e.target.value as MaintenanceTicketInsert["priority"] }))}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></Field>
            <div className="flex items-end"><Button onClick={() => void submitMaintenanceTicket()} disabled={savingTicket || !newTicket.asset_description.trim() || !newTicket.issue_description.trim()}>{savingTicket ? "Saving…" : "Create ticket"}</Button></div>
          </div>
          <Field label="Issue"><Textarea rows={2} value={newTicket.issue_description} onChange={(e) => setNewTicket((current) => ({ ...current, issue_description: e.target.value }))} /></Field>
          <ul className="space-y-2 text-sm">
            {maintenanceTickets.slice(0, 6).map((ticket) => (
              <li key={ticket.id} className="rounded border p-2">{ticket.status} · {ticket.priority} · {ticket.asset_description} — {ticket.issue_description}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Maintenance Completion Log</CardTitle>
          <CardDescription>Log evidence entries in `maintenance_task_completions`.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Task type"><Input value={newCompletion.task_type} onChange={(e) => setNewCompletion((current) => ({ ...current, task_type: e.target.value }))} placeholder="quarterly_grease_trap_cleaning" /></Field>
            <Field label="Completed by vendor (optional)"><Input value={newCompletion.completed_by_vendor} onChange={(e) => setNewCompletion((current) => ({ ...current, completed_by_vendor: e.target.value }))} placeholder="Vendor name" /></Field>
            <Field label="Related ticket (optional)"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={newCompletion.related_ticket_id} onChange={(e) => setNewCompletion((current) => ({ ...current, related_ticket_id: e.target.value }))}><option value="">None</option>{maintenanceTickets.map((ticket) => (<option key={ticket.id} value={ticket.id}>{ticket.asset_description} ({ticket.status})</option>))}</select></Field>
            <div className="flex items-end"><Button onClick={() => void submitMaintenanceCompletion()} disabled={savingCompletionLog || !newCompletion.task_type.trim()}>{savingCompletionLog ? "Saving…" : "Log completion"}</Button></div>
          </div>
          <Field label="Notes"><Textarea rows={2} value={newCompletion.notes} onChange={(e) => setNewCompletion((current) => ({ ...current, notes: e.target.value }))} /></Field>
          <ul className="space-y-2 text-sm">
            {maintenanceCompletions.slice(0, 6).map((completion) => (
              <li key={completion.id} className="rounded border p-2">{new Date(completion.completed_at).toLocaleDateString()} · {completion.task_type} · {completion.completed_by_vendor || "staff"}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}


async function fetchEmergencyChecklistItems(
  supabase: ReturnType<typeof createClient>,
  facilityId: string,
): Promise<ChecklistItem[]> {
  const result = await supabase
    .from("emergency_checklist_items" as never)
    .select("*")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("next_due_date", { ascending: true });

  const { data, error } = result as unknown as {
    data: EmergencyChecklistItemRow[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((item) => ({
    ...item,
    overdue: getOverdueStatus(item.next_due_date),
  }));
}

async function loadOrganizationIdForFacility(
  supabase: ReturnType<typeof createClient>,
  facilityId: string,
): Promise<string | null> {
  const result = await supabase
    .from("facilities")
    .select("organization_id")
    .eq("id", facilityId)
    .maybeSingle();

  const { data, error } = result as unknown as {
    data: FacilityOrganizationRow | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(error.message);
  }

  return data?.organization_id ?? null;
}

async function insertEmergencyChecklistCompletion(
  supabase: ReturnType<typeof createClient>,
  payload: EmergencyChecklistCompletionInsert,
) {
  const result = await supabase
    .from("emergency_checklist_completions" as never)
    .insert(payload as never);

  const { error } = result as unknown as {
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(error.message);
  }
}

async function updateEmergencyChecklistItemCompletion(
  supabase: ReturnType<typeof createClient>,
  itemId: string,
  payload: EmergencyChecklistItemCompletionUpdate,
) {
  const result = await supabase
    .from("emergency_checklist_items" as never)
    .update(payload as never)
    .eq("id", itemId);

  const { error } = result as unknown as {
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(error.message);
  }
}

async function insertEmergencyChecklistItem(
  supabase: ReturnType<typeof createClient>,
  payload: EmergencyChecklistItemInsert,
) {
  const result = await supabase
    .from("emergency_checklist_items" as never)
    .insert(payload as never);

  const { error } = result as unknown as {
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(error.message);
  }
}

async function fetchDrillLog(supabase: ReturnType<typeof createClient>, facilityId: string): Promise<DrillLogRow[]> {
  const result = await supabase
    .from("drill_log" as never)
    .select("id, drill_type, drill_date, drill_time, pull_station_activated, staff_present_count, residents_present_count, notes")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("drill_date", { ascending: false })
    .limit(20);
  const { data, error } = result as unknown as { data: DrillLogRow[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function insertDrillLog(supabase: ReturnType<typeof createClient>, payload: DrillLogInsert) {
  const result = await supabase.from("drill_log" as never).upsert(payload as never, {
    onConflict: "facility_id,drill_type,drill_date,drill_time",
  });
  const { error } = result as unknown as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

async function fetchMaintenanceTickets(supabase: ReturnType<typeof createClient>, facilityId: string): Promise<MaintenanceTicketRow[]> {
  const result = await supabase
    .from("maintenance_tickets" as never)
    .select("id, asset_description, issue_description, priority, status, opened_at")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("opened_at", { ascending: false })
    .limit(20);
  const { data, error } = result as unknown as { data: MaintenanceTicketRow[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function insertMaintenanceTicket(supabase: ReturnType<typeof createClient>, payload: MaintenanceTicketInsert) {
  const result = await supabase.from("maintenance_tickets" as never).insert(payload as never);
  const { error } = result as unknown as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

async function fetchMaintenanceCompletions(supabase: ReturnType<typeof createClient>, facilityId: string): Promise<MaintenanceCompletionRow[]> {
  const result = await supabase
    .from("maintenance_task_completions" as never)
    .select("id, task_type, completed_at, completed_by_vendor, notes, related_ticket_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(20);
  const { data, error } = result as unknown as { data: MaintenanceCompletionRow[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function insertMaintenanceCompletion(supabase: ReturnType<typeof createClient>, payload: MaintenanceCompletionInsert) {
  const result = await supabase.from("maintenance_task_completions" as never).insert(payload as never);
  const { error } = result as unknown as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

function getOverdueStatus(nextDueDate: string) {
  const today = new Date();
  const dueDate = new Date(nextDueDate);
  return dueDate < today;
}
