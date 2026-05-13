import { existsSync, readFileSync } from 'node:fs';
import {
  createNormalizedArtifact,
  writeNormalizedArtifact
} from './ingestion-lib.mjs';

const DEFAULT_SOURCES = [
  {
    id: 'admin-log',
    label: 'Admin Log — New Admission Sheet',
    path: '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Circle of Life/wiki/operations/compliance-checklists/admin-log.md',
    sections: ['New Admission Sheet', 'Collections — New Admit Sheet'],
    validationStatus: 'ready',
    scope: 'organization-wide'
  },
  {
    id: 'lmh-admin-mgr-log',
    label: 'LMH Admin Manager Log — New Admit Sheet',
    path: '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Circle of Life/wiki/operations/compliance-checklists/lmh-admin-mgr-log.md',
    sections: ['New Admit Sheet'],
    validationStatus: 'needs_review',
    scope: 'LMH facility identity unconfirmed'
  }
];

function sectionBody(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`### ${escaped}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, 'i'));
  return match?.[1] || '';
}

function tableItems(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line) && !/^\|\s*(Step|Task|Field|Area Audited)/i.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean)[0])
    .filter(Boolean);
}

const records = [];
const gaps = [];
for (const source of DEFAULT_SOURCES) {
  if (!existsSync(source.path)) {
    gaps.push({ moduleCode: 'M14', fieldOrRecord: source.label, reason: `Checklist source missing at ${source.path}`, round: 'round_1', sourceId: 'src-admissions-checklists' });
    continue;
  }
  const markdown = readFileSync(source.path, 'utf8');
  for (const section of source.sections) {
    const steps = tableItems(sectionBody(markdown, section));
    if (!steps.length) {
      gaps.push({ moduleCode: 'M14', fieldOrRecord: `${source.label} / ${section}`, reason: 'No checklist steps parsed from markdown reference.', round: 'round_1', sourceId: 'src-admissions-checklists' });
      continue;
    }
    records.push({
      targetEntity: 'move_in_checklist_definition',
      sourceRowRef: `admissions-checklist:${source.id}:${section.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      validationStatus: source.validationStatus,
      moduleCodes: ['M14'],
      data: {
        source: source.label,
        scope: source.scope,
        checklistName: section,
        stepCount: steps.length,
        steps,
        phase: section.toLowerCase().includes('collection') ? 'financial_collections' : 'admission_intake'
      },
      issues: source.validationStatus === 'needs_review' ? ['Source is useful as a richer checklist variant, but LMH facility identity is unconfirmed.'] : []
    });
  }
}

const artifact = createNormalizedArtifact({
  sourceId: 'src-admissions-checklists',
  parserName: 'parse-admissions-checklists',
  sourceRefs: DEFAULT_SOURCES.map((source) => ({ label: source.label, location: source.path })),
  records,
  gaps,
  extraSummary: {
    sourceFound: records.length > 0,
    checklistCount: records.length,
    totalStepCount: records.reduce((sum, record) => sum + record.data.stepCount, 0),
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Admissions checklist parser summary: ${records.length} checklist(s), ${artifact.summary.totalStepCount} step(s), ${gaps.length} gap(s).`);
