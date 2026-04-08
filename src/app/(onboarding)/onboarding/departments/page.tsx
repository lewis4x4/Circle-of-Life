import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingDepartmentsPage() {
  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardHeader>
        <CardTitle className="text-white">Departments</CardTitle>
        <CardDescription className="text-slate-400">
          Department workspaces will land here in the next segment.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-slate-300">
        This placeholder keeps navigation stable while question lanes and completion workflows are implemented.
      </CardContent>
    </Card>
  );
}
