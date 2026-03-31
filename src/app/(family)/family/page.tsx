"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function FamilyHomePage() {
  return (
    <Card className="border-stone-200 bg-white text-stone-900">
      <CardHeader>
        <CardTitle className="text-xl font-display">Family Portal Home</CardTitle>
        <CardDescription>
          Hospitality shell is active. Today feed, care summary, and billing views are next in the scaffold sequence.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-stone-600">
        This route is live so role-based sign-in lands family users in a valid destination immediately.
      </CardContent>
    </Card>
  );
}
