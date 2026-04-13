"use client";

import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Heart,
  Home,
  MessageCircle,
  Phone,
  Pill,
  Shield,
  Users,
  FileText,
} from "lucide-react";
import type { GraceTemplate } from "./types";

/**
 * Quick actions: `phrase` is sent as the user message when clicked.
 * Use `{facilityName}` — replaced client-side with the header facility name or a generic hint.
 * `action`: `route_flow` runs the orchestrator (structured flows); others go straight to knowledge-agent.
 */
export const GRACE_TEMPLATES: GraceTemplate[] = [
  {
    id: "daily_census",
    icon: BarChart3,
    title: "Daily census",
    subtitle: "Resident count, admissions, discharges, occupancy",
    roles: ["manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "Give me today's census snapshot for my accessible facilities. If my header facility is set to {facilityName}, lead with that site, then summarize other sites briefly. Include admissions, discharges, and approximate occupancy if available.",
    action: "send_knowledge",
  },
  {
    id: "open_incidents",
    icon: Shield,
    title: "Open incidents",
    subtitle: "Unresolved incidents and follow-ups",
    roles: ["nurse", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "List open or unresolved safety or clinical incidents I should know about, newest first. Prefer {facilityName} when my header facility applies; mention if data is org-wide.",
    action: "send_knowledge",
  },
  {
    id: "resident_count",
    icon: Users,
    title: "Resident count",
    subtitle: "How many residents by site (live census)",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "How many active residents do we have right now at {facilityName}? If I asked about a different site by name (for example Oakridge), answer for that site using live census tools.",
    action: "send_knowledge",
  },
  {
    id: "check_resident",
    icon: Heart,
    title: "Who needs attention",
    subtitle: "Residents with alerts, tasks, or follow-ups",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "At {facilityName}, which residents have care alerts, open tasks, or follow-ups I should review soon? Summarize briefly per resident.",
    action: "send_knowledge",
  },
  {
    id: "new_leads",
    icon: Users,
    title: "New leads",
    subtitle: "Recent inquiries and pipeline activity",
    roles: ["admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "At {facilityName}, do we have any new leads in the past week? Give me the count, active pipeline count, and top lead names with status.",
    action: "send_knowledge",
  },
  {
    id: "pending_admissions",
    icon: ClipboardCheck,
    title: "Pending admissions",
    subtitle: "Move-in blockers and readiness",
    roles: ["admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "At {facilityName}, which admissions are still pending and what is blocking move-in readiness?",
    action: "send_knowledge",
  },
  {
    id: "medication_check",
    icon: Pill,
    title: "Medications due soon",
    subtitle: "High-risk meds and due/overdue passes",
    roles: ["nurse", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "For {facilityName}, what medication passes are due soon or overdue? Call out high-risk meds and any missed doses if the data is available.",
    action: "send_knowledge",
  },
  {
    id: "expiring_credentials",
    icon: Shield,
    title: "Expiring credentials",
    subtitle: "Training and certification watchlist",
    roles: ["nurse", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "At {facilityName}, which certifications or training completions expire in the next 30 days?",
    action: "send_knowledge",
  },
  {
    id: "staff_on_shift",
    icon: Users,
    title: "Who's on shift",
    subtitle: "Current staff and roles",
    roles: ["nurse", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase: "Who is on shift right now at {facilityName}? Include roles or assignments if available.",
    action: "send_knowledge",
  },
  {
    id: "trips_today",
    icon: Phone,
    title: "Trips today",
    subtitle: "Transportation schedule and ride status",
    roles: ["admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "At {facilityName}, what transport trips are scheduled today and which ones need attention?",
    action: "send_knowledge",
  },
  {
    id: "family_contact",
    icon: Phone,
    title: "Family & emergency contacts",
    subtitle: "How to look up contacts for a resident",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "How do I find emergency contacts and responsible parties for a resident at {facilityName}? If you need a resident name to query, ask me for it.",
    action: "send_knowledge",
  },
  {
    id: "check_room",
    icon: Home,
    title: "Rooms & beds",
    subtitle: "Occupancy and availability",
    roles: ["manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase: "What is the current room or bed occupancy and availability picture at {facilityName}?",
    action: "send_knowledge",
  },
  {
    id: "find_protocol",
    icon: BookOpen,
    title: "Find a protocol",
    subtitle: "SOPs and policy excerpts",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "Search our uploaded policies and SOPs for infection prevention and hand hygiene expectations. Cite document titles when possible.",
    action: "send_knowledge",
  },
  {
    id: "unreplied_reviews",
    icon: MessageCircle,
    title: "Unreplied reviews",
    subtitle: "Draft and failed reputation replies",
    roles: ["manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "At {facilityName}, are there any reviews waiting for a reply or failed reply posts?",
    action: "send_knowledge",
  },
  {
    id: "open_claims",
    icon: AlertTriangle,
    title: "Open claims",
    subtitle: "Insurance and risk watchlist",
    roles: ["facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "For {facilityName}, what insurance claims or renewals still need attention?",
    action: "send_knowledge",
  },
  {
    id: "ar_watchlist",
    icon: BarChart3,
    title: "AR watchlist",
    subtitle: "Overdue invoices and collections pressure",
    roles: ["facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "For {facilityName}, what overdue invoices or AR issues should I watch right now?",
    action: "send_knowledge",
  },
  {
    id: "executive_alerts",
    icon: AlertTriangle,
    title: "Executive alerts",
    subtitle: "Top risks and watchlist items",
    roles: ["manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase:
      "What are the top executive alerts I should know about for {facilityName}? Keep it brief and ranked by urgency.",
    action: "send_knowledge",
  },
  {
    id: "log_daily_note",
    icon: FileText,
    title: "Log a daily note",
    subtitle: "Structured daily care note",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "flow",
    phrase: "I want to log a daily care note for a resident.",
    flow_slug: "log_daily_note",
    action: "route_flow",
  },
  {
    id: "report_incident",
    icon: AlertTriangle,
    title: "Report an incident",
    subtitle: "Fall, med error, or safety event",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "flow",
    phrase: "I need to report a safety or clinical incident.",
    flow_slug: "report_incident",
    action: "route_flow",
  },
  {
    id: "schedule_assessment",
    icon: ClipboardCheck,
    title: "Schedule an assessment",
    subtitle: "Care plan review or evaluation",
    roles: ["nurse", "manager", "facility_admin", "org_admin", "owner"],
    type: "flow",
    phrase: "I need to schedule a resident assessment or care plan review.",
    flow_slug: "schedule_assessment",
    action: "route_flow",
  },
  {
    id: "ask_grace",
    icon: MessageCircle,
    title: "Ask anything",
    subtitle: "Type your own question",
    roles: ["caregiver", "nurse", "admin_assistant", "coordinator", "manager", "facility_admin", "org_admin", "owner"],
    type: "knowledge",
    phrase: "",
    action: "focus_only",
  },
];

export function filterGraceTemplates(role: string | null | undefined): GraceTemplate[] {
  const safeRole = role ?? "caregiver";
  return GRACE_TEMPLATES.filter((template) => template.roles.includes(safeRole));
}
