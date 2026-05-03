#!/usr/bin/env node
import process from "node:process";

import {
  assertNoError,
  createAdminSupabaseClient,
  DEMO,
  DEMO_IDS,
  optionalEnv,
} from "./_config.mjs";
import { seedExecutiveIntelligence } from "./_seed-executive-intelligence.mjs";
import { seedTransportation } from "./_seed-transportation.mjs";

async function seedFoundation(supabase) {
  await assertNoError(
    "organizations upsert",
    supabase.from("organizations").upsert([
      {
        id: DEMO_IDS.orgId,
        name: DEMO.orgName,
        dba_name: "Haven Demo",
        status: "active",
        primary_contact_name: "Demo Admin",
        primary_contact_email: "demo-admin@haven.local",
        primary_contact_phone: "555-0100",
        address_line_1: "100 Demo Way",
        city: "Lake City",
        state: "FL",
        zip: "32025",
      },
    ]),
  );

  await assertNoError(
    "entities upsert",
    supabase.from("entities").upsert([
      {
        id: DEMO_IDS.entityId,
        organization_id: DEMO_IDS.orgId,
        name: DEMO.entityName,
        dba_name: "Oakridge Demo",
        entity_type: "LLC",
        fein: "00-0000000",
        status: "active",
        address_line_1: "100 Demo Way",
        city: "Lake City",
        state: "FL",
        zip: "32025",
      },
    ]),
  );

  await assertNoError(
    "facilities upsert",
    supabase.from("facilities").upsert([
      {
        id: DEMO_IDS.facilityId,
        entity_id: DEMO_IDS.entityId,
        organization_id: DEMO_IDS.orgId,
        name: DEMO.facilityName,
        license_type: "alf_intermediate",
        status: "active",
        address_line_1: "100 Demo Way",
        city: "Lake City",
        state: "FL",
        zip: "32025",
        county: "Columbia",
        phone: "555-0100",
        email: "demo-facility@haven.local",
        total_licensed_beds: 52,
        settings: { incident_report_prefix: "DEMO" },
      },
    ]),
  );

  await assertNoError(
    "units upsert",
    supabase.from("units").upsert([
      {
        id: DEMO_IDS.units.east,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        name: "East Wing",
        floor_number: 1,
        sort_order: 1,
      },
      {
        id: DEMO_IDS.units.west,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        name: "West Wing",
        floor_number: 1,
        sort_order: 2,
      },
      {
        id: DEMO_IDS.units.memory,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        name: "Memory Care",
        floor_number: 1,
        sort_order: 3,
      },
    ]),
  );

  await assertNoError(
    "rooms upsert",
    supabase.from("rooms").upsert([
      { id: DEMO_IDS.rooms.r101, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.east, room_number: "101", room_type: "private", max_occupancy: 1 },
      { id: DEMO_IDS.rooms.r102, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.east, room_number: "102", room_type: "private", max_occupancy: 1 },
      { id: DEMO_IDS.rooms.r104, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.memory, room_number: "104", room_type: "private", max_occupancy: 1 },
      { id: DEMO_IDS.rooms.r201, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.west, room_number: "201", room_type: "private", max_occupancy: 1 },
      { id: DEMO_IDS.rooms.r205, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.west, room_number: "205", room_type: "private", max_occupancy: 1 },
      { id: DEMO_IDS.rooms.r206, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.west, room_number: "206", room_type: "private", max_occupancy: 1 },
      { id: DEMO_IDS.rooms.r208, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, unit_id: DEMO_IDS.units.west, room_number: "208", room_type: "private", max_occupancy: 1 },
    ]),
  );

  await assertNoError(
    "beds upsert",
    supabase.from("beds").upsert([
      { id: DEMO_IDS.beds.b101a, room_id: DEMO_IDS.rooms.r101, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "A", bed_type: "alf_intermediate", status: "occupied", current_resident_id: null },
      { id: DEMO_IDS.beds.b102b, room_id: DEMO_IDS.rooms.r102, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "B", bed_type: "alf_intermediate", status: "occupied", current_resident_id: null },
      { id: DEMO_IDS.beds.b104a, room_id: DEMO_IDS.rooms.r104, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "A", bed_type: "memory_care", status: "occupied", current_resident_id: null },
      { id: DEMO_IDS.beds.b201a, room_id: DEMO_IDS.rooms.r201, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "A", bed_type: "alf_intermediate", status: "occupied", current_resident_id: null },
      { id: DEMO_IDS.beds.b205b, room_id: DEMO_IDS.rooms.r205, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "B", bed_type: "alf_intermediate", status: "occupied", current_resident_id: null },
      { id: DEMO_IDS.beds.b206a, room_id: DEMO_IDS.rooms.r206, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "A", bed_type: "alf_intermediate", status: "occupied", current_resident_id: null },
      { id: DEMO_IDS.beds.b208b, room_id: DEMO_IDS.rooms.r208, facility_id: DEMO_IDS.facilityId, organization_id: DEMO_IDS.orgId, bed_label: "B", bed_type: "alf_intermediate", status: "occupied", current_resident_id: null },
    ]),
  );
}

