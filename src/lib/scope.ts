"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dateRangeSchema = z
  .object({
    start: dateString,
    end: dateString,
  })
  .refine((range) => range.start <= range.end, {
    message: "start must be before or equal to end",
    path: ["end"],
  });

export const scopeSchema = z.object({
  ownerId: z.string().trim().min(1).optional(),
  groupId: z.string().trim().min(1).optional(),
  facilityIds: z.array(z.string().trim().min(1)).optional(),
  dateRange: dateRangeSchema.optional(),
});

export type Scope = z.infer<typeof scopeSchema>;

export type ScopePatch = Partial<Scope>;

export function parseScopeSearchParams(searchParams: URLSearchParams): Scope {
  const candidate: Scope = {};
  const ownerId = searchParams.get("owner");
  const groupId = searchParams.get("group");
  const facilityIds = searchParams.getAll("facility").filter(Boolean);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (ownerId) candidate.ownerId = ownerId;
  if (groupId) candidate.groupId = groupId;
  if (facilityIds.length > 0) candidate.facilityIds = facilityIds;
  if (start || end) {
    candidate.dateRange = {
      start: start ?? "",
      end: end ?? "",
    };
  }

  return scopeSchema.parse(candidate);
}

export function mergeScope(scope: Scope, patch: ScopePatch): Scope {
  return scopeSchema.parse({
    ...scope,
    ...patch,
  });
}

export function writeScopeToSearchParams(scope: Scope, params = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete("owner");
  next.delete("group");
  next.delete("facility");
  next.delete("start");
  next.delete("end");

  if (scope.ownerId) next.set("owner", scope.ownerId);
  if (scope.groupId) next.set("group", scope.groupId);
  for (const facilityId of scope.facilityIds ?? []) {
    next.append("facility", facilityId);
  }
  if (scope.dateRange) {
    next.set("start", scope.dateRange.start);
    next.set("end", scope.dateRange.end);
  }

  return next;
}

export function useScope(): [Scope, (partial: ScopePatch) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const scope = useMemo(() => {
    try {
      return parseScopeSearchParams(new URLSearchParams(searchParams.toString()));
    } catch {
      return {};
    }
  }, [searchParams]);

  const setScope = useCallback(
    (partial: ScopePatch) => {
      const nextScope = mergeScope(scope, partial);
      const nextParams = writeScopeToSearchParams(
        nextScope,
        new URLSearchParams(searchParams.toString()),
      );
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, scope, searchParams],
  );

  return [scope, setScope];
}
