"use client";

import { CalendarClock, Camera, HeartPulse, UtensilsCrossed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function FamilyHomePage() {
  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Today Feed</CardTitle>
          <CardDescription>
            Chronological care updates shared by the care team for your loved one.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <StatPill label="Updates today" value="7" />
          <StatPill label="Meals logged" value="3" />
          <StatPill label="Activities" value="2" />
          <StatPill label="Vitals checks" value="2" />
        </CardContent>
      </Card>

      <FeedCard
        title="Morning wellness check completed"
        time="8:12 AM"
        detail="Vitals stable. Rested well overnight and was in good spirits this morning."
        icon={<HeartPulse className="h-4 w-4 text-rose-500" />}
        badge="Clinical"
      />

      <FeedCard
        title="Breakfast intake recorded"
        time="9:03 AM"
        detail="Ate 85% of breakfast and accepted hydration prompt."
        icon={<UtensilsCrossed className="h-4 w-4 text-amber-600" />}
        badge="Nutrition"
      />

      <FeedCard
        title="Group activity attended"
        time="10:41 AM"
        detail="Joined seated movement and music session for 35 minutes."
        icon={<CalendarClock className="h-4 w-4 text-blue-600" />}
        badge="Engagement"
      />

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Photo Update Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <p className="inline-flex items-center gap-1 text-sm font-medium">
              <Camera className="h-4 w-4 text-stone-500" />
              New photo available from activity room
            </p>
            <p className="mt-1 text-xs text-stone-600">
              Shared by care staff. Visible once privacy checks finish.
            </p>
          </div>
          <Button className="h-10 w-full bg-orange-600 text-white hover:bg-orange-500">
            View Full Feed
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function FeedCard({
  title,
  time,
  detail,
  icon,
  badge,
}: {
  title: string;
  time: string;
  detail: string;
  icon: React.ReactNode;
  badge: string;
}) {
  return (
    <Card className="border-stone-200 bg-white text-stone-900">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </div>
          <Badge className="border-stone-300 bg-stone-100 text-stone-700">{badge}</Badge>
        </div>
        <p className="mb-2 text-xs text-stone-500">{time}</p>
        <p className="text-sm text-stone-700">{detail}</p>
      </CardContent>
    </Card>
  );
}
