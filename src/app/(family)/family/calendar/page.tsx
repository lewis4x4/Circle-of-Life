"use client";

import { CalendarDays, Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const events = [
  {
    id: "e1",
    title: "Family video call window",
    day: "Thursday, Apr 3",
    time: "2:00 – 2:30 PM",
    location: "Activities lounge · iPad station",
    tag: "Scheduled",
  },
  {
    id: "e2",
    title: "Physician telehealth visit",
    day: "Monday, Apr 7",
    time: "10:15 AM",
    location: "Resident room · nursing assist",
    tag: "Clinical",
  },
  {
    id: "e3",
    title: "Spring family social",
    day: "Saturday, Apr 12",
    time: "3:00 – 5:00 PM",
    location: "Main dining · courtyard weather permitting",
    tag: "Community",
  },
] as const;

export default function FamilyCalendarPage() {
  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-display">
            <CalendarDays className="h-6 w-6 text-orange-600" />
            Calendar
          </CardTitle>
          <CardDescription>
            Visits, telehealth, and community events your care team has on the books (Phase 1 read-only scaffold).
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-3">
        {events.map((ev) => (
          <Card key={ev.id} className="border-stone-200 bg-white text-stone-900">
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-stone-900">{ev.title}</p>
                <Badge variant="outline" className="border-stone-300 text-stone-700">
                  {ev.tag}
                </Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-stone-600">
                <CalendarDays className="h-4 w-4 text-stone-400" />
                {ev.day}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-stone-600">
                <Clock className="h-4 w-4 text-stone-400" />
                {ev.time}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-stone-600">
                <MapPin className="h-4 w-4 text-stone-400" />
                {ev.location}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
