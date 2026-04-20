/**
 * One-off script: create demo users for Oakridge ALF.
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-demo-users.mjs
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const OAKRIDGE_FACILITY_ID = "00000000-0000-0000-0002-000000000001";
const PASSWORD = process.env.DEMO_USER_PASSWORD ?? "Sp33dy22";

const USERS = [
  { email: "care@oakridge.com", full_name: "Care Giver", app_role: "caregiver" },
  { email: "medtech@oakridge.com", full_name: "Med Tech", app_role: "med_tech" },
  { email: "family@oakridge.com", full_name: "Family Member", app_role: "family" },
  { email: "food@oakridge.com", full_name: "Food Services", app_role: "dietary" },
];

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

async function createAuthUser(email, app_role) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { app_role, organization_id: ORG_ID },
      user_metadata: {},
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Auth create failed for ${email}: ${JSON.stringify(json)}`);
  return json.id;
}

async function upsertProfile(id, email, full_name, app_role) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id,
      organization_id: ORG_ID,
      email,
      full_name,
      app_role,
      is_active: true,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Profile upsert failed for ${email}: ${txt}`);
  }
}

async function upsertFacilityAccess(user_id) {
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_facility_access?user_id=eq.${user_id}&facility_id=eq.${OAKRIDGE_FACILITY_ID}&select=user_id`,
    { headers },
  );
  const existing = await checkRes.json();
  if (existing.length > 0) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_facility_access`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id,
      facility_id: OAKRIDGE_FACILITY_ID,
      organization_id: ORG_ID,
      is_primary: true,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Facility access failed for ${user_id}: ${txt}`);
  }
}

async function userExists(email) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=id`,
    { headers },
  );
  const rows = await res.json();
  return rows.length > 0 ? rows[0].id : null;
}

for (const user of USERS) {
  process.stdout.write(`Creating ${user.email} (${user.app_role})... `);
  try {
    const existingId = await userExists(user.email);
    let authId = existingId;

    if (!existingId) {
      authId = await createAuthUser(user.email, user.app_role);
    } else {
      console.log(`already exists (${existingId}), updating profile...`);
    }

    await upsertProfile(authId, user.email, user.full_name, user.app_role);
    await upsertFacilityAccess(authId);
    console.log(`✓ ${authId}`);
  } catch (err) {
    console.error(`✗ ${err.message}`);
  }
}

console.log(`\nDone. All users: password = ${PASSWORD}`);
