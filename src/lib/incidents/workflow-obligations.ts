export type IncidentWorkflowObligationShape = {
  severity: string;
  nurse_notified: boolean;
  administrator_notified: boolean;
  owner_notified: boolean;
  physician_notified: boolean;
  family_notified: boolean;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  insurance_reportable: boolean;
  insurance_reported: boolean;
};

export function buildIncidentOpenObligations(incident: IncidentWorkflowObligationShape): string[] {
  const items: string[] = [];
  if (!incident.nurse_notified) items.push("Notify the nurse.");
  if (!incident.administrator_notified) items.push("Notify the administrator.");
  if (incident.severity === "level_3" || incident.severity === "level_4") {
    if (!incident.owner_notified) items.push("Notify the owner.");
    if (!incident.physician_notified) items.push("Notify the physician.");
    if (!incident.family_notified) items.push("Notify the family.");
  }
  if (incident.ahca_reportable && !incident.ahca_reported) items.push("Complete AHCA reporting.");
  if (incident.insurance_reportable && !incident.insurance_reported) items.push("Report to the insurance carrier.");
  return items;
}
