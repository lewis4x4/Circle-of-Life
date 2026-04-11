"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, Plus, Minus, AlertCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

type CarePlanRow = {
  id: string;
  version: number | null;
  status: string | null;
  effective_date: string | null;
  review_due_date: string | null;
  previous_version_id: string | null;
};

type CarePlanItemRow = {
  id: string;
  category: string | null;
  title: string | null;
  description: string | null;
  assistance_level: string | null;
  frequency: string | null;
  special_instructions: string | null;
  goal: string | null;
  interventions: string[] | null;
  sort_order: number | null;
};

interface CarePlanDiffModalProps {
  carePlanId: string | null;
  onClose: () => void;
  onContinueToReview?: (carePlanId: string) => void;
}

interface DiffItem {
  id: string;
  status: "added" | "removed" | "modified" | "unchanged";
  oldItem: CarePlanItemRow | null;
  newItem: CarePlanItemRow | null;
  category: string;
  changes: {
    field: string;
    oldValue: string | string[] | null;
    newValue: string | string[] | null;
  }[];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatSnakeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatCategoryLabel(category: string): string {
  return formatSnakeLabel(category)
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function CarePlanDiffModal({
  carePlanId,
  onClose,
  onContinueToReview,
}: CarePlanDiffModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState<CarePlanRow | null>(null);
  const [oldPlan, setOldPlan] = useState<CarePlanRow | null>(null);
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Reset state when carePlanId changes
  useEffect(() => {
    if (!carePlanId) {
      setNewPlan(null);
      setOldPlan(null);
      setDiffItems([]);
      setError(null);
      return;
    }

    loadDiff(carePlanId);
  }, [carePlanId]);

  // Expand all categories by default
  useEffect(() => {
    const categories = new Set(diffItems.map((d) => d.category));
    setExpandedCategories(categories);
  }, [diffItems]);

  const loadDiff = async (planId: string) => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      // Fetch new plan
      const newPlanResult = (await supabase
        .from("care_plans" as never)
        .select("id, version, status, effective_date, review_due_date, previous_version_id")
        .eq("id", planId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<CarePlanRow>;

      if (newPlanResult.error) throw newPlanResult.error;
      if (!newPlanResult.data) throw new Error("Care plan not found");

      const fetchedNewPlan = newPlanResult.data;
      setNewPlan(fetchedNewPlan);

      // Fetch old plan if exists
      let fetchedOldPlan: CarePlanRow | null = null;
      if (fetchedNewPlan.previous_version_id) {
        const oldPlanResult = (await supabase
          .from("care_plans" as never)
          .select("id, version, status, effective_date, review_due_date, previous_version_id")
          .eq("id", fetchedNewPlan.previous_version_id)
          .is("deleted_at", null)
          .maybeSingle()) as unknown as QueryResult<CarePlanRow>;

        if (oldPlanResult.data) {
          fetchedOldPlan = oldPlanResult.data;
        }
      }
      setOldPlan(fetchedOldPlan);

      // Fetch items for both plans
      const [newItemsResult, oldItemsResult] = await Promise.all([
        supabase
          .from("care_plan_items" as never)
          .select("id, category, title, description, assistance_level, frequency, special_instructions, goal, interventions, sort_order")
          .eq("care_plan_id", planId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true }),
        fetchedOldPlan
          ? supabase
              .from("care_plan_items" as never)
              .select("id, category, title, description, assistance_level, frequency, special_instructions, goal, interventions, sort_order")
              .eq("care_plan_id", fetchedOldPlan.id)
              .eq("is_active", true)
              .is("deleted_at", null)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (newItemsResult.error) throw newItemsResult.error;
      if (oldItemsResult.error) throw oldItemsResult.error;

      const newItems: CarePlanItemRow[] = newItemsResult.data ?? [];
      const oldItems: CarePlanItemRow[] = oldItemsResult.data ?? [];

      // Generate diff
      const diff = generateDiff(oldItems, newItems);
      setDiffItems(diff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load care plan diff");
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleContinue = () => {
    if (carePlanId) {
      onContinueToReview?.(carePlanId);
    }
    onClose();
  };

  const addedCount = diffItems.filter((d) => d.status === "added").length;
  const removedCount = diffItems.filter((d) => d.status === "removed").length;
  const modifiedCount = diffItems.filter((d) => d.status === "modified").length;

  const groupedByCategory = Array.from(
    diffItems.reduce((acc, item) => {
      if (!acc.has(item.category)) acc.set(item.category, []);
      acc.get(item.category)!.push(item);
      return acc;
    }, new Map<string, DiffItem[]>())
  );

  return (
    <Dialog open={!!carePlanId} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        {loading ? (
          <div className="p-8 space-y-6">
            <Skeleton className="h-8 w-64" />
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">{error}</p>
          </div>
        ) : (
          <>
            <DialogHeader className="p-6 pb-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-2xl">Care Plan Comparison</DialogTitle>
                  <DialogDescription className="mt-2">
                    Comparing version {oldPlan?.version ?? "—"} → {newPlan?.version ?? "—"}
                  </DialogDescription>
                </div>
                <div className="flex gap-2">
                  {addedCount > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <Plus className="w-3 h-3 mr-1" />
                      {addedCount} added
                    </Badge>
                  )}
                  {removedCount > 0 && (
                    <Badge className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300">
                      <Minus className="w-3 h-3 mr-1" />
                      {removedCount} removed
                    </Badge>
                  )}
                  {modifiedCount > 0 && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      {modifiedCount} modified
                    </Badge>
                  )}
                  {addedCount === 0 && removedCount === 0 && modifiedCount === 0 && (
                    <Badge className="bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300">
                      No changes
                    </Badge>
                  )}
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto">
              {oldPlan ? (
                <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-700">
                  {/* Old Plan (Left) */}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="outline" className="font-mono text-xs">
                        v{oldPlan.version}
                      </Badge>
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        Previous Version
                      </span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-slate-500 dark:text-slate-500">Effective:</span>{" "}
                        <span className="font-medium">{formatDate(oldPlan.effective_date)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-500">Status:</span>{" "}
                        <span className="font-medium">{formatSnakeLabel(oldPlan.status ?? "")}</span>
                      </div>
                    </div>
                  </div>

                  {/* New Plan (Right) */}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 font-mono text-xs">
                        v{newPlan?.version}
                      </Badge>
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        New Version
                      </span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-slate-500 dark:text-slate-500">Effective:</span>{" "}
                        <span className="font-medium">{formatDate(newPlan?.effective_date)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-500">Status:</span>{" "}
                        <span className="font-medium">{formatSnakeLabel(newPlan?.status ?? "")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400">
                  <p>Previous version not found. This appears to be the initial care plan.</p>
                </div>
              )}

              {/* Diff Items by Category */}
              <div className="border-t border-slate-200 dark:border-slate-700">
                {groupedByCategory.map(([category, items]) => (
                  <div key={category} className="border-b border-slate-200 dark:border-slate-700 last:border-0">
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className="w-full px-6 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                    >
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatCategoryLabel(category)}
                      </h3>
                      {expandedCategories.has(category) ? (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      )}
                    </button>
                    {expandedCategories.has(category) && (
                      <div className="divide-y divide-slate-200 dark:divide-slate-700">
                        {items.map((diff) => (
                          <DiffItemRow key={diff.id} diff={diff} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/30">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button onClick={handleContinue} className="gap-2">
                Continue to Review
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiffItemRow({ diff }: { diff: DiffItem }) {
  const isAdded = diff.status === "added";
  const isRemoved = diff.status === "removed";
  const isModified = diff.status === "modified";

  const bgColor = cn(
    "transition-colors",
    isAdded && "bg-emerald-50/50 dark:bg-emerald-950/20",
    isRemoved && "bg-rose-50/50 dark:bg-rose-950/20",
    isModified && "bg-amber-50/50 dark:bg-amber-950/20"
  );

  const statusIcon = isAdded ? (
    <Plus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
  ) : isRemoved ? (
    <Minus className="w-4 h-4 text-rose-600 dark:text-rose-400" />
  ) : isModified ? (
    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
  ) : null;

  const item = diff.newItem || diff.oldItem;

  return (
    <div className={cn("px-6 py-4", bgColor)}>
      <div className="flex items-start gap-3">
        {statusIcon && (
          <div className="mt-0.5 shrink-0">
            {statusIcon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
              {item?.title ?? "—"}
            </h4>
            {diff.oldItem?.assistance_level && (
              <Badge variant="outline" className="text-[9px] font-mono uppercase px-2 py-0.5">
                {formatSnakeLabel(diff.oldItem.assistance_level)}
              </Badge>
            )}
          </div>

          {/* Side-by-side field comparison */}
          <div className="space-y-1 text-sm">
            {diff.changes.map((change) => (
              <div key={change.field} className="flex gap-4">
                <span className="text-slate-500 dark:text-slate-500 text-xs uppercase w-20 shrink-0">
                  {change.field}:
                </span>
                <div className="flex-1 flex gap-3">
                  {change.oldValue !== null && (
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-slate-400 block mb-0.5">Old</span>
                      <span
                        className={cn(
                          "block truncate",
                          isRemoved && "line-through text-slate-400"
                        )}
                      >
                        {Array.isArray(change.oldValue)
                          ? change.oldValue.join(", ")
                          : change.oldValue || "—"}
                      </span>
                    </div>
                  )}
                  {change.newValue !== null && change.oldValue !== null && (
                    <ArrowRight className="w-4 h-4 text-slate-400 mt-4 shrink-0" />
                  )}
                  {change.newValue !== null && (
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-slate-400 block mb-0.5">New</span>
                      <span
                        className={cn(
                          "block truncate",
                          isAdded && "text-emerald-700 dark:text-emerald-300",
                          isModified && "text-amber-700 dark:text-amber-300"
                        )}
                      >
                        {Array.isArray(change.newValue)
                          ? change.newValue.join(", ")
                          : change.newValue || "—"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function generateDiff(oldItems: CarePlanItemRow[], newItems: CarePlanItemRow[]): DiffItem[] {
  const diff: DiffItem[] = [];
  const oldItemsByKey = new Map(
    oldItems.map((item) => [
      `${item.category}:${item.title}`,
      item,
    ])
  );
  const newItemsByKey = new Map(
    newItems.map((item) => [
      `${item.category}:${item.title}`,
      item,
    ])
  );

  // Check for added and modified items
  for (const [key, newItem] of newItemsByKey) {
    const oldItem = oldItemsByKey.get(key);
    const category = newItem.category ?? "other";

    if (!oldItem) {
      // Item was added
      diff.push({
        id: newItem.id,
        status: "added",
        oldItem: null,
        newItem,
        category,
        changes: getAllFieldChanges(null, newItem),
      });
    } else {
      // Check if modified
      const changes = getFieldChanges(oldItem, newItem);
      if (changes.length > 0) {
        diff.push({
          id: newItem.id,
          status: "modified",
          oldItem,
          newItem,
          category,
          changes,
        });
      } else {
        diff.push({
          id: newItem.id,
          status: "unchanged",
          oldItem,
          newItem,
          category,
          changes: [],
        });
      }
    }
  }

  // Check for removed items
  for (const [key, oldItem] of oldItemsByKey) {
    if (!newItemsByKey.has(key)) {
      diff.push({
        id: oldItem.id,
        status: "removed",
        oldItem,
        newItem: null,
        category: oldItem.category ?? "other",
        changes: getAllFieldChanges(oldItem, null),
      });
    }
  }

  return diff.sort((a, b) => {
    // Sort by status, then category
    const statusOrder = { added: 0, modified: 1, unchanged: 2, removed: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return a.category.localeCompare(b.category);
  });
}

function getFieldChanges(
  old: CarePlanItemRow,
  newItem: CarePlanItemRow
): DiffItem["changes"] {
  const changes: DiffItem["changes"] = [];

  const fields: Array<keyof CarePlanItemRow> = [
    "description",
    "assistance_level",
    "frequency",
    "special_instructions",
    "goal",
  ];

  for (const field of fields) {
    const oldValue = old[field];
    const newValue = newItem[field];

    // Handle array comparison for interventions
    if (field === "interventions") {
      const oldInterventions = (old.interventions ?? []).sort().join("|");
      const newInterventions = (newItem.interventions ?? []).sort().join("|");

      if (oldInterventions !== newInterventions) {
        changes.push({
          field: "interventions",
          oldValue: old.interventions,
          newValue: newItem.interventions,
        });
      }
    } else if (oldValue !== newValue) {
      changes.push({
        field,
        oldValue: oldValue as string | null,
        newValue: newValue as string | null,
      });
    }
  }

  return changes;
}

function getAllFieldChanges(
  old: CarePlanItemRow | null,
  newItem: CarePlanItemRow | null
): DiffItem["changes"] {
  const item = old ?? newItem;
  if (!item) return [];

  const fields: Array<keyof CarePlanItemRow> = [
    "description",
    "assistance_level",
    "frequency",
    "special_instructions",
    "goal",
    "interventions",
  ];

  return fields
    .filter((field) => {
      const oldValue = old?.[field];
      const newValue = newItem?.[field];

      if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        const oldSorted = oldValue.sort().join("|");
        const newSorted = newValue.sort().join("|");
        return oldSorted !== newSorted;
      }
      return oldValue !== newValue;
    })
    .map((field) => ({
      field,
      oldValue: old?.[field] as string | string[] | null,
      newValue: newItem?.[field] as string | string[] | null,
    }));
}