async function seedResidents(supabase) {
  await assertNoError(
    "residents upsert",
    supabase.from("residents").upsert([
      {
        id: DEMO_IDS.residents.margaret,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b101a,
        first_name: "Margaret",
        last_name: "Sullivan",
        preferred_name: "Margaret",
        date_of_birth: "1938-04-12",
        gender: "female",
        status: "active",
        acuity_level: "level_2",
        admission_date: "2025-09-14",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
      {
        id: DEMO_IDS.residents.arthur,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b102b,
        first_name: "Arthur",
        last_name: "Pendelton",
        preferred_name: "Art",
        date_of_birth: "1942-11-05",
        gender: "male",
        status: "active",
        acuity_level: "level_1",
        admission_date: "2024-05-02",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
      {
        id: DEMO_IDS.residents.eleanor,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b104a,
        first_name: "Eleanor",
        last_name: "Vance",
        preferred_name: "Ellie",
        date_of_birth: "1935-08-22",
        gender: "female",
        status: "hospital_hold",
        acuity_level: "level_3",
        admission_date: "2025-01-11",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
      {
        id: DEMO_IDS.residents.robert,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b201a,
        first_name: "Robert",
        last_name: "Chen",
        date_of_birth: "1945-02-14",
        gender: "male",
        status: "active",
        acuity_level: "level_1",
        admission_date: "2023-12-03",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
      {
        id: DEMO_IDS.residents.lucille,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b205b,
        first_name: "Lucille",
        last_name: "Booth",
        date_of_birth: "1931-09-30",
        gender: "female",
        status: "active",
        acuity_level: "level_2",
        admission_date: "2024-07-21",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
      {
        id: DEMO_IDS.residents.william,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b206a,
        first_name: "William",
        last_name: "Hastings",
        date_of_birth: "1940-12-08",
        gender: "male",
        status: "loa",
        acuity_level: "level_1",
        admission_date: "2024-11-09",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
      {
        id: DEMO_IDS.residents.dorothy,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        bed_id: DEMO_IDS.beds.b208b,
        first_name: "Dorothy",
        last_name: "Parker",
        date_of_birth: "1939-03-15",
        gender: "female",
        status: "active",
        acuity_level: "level_2",
        admission_date: "2024-04-15",
        code_status: "full_code",
        primary_payer: "private_pay",
      },
    ]),
  );

  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.margaret })
      .eq("id", DEMO_IDS.beds.b101a),
  );
  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.arthur })
      .eq("id", DEMO_IDS.beds.b102b),
  );
  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.eleanor })
      .eq("id", DEMO_IDS.beds.b104a),
  );
  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.robert })
      .eq("id", DEMO_IDS.beds.b201a),
  );
  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.lucille })
      .eq("id", DEMO_IDS.beds.b205b),
  );
  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.william })
      .eq("id", DEMO_IDS.beds.b206a),
  );
  await assertNoError(
    "beds occupancy update",
    supabase
      .from("beds")
      .update({ current_resident_id: DEMO_IDS.residents.dorothy })
      .eq("id", DEMO_IDS.beds.b208b),
  );
}

