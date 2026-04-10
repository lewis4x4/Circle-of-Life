"use client";

import React, { useState } from "react";
import { Loader2, Plus, ChevronDown } from "lucide-react";
import { useFacilityRates } from "@/hooks/useFacilityRates";
import { RATE_TYPES, RATE_TYPE_LABELS } from "@/lib/admin/facilities/facility-constants";

interface RatesTabProps {
  facilityId: string;
}

export function RatesTab({ facilityId }: RatesTabProps) {
  const { rates, isLoading, error, isCreating, createRate } = useFacilityRates(facilityId);
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
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Group rates by room type
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
      {/* Add Rate Button */}
      <button
        onClick={() => setShowAddForm(!showAddForm)}
        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Rate
      </button>

      {/* Add Rate Form */}
      {showAddForm && (
        <form onSubmit={handleAddRate} className="rounded-lg border border-gray-200 bg-gray-50 p-6 space-y-4">
          <h3 className="font-semibold">New Rate</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium mb-1">Room Type</label>
              <select
                value={formData.rate_type}
                onChange={(e) => setFormData({ ...formData, rate_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">Select type...</option>
                {RATE_TYPES.map((rateType) => (
                  <option key={rateType} value={rateType}>
                    {RATE_TYPE_LABELS[rateType]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Effective Date</label>
              <input
                type="date"
                value={formData.effective_from}
                onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {isCreating ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Rates Table */}
      {Object.keys(ratesByType).length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="text-muted-foreground">No rates configured</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(ratesByType).map(([roomType, typeRates]) => (
            <div key={roomType} className="rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => setExpandedType(expandedType === roomType ? null : roomType)}
                className="w-full px-6 py-4 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
              >
                <span className="font-medium">{RATE_TYPE_LABELS[roomType as keyof typeof RATE_TYPE_LABELS] ?? roomType}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">${typeRates[0]?.amount_usd?.toFixed(2) ?? "0.00"}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${expandedType === roomType ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {expandedType === roomType && (
                <div className="divide-y divide-gray-100">
                  {typeRates.map((rate) => (
                    <div key={rate.id} className="px-6 py-3 flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Effective{" "}
                        {new Date(rate.effective_from).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span className="font-medium">${rate.amount_usd.toFixed(2)}</span>
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
