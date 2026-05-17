/**
 * Tool registry for haven-ai-router (KB-NEXT-02).
 *
 * Catalog of every SECURITY DEFINER RPC the router is allowed to call via
 * the Claude tool-use loop. Each descriptor encodes:
 *   - the RPC name (must match `public.ai_tool_*` in migration 234)
 *   - the role gate the RPC enforces server-side
 *   - the PHI tier (informational; the RPC also enforces this for tier `phi`)
 *   - a JSON Schema for the *domain* parameters the model is allowed to
 *     supply. The four caller-context parameters (organization_id,
 *     user_id, role, facility_ids) are injected by `runToolLoop` and never
 *     accepted from the model.
 *
 * Why hand-written JSON Schema instead of `zod-to-json-schema`?
 *   The repo already depends on zod (for app-side runtime checks) but not on
 *   `zod-to-json-schema`. Per the segment constraint we do not add new
 *   dependencies; the schemas here are simple enough to author directly and
 *   are validated at runtime by `validateToolInput` below.
 *
 * SECURITY NOTE — defense in depth:
 *   The router validates inputs against the registry BEFORE the RPC is
 *   called, AND the RPC re-enforces role/PHI/tenancy inside its body. Either
 *   layer alone is sufficient; together they survive single-layer mistakes.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ToolRoleGate =
  | "any"
  | "staff"
  | "clinical"
  | "admin"
  | "family_or_clinical";

export type ToolPhiClass = "none" | "limited" | "phi";

export type JsonSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "integer" | "boolean";
      format?: "uuid";
      minimum?: number;
      maximum?: number;
      description?: string;
      enum?: string[];
    }
  >;
  required?: string[];
  additionalProperties: false;
};

export type ToolDescriptor = {
  /** Short name the model sees, e.g. `facility_directory`. */
  name: string;
  /** Actual RPC name in Postgres, e.g. `ai_tool_facility_directory`. */
  rpc: string;
  /** One-paragraph description served to the model. */
  description: string;
  /** Input schema the model fills in; caller context is injected by the router. */
  inputSchema: JsonSchema;
  roleGate: ToolRoleGate;
  phiClass: ToolPhiClass;
  /** Inferred source table for citation rendering. */
  sourceTable: string;
};

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: JsonSchema;
};

/* ------------------------------------------------------------------ */
/*  Reusable schema fragments                                          */
/* ------------------------------------------------------------------ */

const FACILITY_ID_PROP = {
  type: "string" as const,
  format: "uuid" as const,
  description:
    "The facility id to scope the call to. Must be one of the caller's accessible facilities.",
};

const OPTIONAL_FACILITY_ID_PROP = {
  ...FACILITY_ID_PROP,
  description:
    "Optional facility id. If omitted, returns rows across all of the caller's accessible facilities.",
};

const RESIDENT_ID_PROP = {
  type: "string" as const,
  format: "uuid" as const,
  description: "The resident id. Caller must have access to the resident's facility.",
};

const DAYS_PROP = (defaultDays: number) => ({
  type: "integer" as const,
  minimum: 1,
  maximum: 365,
  description: `Lookback window in days (default ${defaultDays}, max 365).`,
});

/* ------------------------------------------------------------------ */
/*  Registry — must stay in sync with migration 234                    */
/* ------------------------------------------------------------------ */

