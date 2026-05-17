"use client";

import React, { useState } from "react";
import { Loader2, Plus, ChevronDown } from "lucide-react";
import { useFacilityRates } from "@/hooks/useFacilityRates";
import { RATE_TYPES, RATE_TYPE_LABELS } from "@/lib/admin/facilities/facility-constants";

interface RatesTabProps {
  facilityId: string;
}

const inputCls = "w-full px-3 py-2 rounded-[8px] border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm";

export function RatesTab({ facilityId }: RatesTabProps) {
  const { rates, isLoading, error, isCreating, createRate, confirmRate, isConfirming } =
    useFacilityRates(facilityId);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ rate_type: "", amount: "", effective_from: "" });

  const handleAddRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.rate_type || !formData.amount || !formData.effective_from) {
      alert("Please fill in all fields");
      return;
    }
    const result = await createRate({
      rate_type: formData.rate_type,
      amount_cents: Math.round(parseFloat(formData.amount) * 100),
      effective_from: formData.effective_from,
    });
    if (result) {
      setFormData({ rate_type: "", amount: "", effective_from: "" });
      setShowAddForm(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const pendingActiveRates = rates.filter((r) => r.effective_to == null && !r.rate_confirmed);

  const ratesByType = rates.reduce(
    (acc, rate) => {
      if (!acc[rate.rate_type]) {
        acc[rate.rate_type] = [];
      }
      acc[rate.rate_type].push(rate);
      return acc;
    },
    {} as Record<string, typeof rates>,
  );

  return (
    <div className="space-y-6">
      {pendingActiveRates.length > 0 && (
        <div
          role="status"
          className="rounded-[8px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <strong className="font-semibold">Rate pending client confirmation.</strong> One or more
          active rate lines are not marked as confirmed — confirm with the responsible party before
          invoicing.
        </div>
      )}

      <button
        onClick={() => setShowAddForm(!showAddForm)}
        className="inline-flex items-center gap-2 rounded-[8px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        <Plus className="h-4 w-4" />
        Add rate
      </button>

      {showAddForm && (
        <form onSubmit={handleAddRate} className="rounded-[8px] border border-border bg-muted/10 p-6 space-y-4">
          <h3 className="font-semibold text-foreground">New rate</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Room type</label>
              <select
                value={formData.rate_type}
                onChange={(e) => setFormData({ ...formData, rate_type: e.target.value })}
                className={inputCls}
              >
                <option value="">Select type…</option>
                {RATE_TYPES.map((rateType) => (
                  <option key={rateType} value={rateType}>
                    {RATE_TYPE_LABELS[rateType]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className={inputCls}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Effective date</label>
              <input
                type="date"
                value={formData.effective_from}
                onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-[8px] disabled:opacity-50 text-sm font-medium"
            >
              {isCreating ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 border border-border rounded-[8px] text-sm font-medium text-foreground hover:bg-muted/10"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {Object.keys(ratesByType).length === 0 ? (
        <div className="rounded-[8px] border border-border bg-muted/10 p-8 text-center">
          <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">No rates configured</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(ratesByType).map(([roomType, typeRates]) => (
            <div key={roomType} className="rounded-[8px] border border-border overflow-hidden">
              <button
                onClick={() => setExpandedType(expandedType === roomType ? null : roomType)}
                className="w-full px-6 py-4 bg-muted/10 hover:bg-muted/20 transition-colors flex items-center justify-between text-foreground"
              >
                <span className="font-medium">{RATE_TYPE_LABELS[roomType as keyof typeof RATE_TYPE_LABELS] ?? roomType}</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-sm text-muted-foreground">${typeRates[0]?.amount_usd?.toFixed(2) ?? "0.00"}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${expandedType === roomType ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {expandedType === roomType && (
                <div className="divide-y divide-border">
                  {typeRates.map((rate) => (
                    <div key={rate.id} className="px-6 py-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <span className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
                          Effective{" "}
                          {new Date(rate.effective_from).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        {rate.effective_to == null && !rate.rate_confirmed && (
                          <div className="text-xs font-medium text-warning">
                            Unconfirmed
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium tabular-nums text-foreground">${rate.amount_usd.toFixed(2)}</span>
                        {rate.effective_to == null && !rate.rate_confirmed && (
                          <button
                            type="button"
                            disabled={isConfirming}
                            onClick={() => void confirmRate(rate.id)}
                            className="rounded-[8px] border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/10 disabled:opacity-50"
                          >
                            Mark confirmed
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
