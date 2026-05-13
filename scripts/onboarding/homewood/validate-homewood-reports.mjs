import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './ingestion-lib.mjs';

const reportPaths = [
  resolve(root, 'docs/specs/HOMEWOOD-ROUND-1-INGESTION-STATUS-2026-05-13.md'),
  resolve(root, 'docs/specs/HOMEWOOD-ROUND-1-STATE-SUMMARY-2026-05-13.md'),
  resolve(root, '.omx/artifacts/homewood-ingestion/HOMEWOOD-ROUND-1-STATUS.md'),
  resolve(root, '.omx/artifacts/homewood-ingestion/HOMEWOOD-ROUND-2-GAPS.md')
];

const forbiddenPatterns = [
  [/\b\d{3}-\d{2}-\d{4}\b/, 'SSN-like value'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'email-like value'],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, 'phone-like value'],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, 'slash-formatted date value'],
  [/\b(?:DOB|date of birth|birthdate)\b/i, 'DOB label']
];

const errors = [];
for (const path of reportPaths) {
  const text = readFileSync(path, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(text)) errors.push(`${path}: contains ${label}`);
  }
}

if (errors.length > 0) {
  console.error(`Homewood report PHI guard failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Homewood report PHI guard valid: ${reportPaths.length} report(s) scanned.`);
