"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  Flame,
  Zap,
  ArrowRight,
  Calendar,
  Users,
  FileText,
  History,
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
import { Switch } from "@/components/ui/switch";

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

const CHECKLIST_TYPES = [
  { value: "generator_test", label: "Generator Test", icon: Zap },
  { value: "fire_drill", label: "Fire Drill", icon: Flame },
  { value: "evacuation_drill", label: "Evacuation Drill", icon: AlertTriangle },
  { value: "other", label: "Other", icon: FileText },
] as const;

export default function EmergencyPreparednessPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChecklistItem[]>([]);
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

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const loadItems = useCallback(async () => {
    if (!facilityReady) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await (supabase as any)
        .from("emergency_checklist_items")
        .select("*")
        .eq("facility_id", selectedFacilityId!)
        .is("deleted_at", null)
        .order("next_due_date", { ascending: true });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setItems((data as ChecklistItem[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load checklist items");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, facilityReady, supabase]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const openCompletionDialog = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      setCompletionDialog({
        open: true,
        itemId,
        participants: "",
        notes: item.last_notes || "",
      });
    }
  };

  const submitCompletion = async () => {
    if (!completionDialog.itemId || !facilityReady) return;

    setSavingCompletion(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("Not authenticated");
      }

      // Create completion record
      const { error: completionError } = await (supabase as any)
        .from("emergency_checklist_completions")
        .insert({
          checklist_item_id: completionDialog.itemId,
          facility_id: selectedFacilityId!,
          completed_by: user.id,
          participants: completionDialog.participants.split(",").map((p) => p.trim()).filter(Boolean),
          notes: completionDialog.notes || null,
        });

      if (completionError) {
        throw new Error(completionError.message);
      }

      // Update the checklist item
      const { data: itemData } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId!)
        .maybeSingle();

      const organizationId = itemData?.organization_id;

      if (!organizationId) {
        throw new Error("Could not determine organization ID");
      }

      const item = items.find((i) => i.id === completionDialog.itemId);
      if (!item) return;

      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + item.frequency_days);

      const { error: updateError } = await (supabase as any)
        .from("emergency_checklist_items")
        .update({
          last_completed_at: new Date().toISOString(),
          last_completed_by: user.id,
          last_participants: completionDialog.participants.split(",").map((p) => p.trim()).filter(Boolean),
          last_notes: completionDialog.notes || null,
          next_due_date: nextDueDate.toISOString().split("T")[0],
        })
        .eq("id", completionDialog.itemId);

      if (updateError) {
        throw new Error(updateError.message);
      }

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
      const { data: itemData } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId!)
        .maybeSingle();

      const organizationId = itemData?.organization_id;

      if (!organizationId) {
        throw new Error("Could not determine organization ID");
      }

      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + newItemDialog.frequency);

      const { error: insertError } = await (supabase as any)
        .from("emergency_checklist_items")
        .insert({
          facility_id: selectedFacilityId!,
          organization_id,
          checklist_type: newItemDialog.type,
          title: newItemDialog.title,
          description: newItemDialog.description || null,
          frequency_days: newItemDialog.frequency,
          next_due_date: nextDueDate.toISOString().split("T")[0],
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

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
                        onOpenChange={(open) => !open && setCompletionDialog({ ...completionDialog, open })}
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
    </div>
  );
}
