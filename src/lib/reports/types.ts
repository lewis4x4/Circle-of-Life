export type ReportTemplate = {
  id: string;
  slug: string;
  name: string;
  category: string;
  shortDescription: string;
  officialTemplate: boolean;
  lockedDefinition: boolean;
};

export type ReportSavedView = {
  id: string;
  templateId: string;
  templateVersionId: string;
  name: string;
  sharingScope: "private" | "team" | "facility" | "organization";
  pinnedTemplateVersion: boolean;
};

export type ReportSchedule = {
  id: string;
  sourceType: "template" | "saved_view" | "pack";
  sourceId: string;
  recurrenceRule: string;
  timezone: string;
  status: "active" | "paused" | "failed";
  outputFormat: "csv" | "pdf" | "print" | "xlsx";
};

export type ReportPack = {
  id: string;
  name: string;
  category: string;
  officialPack: boolean;
  lockedDefinition: boolean;
};