async function seedStaffAndScheduling(supabase) {
  await assertNoError(
    "staff upsert",
    supabase.from("staff").upsert([
      {
        id: DEMO_IDS.staff.rn,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        first_name: "John",
        last_name: "Diaz",
        staff_role: "rn",
        employment_status: "active",
        hire_date: "2022-06-01",
        hourly_rate: 3900,
      },
      {
        id: DEMO_IDS.staff.cnaDay,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        first_name: "Maria",
        last_name: "Gomez",
        staff_role: "cna",
        employment_status: "active",
        hire_date: "2023-02-18",
        hourly_rate: 2100,
      },
      {
        id: DEMO_IDS.staff.cnaNight,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        first_name: "Theresa",
        last_name: "Walker",
        staff_role: "cna",
        employment_status: "active",
        hire_date: "2023-11-09",
        hourly_rate: 2200,
      },
      {
        id: DEMO_IDS.staff.admin,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        first_name: "Jordan",
        last_name: "Reed",
        staff_role: "administrator",
        employment_status: "active",
        hire_date: "2021-08-04",
        hourly_rate: 4800,
      },
    ]),
  );
}

async function seedIncidents(supabase, actorUserId) {
  if (!actorUserId) {
    console.log("[demo:seed] skipping incidents: DEMO_ACTOR_USER_ID not provided");
    return;
  }

  const now = new Date();
  const seqYear = now.getFullYear();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  await assertNoError(
    "incidents upsert",
    supabase.from("incidents").upsert([
      {
        id: DEMO_IDS.incident.one,
        resident_id: DEMO_IDS.residents.margaret,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        incident_number: `DEMO-${seqYear}-0001`,
        category: "fall_without_injury",
        severity: "level_2",
        status: "open",
        occurred_at: twoHoursAgo,
        shift: "evening",
        location_description: "Room 101 bedside",
        location_type: "resident_room",
        room_id: DEMO_IDS.rooms.r101,
        unit_id: DEMO_IDS.units.east,
        description: "Resident found seated on floor beside bed.",
        immediate_actions: "Assisted to chair and completed assessment.",
        injury_occurred: false,
        reported_by: actorUserId,
      },
      {
        id: DEMO_IDS.incident.two,
        resident_id: DEMO_IDS.residents.eleanor,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        incident_number: `DEMO-${seqYear}-0002`,
        category: "fall_with_injury",
        severity: "level_3",
        status: "investigating",
        occurred_at: oneHourAgo,
        shift: "evening",
        location_description: "Memory care hallway",
        location_type: "hallway",
        room_id: DEMO_IDS.rooms.r104,
        unit_id: DEMO_IDS.units.memory,
        description: "Unwitnessed fall with forehead bruise.",
        immediate_actions: "Neuro checks initiated and physician notified.",
        injury_occurred: true,
        injury_description: "Forehead bruise and mild swelling.",
        reported_by: actorUserId,
      },
    ]),
  );

  await assertNoError(
    "incident_sequences sync",
    supabase.from("incident_sequences").upsert({
      facility_id: DEMO_IDS.facilityId,
      year: seqYear,
      last_number: 2,
    }),
  );

  await assertNoError(
    "incident followups upsert",
    supabase.from("incident_followups").upsert([
      {
        id: DEMO_IDS.incident.followupOne,
        incident_id: DEMO_IDS.incident.one,
        resident_id: DEMO_IDS.residents.margaret,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        task_type: "fall_risk_reassessment",
        description: "Complete Morse fall reassessment",
        due_at: inOneHour,
      },
    ]),
  );
}

