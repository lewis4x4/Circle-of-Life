"use client";

import { useRouter, usePathname } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NAV = [
  { value: "pipeline", href: "/admin/referrals" },
  { value: "new", href: "/admin/referrals/new" },
  { value: "sources", href: "/admin/referrals/sources" },
  { value: "inbox", href: "/admin/referrals/hl7-inbound" },
] as const;

function hubValue(pathname: string): string {
  if (pathname.startsWith("/admin/referrals/new")) return "new";
  if (pathname.startsWith("/admin/referrals/sources")) return "sources";
  if (pathname.startsWith("/admin/referrals/hl7-inbound")) return "inbox";
  return "pipeline";
}

/**
 * Quiet Operator referral sub-nav using the Tabs (line variant) primitive.
 * Values drive SPA navigation instead of duplicated link chrome.
 */
export function ReferralsHubNav() {
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
        aria-label="Referral sections"
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
        >
          New lead
        </TabsTrigger>
        <TabsTrigger
          value="sources"
          className="rounded-none px-3 py-2 text-[13px] font-medium data-active:after:bottom-0"
        >
          Sources
        </TabsTrigger>
        <TabsTrigger
          value="inbox"
          className="rounded-none px-3 py-2 text-[13px] font-medium data-active:after:bottom-0"
        >
          Referral inbox
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
