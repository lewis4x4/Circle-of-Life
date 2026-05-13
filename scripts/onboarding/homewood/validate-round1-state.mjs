import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scoreFacility } from '../../../facility-launch-center/src/scoring.js';
import { root } from './ingestion-lib.mjs';

const statePath = resolve(root, 'facility-launch-center/data/homewood-round1-state.json');
const publicStatePath = resolve(root, 'public/facility-launch-static/data/homewood-round1-state.json');
const summaryPath = resolve(root, 'docs/specs/HOMEWOOD-ROUND-1-STATE-SUMMARY-2026-05-13.md');
const stateText = readFileSync(statePath, 'utf8');
const publicStateText = readFileSync(publicStatePath, 'utf8');
const state = JSON.parse(stateText);
const errors = [];

function failUnless(condition, message) {
  if (!condition) errors.push(message);
}

failUnless(stateText === publicStateText, 'Canonical and public Round 1 state JSON outputs must be byte-identical');
const serialized = JSON.stringify(state);
const fullPublicPayload = `${stateText}\n${publicStateText}\n${readFileSync(summaryPath, 'utf8')}`;
for (const marker of ['dec-seed-1', 'Seeded Homewood pilot fixture', 'HOMEWOOD GL CERT 2.pdf', 'HOMEWOOD PROPERTY POLICY 2.pdf']) {
  failUnless(!serialized.includes(marker), `Round 1 state contains forbidden demo/duplicate marker: ${marker}`);
}

const forbiddenPatterns = [
  [/\b\d{3}-\d{2}-\d{4}\b/, 'SSN-like value'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'email-like value'],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, 'personal phone-like value']
];
for (const [pattern, label] of forbiddenPatterns) {
  failUnless(!pattern.test(fullPublicPayload), `Round 1 generated state/report contains ${label}`);
}

failUnless(state.ingestionManifest?.artifactCount === 16, 'Round 1 state must record 16 source artifacts');
failUnless(Array.isArray(state.ingestionReviewQueue), 'ingestionReviewQueue must exist');
failUnless(Array.isArray(state.ingestionGaps), 'ingestionGaps must exist');
failUnless(state.ingestionGaps.length === 11, `Expected 11 gap records, found ${state.ingestionGaps.length}`);
failUnless((state.documents || []).length === 4, `Expected 4 source-of-truth documents, found ${(state.documents || []).length}`);
failUnless((state.mvpData?.M3?.rooms || []).length === 20, `Expected 20 rooms, found ${(state.mvpData?.M3?.rooms || []).length}`);
failUnless(state.mvpData?.M3?.bedsTotal === 36, `Expected 36 beds, found ${state.mvpData?.M3?.bedsTotal}`);
failUnless((state.mvpData?.M5?.residents || []).length === 0, 'Round 1 state must not fabricate residents before face sheets/current A/R');
failUnless((state.mvpData?.M4?.employees || []).length === 0, 'Round 1 state must not fabricate employees before CFO workbook');
failUnless((state.documents || []).every((doc) => doc.isSourceOfTruth === true), 'Every imported document must be a source-of-truth document');

const readiness = scoreFacility(state);
failUnless(Number.isInteger(readiness.facilityReadinessScore), 'Facility readiness score must compute');

if (errors.length > 0) {
  console.error(`Homewood Round 1 state validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Homewood Round 1 state valid: readiness=${readiness.facilityReadinessScore}, gaps=${state.ingestionGaps.length}, reviews=${state.ingestionReviewQueue.length}, docs=${state.documents.length}, rooms=${state.mvpData.M3.rooms.length}.`);
