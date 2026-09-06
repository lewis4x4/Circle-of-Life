"use client";
import { useEffect, useState } from "react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { loadCaregiverFacilityOptions, selectWorkingFacility, workingFacilityKey, type CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
export function WorkingFacilitySelector({ userId, onResolved }: {
    userId: string;
    onResolved: (id: string) => void;
}) {
    const [options, setOptions] = useState<CaregiverFacilityContext[]>([]);
    const [selected, setSelected] = useState("");
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        void loadCaregiverFacilityOptions(createClient(), userId).then((rows) => {
            if (!active)
                return;
            setOptions(rows);
            useFacilityStore.getState().setAvailableFacilities(rows.map((row) => ({ id: row.facilityId, name: row.facilityName ?? "Facility" })), userId);
            const preferred = sessionStorage.getItem(workingFacilityKey(userId));
            const choice = selectWorkingFacility(rows, preferred);
            if (choice) {
                sessionStorage.setItem(workingFacilityKey(userId), choice.facilityId);
                setSelected(choice.facilityId);
                useFacilityStore.getState().setSelectedFacility(choice.facilityId);
                onResolved(choice.facilityId);
            }
            else {
                onResolved("");
                if (!rows.length)
                    setError("No active facility access assigned.");
            }
        }).catch((e) => { if (active) {
            setError(e instanceof Error ? e.message : "Facility options unavailable");
            onResolved("");
        } });
        return () => { active = false; };
    }, [userId, onResolved]);
    return <label className="block text-xs">Working facility<select aria-label="Working facility" className="mt-1 block max-w-60 rounded border border-border bg-background p-2 text-foreground" value={selected} onChange={(e) => { const id = e.target.value; sessionStorage.setItem(workingFacilityKey(userId), id); setSelected(id); useFacilityStore.getState().setSelectedFacility(id || null); onResolved(id); }}><option value="">Choose facility</option>{options.map((option) => <option value={option.facilityId} key={option.facilityId}>{option.facilityName}</option>)}</select>{error && <span role="alert">{error}</span>}</label>;
}
