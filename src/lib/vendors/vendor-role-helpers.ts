import type { Database } from "@/types/database";

type AppRole = Database["public"]["Enums"]["app_role"];

export function canManageVendorMaster(role: AppRole): boolean {
  return role === "owner" || role === "org_admin";
}

export function canApprovePurchaseOrder(role: AppRole): boolean {
  return role === "owner" || role === "org_admin";
}

export function canFinalizeVendorInvoice(role: AppRole): boolean {
  return role === "owner" || role === "org_admin";
}

export function canOperateFacilityVendorWorkflow(role: AppRole): boolean {
  return role === "owner" || role === "org_admin" || role === "facility_admin";
}
