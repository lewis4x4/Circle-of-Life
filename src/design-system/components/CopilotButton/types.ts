export type CopilotCitation = {
  source: string;
  id: string;
  excerpt: string;
};

export type CopilotSuggestion = {
  id: string;
  title: string;
  body: string;
  recordId: string;
  recordType: string;
  facilityId: string;
  generatedAt: string;
  modelVersion: string;
  citations: CopilotCitation[];
};

export type CopilotAction = "ack" | "act" | "dismiss";
