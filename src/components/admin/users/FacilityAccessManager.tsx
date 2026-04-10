/**
 * FacilityAccessManager — assign/revoke facility access for a user.
 */

"use client";

import { useState } from "react";
import { useFacilityStore } from "@/hooks/useFacilityStore";

interface Facility {
  id: string;
  name: string;
}

interface FacilityAccessManagerProps {
  /** Currently selected facility IDs */
  selected: string[];
  onChange: (facilityIds: string[]) => void;
  /** Which facility is primary */
  primaryId: string;
  onPrimaryChange: (id: string) => void;
}

export function FacilityAccessManager({
  selected,
  onChange,
  primaryId,
  onPrimaryChange,
}: FacilityAccessManagerProps) {
  const { availableFacilities: facilities } = useFacilityStore();
  const [showAdd, setShowAdd] = useState(false);

  const available = facilities.filter((f) => !selected.includes(f.id));

  const handleAdd = (facilityId: string) => {
    const next = [...selected, facilityId];
    onChange(next);
    if (!primaryId) onPrimaryChange(facilityId);
    setShowAdd(false);
  };

  const handleRemove = (facilityId: string) => {
    const next = selected.filter((id) => id !== facilityId);
    onChange(next);
    if (primaryId === facilityId) {
      onPrimaryChange(next[0] ?? "");
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">Facility Access</label>

      {/* Current facilities */}
      {selected.length > 0 && (
        <div className="space-y-2">
          {selected.map((id) => {
            const facility = facilities.find((f) => f.id === id);
            return (
              <div
                key={id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="primary-facility"
                    checked={primaryId === id}
                    onChange={() => onPrimaryChange(id)}
                    className="h-3.5 w-3.5 text-teal-600"
                  />
                  <span>{facility?.name ?? "Unknown facility"}</span>
                  {primaryId === id && (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-teal-600 bg-teal-500/10 px-1.5 py-0.5 rounded">
                      Primary
                    </span>
                  )}
                </div>
                {selected.length > 1 && (
                  <button
                    onClick={() => handleRemove(id)}
                    className="text-xs text-destructive hover:text-destructive/80"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add facility */}
      {available.length > 0 && (
        <div>
          {showAdd ? (
            <select
              onChange={(e) => e.target.value && handleAdd(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              autoFocus
            >
              <option value="">Select facility to add...</option>
              {available.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="text-sm text-teal-600 hover:text-teal-700"
            >
              + Add facility
            </button>
          )}
        </div>
      )}

      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">At least one facility is required.</p>
      )}
    </div>
  );
}
