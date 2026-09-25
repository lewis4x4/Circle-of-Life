'use client';

import { useEffect, useState } from 'react';
import { loadCensusReasonOptions, type CensusReasonOption } from '@/lib/operating-rules/operating-rules';
import { createClient } from '@/lib/supabase/client';

/**
 * COL-555: the facility's census reasons in force today, a setting
 * (`stand_up.census_reason_options`), read the same way on Monday and
 * Thursday. Null while loading or when they cannot be read: the form then
 * offers no reason rather than a list from code.
 */
export function useCensusReasonOptions(facilityId: string, enabled: boolean): CensusReasonOption[] | null {
  const [state, setState] = useState<{ facilityId: string; options: CensusReasonOption[] | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadCensusReasonOptions(createClient(), { facilityId }).then(options => { if (live) setState({ facilityId, options }); });
    return () => { live = false; };
  }, [facilityId, enabled]);
  return enabled && state?.facilityId === facilityId ? state.options : null;
}