export const TOOL_REGISTRY: Record<string, ToolDescriptor> = {
  facility_directory: {
    name: "facility_directory",
    rpc: "ai_tool_facility_directory",
    description:
      "List facilities in the caller's organization with administrator, address, phone, email, licensed beds, and Medicaid provider count. Optionally pass a single facility_id to narrow.",
    inputSchema: {
      type: "object",
      properties: { facility_id: OPTIONAL_FACILITY_ID_PROP },
      additionalProperties: false,
    },
    roleGate: "any",
    phiClass: "none",
    sourceTable: "facilities",
  },

  staff_directory: {
    name: "staff_directory",
    rpc: "ai_tool_staff_directory",
    description:
      "Staff roster for one facility. Returns name, role, hire/term date, email, phone, employment status. Never returns DOB, SSN, or wage information.",
    inputSchema: {
      type: "object",
      properties: {
        facility_id: FACILITY_ID_PROP,
        role: {
          type: "string",
          description: "Optional staff_role filter (e.g. 'administrator', 'cna', 'rn').",
        },
      },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "staff",
    phiClass: "limited",
    sourceTable: "staff",
  },

  org_chart: {
    name: "org_chart",
    rpc: "ai_tool_org_chart",
    description:
      "Organization → entities → facilities tree, with the administrator name on each facility. No parameters.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    roleGate: "any",
    phiClass: "none",
    sourceTable: "organizations",
  },

  resident_summary: {
    name: "resident_summary",
    rpc: "ai_tool_resident_summary",
    description:
      "Minimal resident summary: name, room, primary diagnosis, primary payer, advance-directive flag, facility. PHI-tier — caller's organization must have allow_phi enabled, and family members must be linked via family_resident_links.",
    inputSchema: {
      type: "object",
      properties: { resident_id: RESIDENT_ID_PROP },
      required: ["resident_id"],
      additionalProperties: false,
    },
    roleGate: "family_or_clinical",
    phiClass: "phi",
    sourceTable: "residents",
  },

  med_orders: {
    name: "med_orders",
    rpc: "ai_tool_med_orders",
    description:
      "Active medication orders for a single resident. PHI-tier; clinical role required.",
    inputSchema: {
      type: "object",
      properties: { resident_id: RESIDENT_ID_PROP },
      required: ["resident_id"],
      additionalProperties: false,
    },
    roleGate: "clinical",
    phiClass: "phi",
    sourceTable: "resident_medications",
  },

  incident_summary: {
    name: "incident_summary",
    rpc: "ai_tool_incident_summary",
    description:
      "Incident counts by severity for a facility within the last p_days, plus the 5 most recent incidents (occurred_at, severity, category, short title).",
    inputSchema: {
      type: "object",
      properties: {
        facility_id: FACILITY_ID_PROP,
        days: DAYS_PROP(30),
      },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "staff",
    phiClass: "limited",
    sourceTable: "incidents",
  },

  compliance_status: {
    name: "compliance_status",
    rpc: "ai_tool_compliance_status",
    description:
      "Open survey deficiencies and active plan-of-correction status for a facility. Admin role required.",
    inputSchema: {
      type: "object",
      properties: { facility_id: FACILITY_ID_PROP },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "admin",
    phiClass: "none",
    sourceTable: "survey_deficiencies",
  },

  ar_aging_by_facility: {
    name: "ar_aging_by_facility",
    rpc: "ai_tool_ar_aging_by_facility",
    description:
      "Accounts-receivable aging buckets (current, 30-60, 60-90, 90+ in cents) for a facility plus the oldest unpaid invoice age in days. Reads invoices directly.",
    inputSchema: {
      type: "object",
      properties: { facility_id: FACILITY_ID_PROP },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "admin",
    phiClass: "none",
    sourceTable: "invoices",
  },

  facility_medicaid_providers: {
    name: "facility_medicaid_providers",
    rpc: "ai_tool_facility_medicaid_providers",
    description:
      "Medicaid MCO providers enrolled at a facility (provider name, type, status, contract dates).",
    inputSchema: {
      type: "object",
      properties: { facility_id: FACILITY_ID_PROP },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "admin",
    phiClass: "none",
    sourceTable: "facility_medicaid_providers",
  },

  active_alerts: {
    name: "active_alerts",
    rpc: "ai_tool_active_alerts",
    description:
      "Open exec_alerts (last 30 days). Optionally narrow to a single facility.",
    inputSchema: {
      type: "object",
      properties: { facility_id: OPTIONAL_FACILITY_ID_PROP },
      additionalProperties: false,
    },
    roleGate: "staff",
    phiClass: "none",
    sourceTable: "exec_alerts",
  },

  certifications_expiring: {
    name: "certifications_expiring",
    rpc: "ai_tool_certifications_expiring",
    description:
      "Active staff certifications at a facility that expire within p_days. Returns staff name, certification type, expiration date, days until expiry.",
    inputSchema: {
      type: "object",
      properties: {
        facility_id: FACILITY_ID_PROP,
        days: DAYS_PROP(30),
      },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "admin",
    phiClass: "limited",
    sourceTable: "staff_certifications",
  },

  open_followups: {
    name: "open_followups",
    rpc: "ai_tool_open_followups",
    description:
      "Incident follow-ups for a facility that are overdue (due_at < now()) and not yet completed.",
    inputSchema: {
      type: "object",
      properties: { facility_id: FACILITY_ID_PROP },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "staff",
    phiClass: "limited",
    sourceTable: "incident_followups",
  },

  pilot_facility_snapshot: {
    name: "pilot_facility_snapshot",
    rpc: "ai_tool_pilot_facility_snapshot",
    description:
      "One-call situational summary for a facility: occupancy, AR aging, open incidents, open survey deficiencies, MTD med errors, certifications expiring in 30d, active outbreaks, and 5 most recent alerts. Use this for 'tell me about <facility>'-style questions.",
    inputSchema: {
      type: "object",
      properties: { facility_id: FACILITY_ID_PROP },
      required: ["facility_id"],
      additionalProperties: false,
    },
    roleGate: "staff",
    phiClass: "limited",
    sourceTable: "facilities",
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function isAllowedTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name);
}

export function getToolDescriptor(name: string): ToolDescriptor | null {
  return isAllowedTool(name) ? TOOL_REGISTRY[name]! : null;
}

export function getAnthropicToolDefs(allowed?: string[]): AnthropicToolDef[] {
  const names = allowed && allowed.length > 0 ? allowed : Object.keys(TOOL_REGISTRY);
  const defs: AnthropicToolDef[] = [];
  for (const name of names) {
    const desc = TOOL_REGISTRY[name];
    if (!desc) continue;
    defs.push({
      name: desc.name,
      description: desc.description,
      input_schema: desc.inputSchema,
    });
  }
  return defs;
}

/**
 * Runtime check that mirrors the JSON Schema in `inputSchema`. Returns a
 * sanitized copy of the input limited to the schema's declared properties
 * (drops any extras the model tried to include).
 *
 * Throws Error with a `_user_message` field when the input is invalid; the
 * tool loop catches and returns the error to the model as a tool_result.
 */
export function validateToolInput(
  desc: ToolDescriptor,
  input: unknown,
): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`tool ${desc.name}: input must be a JSON object`);
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, schema] of Object.entries(desc.inputSchema.properties)) {
    if (!(key in obj)) continue;
    const v = obj[key];
    if (v === null || v === undefined) continue;

    switch (schema.type) {
      case "string": {
        if (typeof v !== "string") {
          throw new Error(`tool ${desc.name}: field ${key} must be a string`);
        }
        if (schema.format === "uuid" && !UUID_RE.test(v)) {
          throw new Error(`tool ${desc.name}: field ${key} must be a UUID`);
        }
        if (schema.enum && !schema.enum.includes(v)) {
          throw new Error(`tool ${desc.name}: field ${key} must be one of ${schema.enum.join(",")}`);
        }
        out[key] = v;
        break;
      }
      case "integer":
      case "number": {
        const num = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(num) || (schema.type === "integer" && !Number.isInteger(num))) {
          throw new Error(`tool ${desc.name}: field ${key} must be a ${schema.type}`);
        }
        if (typeof schema.minimum === "number" && num < schema.minimum) {
          throw new Error(`tool ${desc.name}: field ${key} must be >= ${schema.minimum}`);
        }
        if (typeof schema.maximum === "number" && num > schema.maximum) {
          throw new Error(`tool ${desc.name}: field ${key} must be <= ${schema.maximum}`);
        }
        out[key] = num;
        break;
      }
      case "boolean": {
        if (typeof v !== "boolean") {
          throw new Error(`tool ${desc.name}: field ${key} must be boolean`);
        }
        out[key] = v;
        break;
      }
    }
  }

  for (const req of desc.inputSchema.required ?? []) {
    if (!(req in out)) {
      throw new Error(`tool ${desc.name}: missing required field ${req}`);
    }
  }

  return out;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