async function seedBilling(supabase) {
  const today = new Date();
  const periodStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const dueDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 5));
  const invoiceYm = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;

  await assertNoError(
    "rate schedules upsert",
    supabase.from("rate_schedules").upsert([
      {
        id: DEMO_IDS.billing.rateSchedule,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        name: "Demo 2026 Standard Rates",
        effective_date: periodStart.toISOString().slice(0, 10),
        base_rate_private: 585000,
        base_rate_semi_private: 468000,
        care_surcharge_level_1: 0,
        care_surcharge_level_2: 38000,
        care_surcharge_level_3: 72000,
        community_fee: 50000,
      },
    ]),
  );

  await assertNoError(
    "resident payers upsert",
    supabase.from("resident_payers").upsert([
      {
        id: DEMO_IDS.billing.payerOne,
        resident_id: DEMO_IDS.residents.margaret,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        payer_type: "private_pay",
        is_primary: true,
        payer_name: "Family Responsible Party",
        payer_share_type: "full",
        effective_date: periodStart.toISOString().slice(0, 10),
      },
      {
        id: DEMO_IDS.billing.payerTwo,
        resident_id: DEMO_IDS.residents.arthur,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        payer_type: "private_pay",
        is_primary: true,
        payer_name: "Family Responsible Party",
        payer_share_type: "full",
        effective_date: periodStart.toISOString().slice(0, 10),
      },
    ]),
  );

  // skipped invoice_sequences due to trigger issue

  await assertNoError(
    "invoices upsert",
    supabase.from("invoices").upsert([
      {
        id: DEMO_IDS.billing.invoiceOne,
        resident_id: DEMO_IDS.residents.margaret,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        entity_id: DEMO_IDS.entityId,
        invoice_number: `DEMO-${invoiceYm}-001`,
        invoice_date: periodStart.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        status: "sent",
        subtotal: 620000,
        total: 620000,
        amount_paid: 0,
        balance_due: 620000,
        payer_type: "private_pay",
        payer_name: "Family Responsible Party",
      },
      {
        id: DEMO_IDS.billing.invoiceTwo,
        resident_id: DEMO_IDS.residents.arthur,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        entity_id: DEMO_IDS.entityId,
        invoice_number: `DEMO-${invoiceYm}-002`,
        invoice_date: periodStart.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        status: "paid",
        subtotal: 608000,
        total: 608000,
        amount_paid: 608000,
        balance_due: 0,
        payer_type: "private_pay",
        payer_name: "Family Responsible Party",
      },
    ]),
  );

  await assertNoError(
    "invoice line items upsert",
    supabase.from("invoice_line_items").upsert([
      {
        id: DEMO_IDS.billing.lineOne,
        invoice_id: DEMO_IDS.billing.invoiceOne,
        organization_id: DEMO_IDS.orgId,
        line_type: "base_rent",
        description: "Monthly base rent",
        quantity: 1,
        unit_price: 585000,
        total: 585000,
        sort_order: 1,
      },
      {
        id: DEMO_IDS.billing.lineTwo,
        invoice_id: DEMO_IDS.billing.invoiceOne,
        organization_id: DEMO_IDS.orgId,
        line_type: "care_surcharge",
        description: "Acuity level surcharge",
        quantity: 1,
        unit_price: 35000,
        total: 35000,
        sort_order: 2,
      },
      {
        id: DEMO_IDS.billing.lineThree,
        invoice_id: DEMO_IDS.billing.invoiceTwo,
        organization_id: DEMO_IDS.orgId,
        line_type: "base_rent",
        description: "Monthly base rent",
        quantity: 1,
        unit_price: 608000,
        total: 608000,
        sort_order: 1,
      },
    ]),
  );

  await assertNoError(
    "payments upsert",
    supabase.from("payments").upsert([
      {
        id: DEMO_IDS.billing.paymentOne,
        resident_id: DEMO_IDS.residents.arthur,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        entity_id: DEMO_IDS.entityId,
        invoice_id: DEMO_IDS.billing.invoiceTwo,
        payment_date: dueDate.toISOString().slice(0, 10),
        amount: 608000,
        payment_method: "ach",
        payer_name: "Family Responsible Party",
        payer_type: "private_pay",
        deposited: true,
        deposited_date: dueDate.toISOString().slice(0, 10),
      },
    ]),
  );
}

