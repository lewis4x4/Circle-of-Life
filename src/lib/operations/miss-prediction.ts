export type MissPredictorTask = {
  id: string;
  template_name: string;
  status: "pending" | "in_progress" | "completed" | "missed" | "deferred";
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  assigned_to_name: string | null;
  due_at: string | null;
  days_overdue: number;
  facility_name: string;
};

export type MissPredictorAdequacy = {
  adequacy_score: number;
  adequacy_rating: string;
  cannot_cover_count: number;
  current_shift: "day" | "evening" | "night";
  recommended_action: string | null;
} | null;

export type MissPrediction = {
  taskId: string;
  templateName: string;
  predictedRisk: number;
  predictedBand: "low" | "moderate" | "high" | "critical";
  rationale: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bandFor(score: number): MissPrediction["predictedBand"] {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "moderate";
  return "low";
}

function priorityWeight(priority: MissPredictorTask["priority"]) {
  switch (priority) {
    case "critical":
      return 32;
    case "high":
      return 20;
    case "normal":
      return 10;
    default:
      return 4;
  }
}

export function scoreMissPrediction(task: MissPredictorTask, adequacy: MissPredictorAdequacy): MissPrediction {
  let score = priorityWeight(task.priority);
  if (task.status === "in_progress") score -= 10;
  if (task.license_threatening) score += 24;
  if (task.days_overdue > 0) score += Math.min(30, task.days_overdue * 8);

  if (task.due_at) {
    const dueAt = new Date(task.due_at);
    if (!Number.isNaN(dueAt.getTime())) {
      const minutesUntilDue = Math.round((dueAt.getTime() - Date.now()) / 60000);
      if (minutesUntilDue <= 15) score += 12;
      else if (minutesUntilDue <= 60) score += 8;
      else if (minutesUntilDue <= 120) score += 4;
    }
  }

  if (adequacy) {
    if (adequacy.adequacy_score < 70) score += 18;
    else if (adequacy.adequacy_score < 85) score += 10;

    if (adequacy.cannot_cover_count > 0) score += Math.min(20, adequacy.cannot_cover_count * 4);
  }

  const predictedRisk = clamp(score);
  const predictedBand = bandFor(predictedRisk);
  const rationaleParts = [
    task.license_threatening ? "license-threatening" : null,
    task.days_overdue > 0 ? `${task.days_overdue}d overdue` : null,
    adequacy?.cannot_cover_count ? `${adequacy.cannot_cover_count} uncovered task(s)` : null,
    adequacy && adequacy.adequacy_score < 85 ? `adequacy ${adequacy.adequacy_score}%` : null,
  ].filter(Boolean);

  return {
    taskId: task.id,
    templateName: task.template_name,
    predictedRisk,
    predictedBand,
    rationale: rationaleParts.length > 0 ? rationaleParts.join(" · ") : "stable execution conditions",
  };
}

export function topMissPredictions(tasks: MissPredictorTask[], adequacy: MissPredictorAdequacy, limit = 3) {
  return tasks
    .filter((task) => task.status === "pending" || task.status === "in_progress")
    .map((task) => scoreMissPrediction(task, adequacy))
    .sort((left, right) => right.predictedRisk - left.predictedRisk)
    .slice(0, limit);
}
