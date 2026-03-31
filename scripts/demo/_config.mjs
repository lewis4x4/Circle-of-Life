import process from "node:process";
import { createClient } from "@supabase/supabase-js";

export const DEMO_IDS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  entityId: "11111111-1111-1111-1111-111111111112",
  facilityId: "11111111-1111-1111-1111-111111111113",
  units: {
    east: "11111111-1111-1111-1111-111111111121",
    west: "11111111-1111-1111-1111-111111111122",
    memory: "11111111-1111-1111-1111-111111111123",
  },
  rooms: {
    r101: "11111111-1111-1111-1111-111111111131",
    r102: "11111111-1111-1111-1111-111111111132",
    r104: "11111111-1111-1111-1111-111111111133",
    r201: "11111111-1111-1111-1111-111111111134",
    r205: "11111111-1111-1111-1111-111111111135",
    r206: "11111111-1111-1111-1111-111111111136",
    r208: "11111111-1111-1111-1111-111111111137",
  },
  beds: {
    b101a: "11111111-1111-1111-1111-111111111141",
    b102b: "11111111-1111-1111-1111-111111111142",
    b104a: "11111111-1111-1111-1111-111111111143",
    b201a: "11111111-1111-1111-1111-111111111144",
    b205b: "11111111-1111-1111-1111-111111111145",
    b206a: "11111111-1111-1111-1111-111111111146",
    b208b: "11111111-1111-1111-1111-111111111147",
  },
  residents: {
    margaret: "11111111-1111-1111-1111-111111111151",
    arthur: "11111111-1111-1111-1111-111111111152",
    eleanor: "11111111-1111-1111-1111-111111111153",
    robert: "11111111-1111-1111-1111-111111111154",
    lucille: "11111111-1111-1111-1111-111111111155",
    william: "11111111-1111-1111-1111-111111111156",
    dorothy: "11111111-1111-1111-1111-111111111157",
  },
  staff: {
    rn: "11111111-1111-1111-1111-111111111161",
    cnaDay: "11111111-1111-1111-1111-111111111162",
    cnaNight: "11111111-1111-1111-1111-111111111163",
    admin: "11111111-1111-1111-1111-111111111164",
  },
  incident: {
    one: "11111111-1111-1111-1111-111111111171",
    two: "11111111-1111-1111-1111-111111111172",
    followupOne: "11111111-1111-1111-1111-111111111173",
  },
  billing: {
    rateSchedule: "11111111-1111-1111-1111-111111111181",
    payerOne: "11111111-1111-1111-1111-111111111182",
    payerTwo: "11111111-1111-1111-1111-111111111183",
    invoiceOne: "11111111-1111-1111-1111-111111111184",
    invoiceTwo: "11111111-1111-1111-1111-111111111185",
    lineOne: "11111111-1111-1111-1111-111111111186",
    lineTwo: "11111111-1111-1111-1111-111111111187",
    lineThree: "11111111-1111-1111-1111-111111111188",
    paymentOne: "11111111-1111-1111-1111-111111111189",
  },
};

export const DEMO = {
  orgName: "Haven Demo Workspace",
  entityName: "Haven Demo Operations LLC",
  facilityName: "Oakridge Demo ALF",
};

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function createAdminSupabaseClient() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function assertNoError(label, operation) {
  const { error } = await operation;
  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
}
