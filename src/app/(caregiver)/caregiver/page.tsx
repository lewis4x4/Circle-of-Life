"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CaregiverHomePage() {
  return (
    <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
      <CardHeader>
        <CardTitle className="text-xl font-display">Caregiver Shift Home</CardTitle>
        <CardDescription className="text-zinc-400">
          Shell is active. Task queue, meds, and incident draft routes will follow in the scaffold sprint.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-zinc-300">
        Connected role routing is now in place. This page prevents dead-end redirects during UI scaffolding.
      </CardContent>
    </Card>
  );
}
