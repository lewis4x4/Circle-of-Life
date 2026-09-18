#!/usr/bin/env node
/**
 * Letter-size screenshots of the four COL-354 print sheets, rendered from
 * synthetic data (COL-354 evidence).
 *
 * The sheets are the real components with the real print stylesheet. The data
 * is a synthetic Level 3 Fall built in this file: no resident, staff member,
 * facility or incident number here belongs to anybody. Nothing is read from or
 * written to any Supabase project, so this produces evidence without touching
 * hosted and without a print audit row for a sheet nobody printed.
 *
 *   node scripts/care-events/print-sheet-screenshots.mjs [outDir]
 *
 * Needs `npx playwright install chromium` once.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The sheets are .tsx. Run this file through tsx so the imports below compile:
//   npx tsx scripts/care-events/print-sheet-screenshots.mjs <outDir>

const outDir = path.resolve(process.argv[2] ?? "test-results/col354-print");
fs.mkdirSync(outDir, { recursive: true });

const facility = {
  id: "00000000-0000-0000-0000-0000000000f1",
  name: "Test Lodge (synthetic)",
  addressLine1: "1 Test Way",
  city: "Testville",
  state: "FL",
  zip: "00000",
  phone: "555-0100",
  timeZone: "America/New_York",
};

const witness = (over = {}) => ({
  id: "00000000-0000-0000-0000-0000000000w1",
  incidentId: "00000000-0000-0000-0000-0000000000i1",
  incidentNumber: "TST-2026-0007",
  careEventId: "00000000-0000-0000-0000-0000000000c1",
  description: "Witness statement for TST-2026-0007",
  dueAt: "2026-09-16T22:00:00Z",
  assignedTo: "00000000-0000-0000-0000-0000000000u2",
  assignedToName: "Test Staff B",
  completedAt: "2026-09-16T23:04:00Z",
  completedBy: "00000000-0000-0000-0000-0000000000u2",
  choice: "saw_it",
  note: "She was reaching for the call light.",
  ...over,
});

const packet = {
  card: {
    id: "00000000-0000-0000-0000-0000000000c1",
    status: "acknowledged",
    kind: "fall",
    tileWord: "Fall",
    level: 3,
    derivedLevel: 3,
    levelChangeReason: null,
    sentence:
      "Found on the floor in the resident room at 10:05 PM. Not witnessed. Hurt a little. Hit head. Not going out. First aid given.",
    note: "Complained of a sore hip.",
    occurredAt: "2026-09-16T22:05:00Z",
    createdAt: "2026-09-16T22:06:00Z",
    acknowledgedAt: "2026-09-16T22:09:00Z",
    acknowledgedByName: "Test Administrator",
    closedAt: null,
    facilityId: facility.id,
    organizationId: "00000000-0000-0000-0000-0000000000o1",
    timeZone: facility.timeZone,
    resident: { id: "00000000-0000-0000-0000-0000000000r1", name: "Test, Resident", roomLabel: "114" },
    reporter: { id: "00000000-0000-0000-0000-0000000000u1", fullName: "Test Staff A", firstName: "Test", phone: null },
    incident: {
      id: "00000000-0000-0000-0000-0000000000i1",
      incidentNumber: "TST-2026-0007",
      status: "open",
      familyNotified: true,
      familyNotifiedAt: "2026-09-16T22:30:00Z",
      familyNotifiedMethod: "phone",
      physicianNotified: true,
      physicianNotifiedAt: "2026-09-16T22:35:00Z",
      physicianOrders: "Ice and observe. Call with any change.",
      injuryTreatment: "first_aid",
      ahcaReportable: false,
      resolutionNotes: null,
    },
    flags: { neuro_checks: true },
    admin: {
      familyNotifiedAt: "2026-09-16T22:30:00Z",
      familyLater: false,
      physicianNotifiedAt: "2026-09-16T22:35:00Z",
      physicianLater: false,
      ems: "none",
      correctiveActions: ["care_plan_review", "increased_checks"],
      correctiveOther: "Moved the call light within reach.",
      ahcaReportable: false,
      ahcaReason: null,
      dcfReportedAt: null,
      videoSecured: "na",
    },
    attachments: [],
    deliveries: [],
    gate: null,
  },
  facility,
  resident: {
    id: "00000000-0000-0000-0000-0000000000r1",
    firstName: "Resident",
    lastName: "Test",
    dateOfBirth: "1944-07-28",
    roomLabel: "114",
    physicianName: "Dr Test",
    physicianPhone: "555-0111",
    physicianFax: "555-0112",
  },
  incidentExtras: {
    immediateActions: "First aid given.",
    injuryOccurred: true,
    injuryDescription: "Bruise forming on the right hip",
    injurySeverity: "minor",
    injuryBodyLocation: "right_hip",
    locationDescription: "Resident room",
    contributingFactors: ["rushing", "improper_footwear"],
    physicianNotifiedAt: "2026-09-16T22:35:00Z",
    familyNotifiedAt: "2026-09-16T22:30:00Z",
    resolutionNotes: null,
  },
  witnesses: [witness(), witness({ id: "w2", assignedToName: "Test Staff C", completedAt: null, choice: null, note: null })],
  attachments: [
    { id: "a1", path: "o/f/c/a.jpg", kind: "photo", description: null, takenAt: "2026-09-16T22:10:00Z", takenByName: "Test Staff A" },
    { id: "a2", path: "o/f/c/b.pdf", kind: "physician_order", description: null, takenAt: "2026-09-16T23:40:00Z", takenByName: "Test Administrator" },
  ],
};

const logRows = Array.from({ length: 6 }, (_, index) => ({
  incidentId: `i${index}`,
  logDate: `2026-09-${String(index + 8).padStart(2, "0")}`,
  room: `1${10 + index}`,
  resident: `Test, Resident ${String.fromCharCode(65 + index)}`,
  fall: index % 2 === 0,
  bruise: index % 3 === 0,
  scrapesOrBurn: index === 1,
  cutLacerationPuncture: index === 4,
  nonApparent: false,
  other: index % 2 === 1 && index !== 1,
  contributingFactors: index % 2 === 0 ? "rushing; improper_footwear" : "",
  shift: ["day", "evening", "night"][index % 3],
}));

const levelEffects = [
  { level: 1, word: "Note", steps: [], ackWithinMinutes: null, followups: [] },
  {
    level: 2,
    word: "Heads-up",
    steps: [
      { step: 0, afterMinutes: 0, target: "Administrator or Assistant", channels: ["in_app", "push"] },
      { step: 1, afterMinutes: 30, target: "On-call primary", channels: ["sms"] },
    ],
    ackWithinMinutes: 30,
    followups: [
      { taskType: "vitals_check", description: "Vital signs check", dueOffsetMinutes: 0, kind: "fall", requiresFlag: null },
      { taskType: "witness_statement", description: "Witness statement", dueOffsetMinutes: 480, kind: "any", requiresFlag: null },
    ],
  },
  {
    level: 3,
    word: "Urgent",
    steps: [
      { step: 0, afterMinutes: 0, target: "Administrator or Assistant", channels: ["in_app", "push", "sms"] },
      { step: 2, afterMinutes: 10, target: "On-call secondary", channels: ["sms", "voice"] },
      { step: 3, afterMinutes: 20, target: "Corporate", channels: ["push", "sms"] },
    ],
    ackWithinMinutes: 10,
    followups: [
      { taskType: "vitals_check", description: "Vital signs check", dueOffsetMinutes: 0, kind: "fall", requiresFlag: null },
      { taskType: "neuro_check", description: "Neuro check", dueOffsetMinutes: 120, kind: "fall", requiresFlag: "neuro_checks" },
      { taskType: "witness_statement", description: "Witness statement", dueOffsetMinutes: 480, kind: "any", requiresFlag: null },
    ],
  },
  {
    level: 4,
    word: "Emergency",
    steps: [
      { step: 0, afterMinutes: 0, target: "Administrator or Assistant", channels: ["in_app", "push", "sms", "voice"] },
      { step: 2, afterMinutes: 0, target: "Owner", channels: ["push", "sms", "voice"] },
    ],
    ackWithinMinutes: 5,
    followups: [
      { taskType: "ahca_report_preparation", description: "Prepare the AHCA adverse incident report", dueOffsetMinutes: 60, kind: "any", requiresFlag: null },
    ],
  },
];

async function main() {
  const { IncidentFormSheet } = await import("../../src/components/care-events/print/IncidentFormSheet.tsx");
  const { PhysicianSheet } = await import("../../src/components/care-events/print/PhysicianSheet.tsx");
  const { IncidentReportsLogSheet } = await import("../../src/components/care-events/print/IncidentReportsLogSheet.tsx");
  const { TaxonomyPacketSheet } = await import("../../src/components/care-events/print/TaxonomyPacketSheet.tsx");

  const sheets = [
    { name: "incident-form", element: React.createElement(IncidentFormSheet, { packet }) },
    { name: "physician-sheet", element: React.createElement(PhysicianSheet, { packet }) },
    {
      name: "incident-reports-log",
      element: React.createElement(IncidentReportsLogSheet, { facility, rows: logRows, from: "2026-09-01", to: "2026-09-30" }),
    },
    { name: "taxonomy-packet", element: React.createElement(TaxonomyPacketSheet, { facility, effects: levelEffects }) },
  ];

  const browser = await chromium.launch();
  try {
    for (const sheet of sheets) {
      const body = renderToStaticMarkup(sheet.element);
      const html = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style>@page { size: letter; margin: 0.5in; } body { width: 8.5in; background:#fff; color:#000; font-family: ui-sans-serif, system-ui, sans-serif; }</style>
</head><body>${body}</body></html>`;
      const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.emulateMedia({ media: "print" });
      const file = path.join(outDir, `${sheet.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      const bytes = fs.statSync(file).size;
      console.log(`[col354:print] ${sheet.name}.png  ${Math.round(bytes / 1024)} KB  (letter width 8.5in at 2x)`);
      if (bytes < 5000) throw new Error(`${sheet.name} rendered almost nothing`);
    }
    console.log(`[col354:print] PASS (${sheets.length} sheets, synthetic data, no Supabase call)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[col354:print] FAIL:", error?.message ?? error);
  process.exit(1);
});
