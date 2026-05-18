"use client";

import { usePathname, useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NAV = [
  { value: "pipeline", href: "/admin/discharge" },
  { value: "new", href: "/admin/discharge/new" },
] as const;

function hubValue(pathname: string): string {
  if (pathname.startsWith("/admin/discharge/new")) return "new";
  return "pipeline";
}

/**
 * Quiet Operator discharge sub-nav using the Tabs (line variant) primitive.
 */
export function DischargeHubNav() {
  const pathname = usePathname();
  const router = useRouter();
  const value = hubValue(pathname);

  return (
    <Tabs
      value={value}
      className="w-full"
      onValueChange={(next) => {
        const tab = NAV.find((n) => n.value === next);
        if (tab) router.push(tab.href);
      }}
    >
      <TabsList
        variant="line"
        aria-label="Discharge sections"
        className="h-auto min-h-8 w-full flex-wrap justify-start gap-1 rounded-none border-0 bg-transparent px-0 py-0 pb-px"
      >
        <TabsTrigger
          value="pipeline"
          className="rounded-none px-3 py-2 text-[13px] font-medium data-active:after:bottom-0"
        >
          Pipeline
        </TabsTrigger>
        <TabsTrigger
          value="new"
          className="rounded-none px-3 py-2 text-[13px] font-medium data-active:after:bottom-0"
          title="New medication reconciliation"
        >
          New med rec
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