async function seedUserLinks(supabase, actorUserId, familyUserId) {
  if (actorUserId) {
    await assertNoError(
      "user profile upsert actor",
      supabase.from("user_profiles").upsert([
        {
          id: actorUserId,
          organization_id: DEMO_IDS.orgId,
          email: "demo-clinical@haven.local",
          full_name: "Demo Clinical User",
          app_role: "facility_admin",
          is_active: true,
        },
      ]),
    );

    await assertNoError(
      "user facility access upsert actor",
      supabase.from("user_facility_access").upsert([
        {
          user_id: actorUserId,
          facility_id: DEMO_IDS.facilityId,
          organization_id: DEMO_IDS.orgId,
          is_primary: true,
        },
      ]),
    );
  }

  if (familyUserId) {
    await assertNoError(
      "user profile upsert family",
      supabase.from("user_profiles").upsert([
        {
          id: familyUserId,
          organization_id: DEMO_IDS.orgId,
          email: "demo-family@haven.local",
          full_name: "Demo Family User",
          app_role: "family",
          is_active: true,
        },
      ]),
    );

    await assertNoError(
      "family resident link upsert",
      supabase.from("family_resident_links").upsert([
        {
          user_id: familyUserId,
          resident_id: DEMO_IDS.residents.margaret,
          organization_id: DEMO_IDS.orgId,
          relationship: "Daughter",
          is_responsible_party: true,
          can_view_clinical: true,
          can_view_financial: true,
        },
      ]),
    );
  }
}

async function seedPayroll(supabase) {
  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - 1);
  periodStart.setDate(1);
  const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);

  await assertNoError(
    "payroll batches upsert",
    supabase.from("payroll_export_batches").upsert([
      {
        id: DEMO_IDS.payroll.batchOne,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        provider: "ADP Workforce Now",
        status: "exported",
      },
      {
        id: DEMO_IDS.payroll.batchTwo,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        period_start: new Date(periodStart.getFullYear(), periodStart.getMonth() - 1, 1).toISOString().slice(0, 10),
        period_end: new Date(periodStart.getFullYear(), periodStart.getMonth(), 0).toISOString().slice(0, 10),
        provider: "ADP Workforce Now",
        status: "exported",
      },
    ]),
  );
}

async function seedDietary(supabase) {
  await assertNoError(
    "diet orders upsert",
    supabase.from("diet_orders").upsert([
      {
        id: DEMO_IDS.diet.orderOne,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        resident_id: DEMO_IDS.residents.margaret,
        iddsi_food_level: "level_7_regular_easy_chew",
        iddsi_fluid_level: "level_0_thin",
        status: "active",
      },
      {
        id: DEMO_IDS.diet.orderTwo,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        resident_id: DEMO_IDS.residents.arthur,
        iddsi_food_level: "level_5_minced_moist",
        iddsi_fluid_level: "level_2_mildly_thick",
        status: "active",
      },
    ]),
  );
}

async function seedReputation(supabase, actorUserId) {
  await assertNoError(
    "reputation accounts upsert",
    supabase.from("reputation_accounts").upsert([
      {
        id: DEMO_IDS.reputation.accountOne,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        label: "Oakridge Google Business",
        platform: "google_business",
        external_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        is_active: true,
      },
    ]),
  );

  if (!actorUserId) return;

  await assertNoError(
    "reputation replies upsert",
    supabase.from("reputation_replies").upsert([
      {
        id: DEMO_IDS.reputation.replyOne,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        reputation_account_id: DEMO_IDS.reputation.accountOne,
        reply_body: "Thank you for the wonderful 5-star review! Our team strives to provide excellent care.",
        status: "draft",
        created_by_user_id: actorUserId,
        updated_by: actorUserId,
      },
    ]),
  );
}

