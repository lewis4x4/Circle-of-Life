"use client";
import Link from "next/link";
import { useOnboardingStore } from "@/hooks/useOnboardingStore";

export default function OnboardingDepartmentsPage() {
  const questions = useOnboardingStore((s) => s.questionsById);
  const responses = useOnboardingStore((s) => s.responsesByQuestionId);
  const departments = [...new Set(Object.values(questions).map((q) => q.department))].sort();
  return <div className="space-y-6">
    <h1 className="text-2xl font-semibold">Department discovery</h1>
    <p>Review the questions assigned to each department. These counts reflect recorded answers, not operational readiness.</p>
    {!departments.length && <p>No department questions are loaded yet.</p>}
    <div className="grid gap-4 md:grid-cols-2">{departments.map((department) => {
      const assigned = Object.values(questions).filter((q) => q.department === department);
      const answered = assigned.filter((q) => responses[q.id]?.value?.trim()).length;
      return <Link className="rounded-lg border border-border p-5" key={department} href={`/onboarding/questions?department=${encodeURIComponent(department)}`}>
        <h2 className="font-medium">{department}</h2><p>{answered} of {assigned.length} questions answered</p><span className="underline">Review questions</span>
      </Link>;
    })}</div>
  </div>;
}
