/**
 * Zod validation schemas for User Management API endpoints.
 */

import { z } from "zod";

// ── Shared ────────────────────────────────────────────────────────

const appRoleEnum = z.enum([
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "caregiver",
  "dietary",
  "housekeeper",
  "maintenance_role",
  "family",
  "broker",
]);

// ── List Users (GET query params) ─────────────────────────────────

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  role: appRoleEnum.optional(),
  facility_id: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
  status: z.enum(["active", "inactive", "deleted"]).default("active"),
  sort_by: z.enum(["created_at", "updated_at", "full_name", "email"]).default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

// ── Create User (POST body) ───────────────────────────────────────

export const createUserSchema = z
  .object({
    email: z.string().email("Invalid email address"),
    full_name: z.string().min(2, "Name must be at least 2 characters"),
    phone: z.string().optional(),
    app_role: appRoleEnum,
    job_title: z.string().optional(),
    avatar_url: z.string().url().optional(),
    manager_user_id: z.string().uuid().optional(),
    facilities: z
      .array(
        z.object({
          facility_id: z.string().uuid(),
          is_primary: z.boolean(),
        }),
      )
      .min(1, "At least one facility is required"),
    send_invite: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    const primaryCount = data.facilities.filter((facility) => facility.is_primary).length;
    if (primaryCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one primary facility is required",
        path: ["facilities"],
      });
    }
  })
  .strict();

// ── Update User (PATCH body) ──────────────────────────────────────

export const updateUserSchema = z
  .object({
    full_name: z.string().min(2).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    app_role: appRoleEnum.optional(),
    job_title: z.string().optional(),
    avatar_url: z.string().url().optional(),
    is_active: z.boolean().optional(),
    manager_user_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// ── Grant Facility Access (POST body) ─────────────────────────────

export const grantFacilityAccessSchema = z.object({
  facility_id: z.string().uuid(),
  is_primary: z.boolean().default(false),
});

// ── Delete User (optional body) ───────────────────────────────────

export const deleteUserSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ── Reactivate User (optional body) ───────────────────────────────

export const reactivateUserSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ── Audit Log (GET query params) ──────────────────────────────────

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  action: z
    .enum([
      "create",
      "update_profile",
      "update_role",
      "grant_access",
      "revoke_access",
      "soft_delete",
      "reactivate",
    ])
    .optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

// ── Type exports ──────────────────────────────────────────────────

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type GrantFacilityAccessBody = z.infer<typeof grantFacilityAccessSchema>;
export type DeleteUserBody = z.infer<typeof deleteUserSchema>;
export type ReactivateUserBody = z.infer<typeof reactivateUserSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