async function seedTraining(supabase, actorUserId) {
  if (!actorUserId) return;
  
  await assertNoError(
    "training demonstrations upsert",
    supabase.from("competency_demonstrations").upsert([
      {
        id: DEMO_IDS.training.demoOne,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        staff_id: DEMO_IDS.staff.rn,
        demonstrated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        evaluator_user_id: actorUserId,
        status: "passed",
        skills_checklist: { items: [{ name: "Handwashing", passed: true }] },
      },
      {
        id: DEMO_IDS.training.demoTwo,
        facility_id: DEMO_IDS.facilityId,
        organization_id: DEMO_IDS.orgId,
        staff_id: DEMO_IDS.staff.cnaDay,
        demonstrated_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
        evaluator_user_id: actorUserId,
        status: "passed",
        skills_checklist: { items: [{ name: "Lift assist", passed: true }] },
      },
    ]),
  );
}

async function seedInsurance(supabase) {
  const start = new Date();
  start.setMonth(start.getMonth() - 2);
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());

  await assertNoError(
    "insurance policies upsert",
    supabase.from("insurance_policies").upsert([
      {
        id: DEMO_IDS.insurance.policyOne,
        entity_id: DEMO_IDS.entityId,
        organization_id: DEMO_IDS.orgId,
        policy_type: "general_liability",
        carrier_name: "MedPro Group",
        policy_number: "PL-5510294",
        status: "active",
        effective_date: start.toISOString().slice(0, 10),
        expiration_date: end.toISOString().slice(0, 10),
      },
    ]),
  );
}


function requireExplicitDemoSeedApproval() {
  if (process.env.HAVEN_ALLOW_DEMO_SEED !== "1") {
    throw new Error(
      "Refusing to seed demo data without HAVEN_ALLOW_DEMO_SEED=1. Real Homewood data entry is underway.",
    );
  }

  const targetUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "";
  const isHostedSupabase = /\.supabase\.co\/?$/.test(targetUrl.replace(/^https?:\/\//, ""));
  if (isHostedSupabase && process.env.HAVEN_ALLOW_REMOTE_DEMO_SEED !== "1") {
    throw new Error(
      "Refusing to seed demo data on hosted Supabase without HAVEN_ALLOW_REMOTE_DEMO_SEED=1.",
    );
  }
}

async function main() {
  requireExplicitDemoSeedApproval();
  const supabase = createAdminSupabaseClient();
  const actorUserId = optionalEnv("DEMO_ACTOR_USER_ID");
  const familyUserId = optionalEnv("DEMO_FAMILY_USER_ID");

  console.log("[demo:seed] seeding deterministic demo workspace...");
  await seedFoundation(supabase);
  await seedResidents(supabase);
  await seedStaffAndScheduling(supabase);
  await seedBilling(supabase);
  await seedIncidents(supabase, actorUserId);
  await seedUserLinks(supabase, actorUserId, familyUserId);
  await seedPayroll(supabase);
  await seedDietary(supabase);
  await seedReputation(supabase, actorUserId);
  await seedTraining(supabase, actorUserId);
  await seedInsurance(supabase);
  await seedTransportation(supabase, actorUserId);

  console.log("[demo:seed] done");
  
  await seedExecutiveIntelligence(supabase, actorUserId);
  console.log("[demo:seed] executive intelligence seeded");

  console.log(`[demo:seed] organization_id=${DEMO_IDS.orgId}`);
  console.log(`[demo:seed] facility_id=${DEMO_IDS.facilityId}`);
}

main().catch((error) => {
  console.error("[demo:seed] failed:", error.message);
  process.exit(1);
});
