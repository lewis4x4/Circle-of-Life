"use client";

import { LogOut, UserCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CaregiverMePage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
              <UserCircle2 className="h-8 w-8 text-zinc-400" />
            </div>
            <div>
              <CardTitle className="text-lg font-display">Your profile</CardTitle>
              <CardDescription className="text-zinc-400">CNA · Oakridge ALF</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-emerald-800/60 bg-emerald-950/30 text-emerald-200">
            Credential current
          </Badge>
          <Badge variant="outline" className="border-zinc-700 text-zinc-300">
            Shift: Night
          </Badge>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription className="text-zinc-400">Sign-in and preferences will connect to Supabase auth in a later segment.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="w-full border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            disabled
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out (coming soon)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
