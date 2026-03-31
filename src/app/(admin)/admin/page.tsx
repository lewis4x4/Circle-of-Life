"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminHomePage() {
  return (
    <Card className="border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
      <CardHeader>
        <CardTitle className="text-2xl font-display">Admin Command Center</CardTitle>
        <CardDescription>
          Core dashboard modules are being scaffolded in sequence. Residents is now available as the first premium table flow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/admin/residents">
          <Button className="tap-responsive">
            Open Resident Master List
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
