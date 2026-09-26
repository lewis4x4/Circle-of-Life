#!/usr/bin/env node
/** Repository-owned production observation. Provider strings are never output.
 * API contract: https://open-api.netlify.com/#tag/deploy
 * GitHub run attempts: https://docs.github.com/en/rest/actions/workflow-runs
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SITE_ID = 'be2bb95e-ba70-47f8-8d2d-70cd37b9b41a';
export const REPOSITORY = 'lewis4x4/Circle-of-Life';
export const SITE_NAME = 'circleoflifealf';
export const PRODUCTION_URL = 'https://circleoflifealf.com';
const ADMIN_URL = `https://app.netlify.com/projects/${SITE_NAME}`;
const DAY = 86_400_000;
const SHA = /^[a-f0-9]{40}$/;
const DEPLOY = /^[a-f0-9]{24}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const STATE_START = '<!-- haven-alert-state:v1 -->';
const STATE_END = '<!-- /haven-alert-state -->';
const copy = (value) => structuredClone(value);
const millis = (value) => Date.parse(value);
const utc = (value) => new Date(value).toISOString();
const fault = (category) => Object.assign(new Error(category), { category });
function instant(value, now) {
  if (typeof value !== 'string' || !RFC3339.test(value) || !Number.isFinite(millis(value))) return null;
  const [year, month, day, hour, minute, second] = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/).slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
  if (now && millis(value) > millis(now) + 300_000) return null;
  return utc(millis(value));
}
function ensure(condition, category) { if (!condition) throw fault(category); }
const STAGES = Object.freeze({
  dependency_install: ['dependency installation', 'Inspect the deploy log and dependency lockfile.'],
  build: ['build', 'Inspect the deploy log and reproduce the failing build command.'],
  deploy: ['publishing', 'Inspect the deploy log and publication permissions.'],
});
const PENDING_STATES = new Set(['new', 'pending', 'pending_review', 'accepted', 'enqueued', 'building', 'uploading', 'uploaded', 'preparing', 'prepared', 'processing', 'processed', 'retrying']);
const PROVIDER_STATES = new Set([...PENDING_STATES, 'error', 'ready']);
function safeSubject(message) {
  const subject = typeof message === 'string' ? message.split(/[\r\n]/, 1)[0] : '';
  if (/authorization|bearer|password|secret|token|https?:\/\/|[A-Za-z0-9_-]{32,}/i.test(subject)) return 'Commit subject withheld';
  return subject.replace(/[^A-Za-z0-9 .,():/#_+-]/g, '').trim().slice(0, 120) || 'Commit subject unavailable';
}
function failureStage(record) {
  if (Object.hasOwn(STAGES, record.error_stage)) return record.error_stage;
  // Inspect only bounded metadata for exact provider signatures. Nothing from
  // the matched text is interpolated into an issue or retained in the state.
  const message = typeof record.error_message === 'string' ? record.error_message.slice(0, 1024).replace(/[\x00-\x1f\x7f]/g, ' ') : '';
  if (/^Failed during stage 'building site'(?:[:.]|$)/.test(message)) return 'build';
  if (/^Failed during stage 'installing dependencies'(?:[:.]|$)/.test(message)) return 'dependency_install';
  if (/^Failed during stage '(?:deploying site|publishing site)'(?:[:.]|$)/.test(message)) return 'deploy';
  return 'unknown';
}
function exactSite(site) {
  return site?.id === SITE_ID && site.name === SITE_NAME && (site.admin_url === undefined || site.admin_url === ADMIN_URL);
}
function deployUrl(id) { ensure(DEPLOY.test(id), 'state-deploy-identity'); return `${ADMIN_URL}/deploys/${id}`; }

export function classifyDeploy(record, { site, commit, now } = {}) {
  const invalid = (reason) => ({ kind: 'invalid', reason });
  const ignored = (reason) => ({ kind: 'ignored', reason, ...(DEPLOY.test(record?.id ?? '') ? { id: record.id } : {}) });
  if (!record || !exactSite(site)) return invalid('site-evidence');
  if (typeof record.site_id !== 'string') return invalid('missing-site');
  if (record.site_id !== SITE_ID) return ignored('other-site');
  if (['deploy-preview', 'branch-deploy'].includes(record.context)) return ignored('non-production');
  if (typeof record.context !== 'string' || record.context !== 'production') return invalid('context');
  if (typeof record.branch !== 'string') return invalid('branch');
  if (record.branch !== 'main') return ignored('non-main');
  if (record.draft === true) return ignored('draft');
  if (record.skipped === true) return ignored('skipped');
  if (record.superseded === true || record.state === 'superseded') return ignored('superseded');
  if (['canceled', 'cancelled', 'skipped'].includes(record.state)) return ignored('canceled-or-skipped');
  if (!DEPLOY.test(record.id ?? '') || !SHA.test(record.commit_ref ?? '')) return invalid('identity');
  if (commit?.error || commit?.exists !== true || commit?.onMain !== true || commit?.sha !== record.commit_ref || typeof commit.message !== 'string') return invalid('commit-proof');
  if (/\[skip netlify\]/i.test(commit.message)) return ignored('skip-netlify');
  const createdAt = instant(record.created_at, now);
  const providerUpdatedAt = instant(record.updated_at, now);
  if (!instant(now) || !createdAt || !providerUpdatedAt || millis(providerUpdatedAt) < millis(createdAt)) return invalid('timestamps');
  // Netlify's public deploy schema does not guarantee an exact failure timestamp.
  // Never promote updated_at, deploy_time, or an arbitrary error field to one.
  const result = { id: record.id, sha: record.commit_ref, createdAt, providerUpdatedAt,
    firstObservedTerminalAt: utc(millis(now)), exactFailureTimeAvailable: false,
    stage: failureStage(record), providerState: record.state, subject: safeSubject(commit.message) };
  if (record.state === 'error') return { ...result, kind: 'failure' };
  if (PENDING_STATES.has(record.state)) return { ...result, kind: 'pending' };
  if (record.state !== 'ready') return invalid('unknown-state');
  if (site.published_deploy?.id !== record.id) return { ...result, kind: 'ready' };
  const publishedAt = instant(record.published_at, now);
  if (!publishedAt || millis(publishedAt) < millis(createdAt)) return invalid('publication-time');
  return { ...result, kind: 'published', publishedAt };
}

export function initialState({ now, repository, siteId = SITE_ID } = {}) {
  ensure(instant(now) && REPO.test(repository ?? '') && siteId === SITE_ID, 'state-identity');
  return { schemaVersion: 1, repository, siteId, activationAt: utc(millis(now)), generation: 0,
    phase: 'initializing', discoveryBoundary: null, lastSuccessfulObservationAt: null,
    pendingDeploys: [], failureIds: [], failures: [], seenFailureIds: [], historicalExcludedIds: [], pendingEffects: [],
    deliveryComplete: false, assignmentConfirmedAt: null, publication: null, audit: {}, healthEvents: [] };
}

export function validateState(state, { repository = state?.repository, siteId = SITE_ID } = {}) {
  ensure(state && state.schemaVersion === 1 && state.repository === repository && REPO.test(repository ?? '') && state.siteId === siteId && siteId === SITE_ID, 'state-identity-or-schema-repair');
  ensure(['initializing', 'healthy', 'incident', 'recovering'].includes(state.phase) && Number.isSafeInteger(state.generation) && state.generation >= 0 && instant(state.activationAt), 'state-schema-repair');
  for (const key of ['pendingDeploys', 'failureIds', 'failures', 'seenFailureIds', 'historicalExcludedIds', 'pendingEffects', 'healthEvents']) ensure(Array.isArray(state[key]) && state[key].length <= 200, 'state-bound-repair');
  ensure(Buffer.byteLength(JSON.stringify(state)) <= 32 * 1024, 'state-size-bound-repair');
  for (const cursor of Object.values(state.audit ?? {})) {
    ensure(Array.isArray(cursor.pending) && cursor.pending.length <= 200 && Object.keys(cursor.consumed ?? {}).length <= 200, 'state-audit-bound-repair');
  }
  fields(state, ['schemaVersion', 'repository', 'siteId', 'activationAt', 'generation', 'phase', 'discoveryBoundary', 'lastSuccessfulObservationAt', 'pendingDeploys', 'failureIds', 'failures', 'seenFailureIds', 'historicalExcludedIds', 'pendingEffects', 'deliveryComplete', 'assignmentConfirmedAt', 'publication', 'priorPublication', 'recovery', 'audit', 'healthEvents', 'replayRunId', 'source', 'issueNumber', 'pendingDiscoveryBoundary', 'pendingObservedAt', 'discoveryAnchorId', 'pendingDiscoveryAnchorId', 'pendingAudit', 'consumedHealthEvents']);
  for (const key of ['discoveryBoundary', 'lastSuccessfulObservationAt', 'assignmentConfirmedAt', 'pendingDiscoveryBoundary', 'pendingObservedAt']) optionalTime(state[key]);
  ensure(typeof state.deliveryComplete === 'boolean', 'state-delivery-repair');
  if (state.source !== undefined) ensure(['observer', 'main-ci'].includes(state.source), 'state-source-repair');
  if (state.replayRunId !== undefined) ensure(/^\d{1,20}$/.test(state.replayRunId) && state.source === undefined, 'state-replay-repair');
  if (state.issueNumber !== undefined) positiveInt(state.issueNumber);
  for (const key of ['discoveryAnchorId', 'pendingDiscoveryAnchorId']) if (state[key] !== undefined) ensure(DEPLOY.test(state[key]), 'state-anchor-repair');
  for (const id of [...state.seenFailureIds, ...state.historicalExcludedIds]) ensure(DEPLOY.test(id), 'state-deploy-identity');
  for (const id of state.failureIds) ensure(state.source ? effectKey(id) : DEPLOY.test(id), 'state-failure-identity');
  ensure(new Set(state.failureIds).size === state.failureIds.length && state.failureIds.length === state.failures.length, 'state-failure-count-repair');
  for (const pending of state.pendingDeploys) {
    fields(pending, ['id', 'firstObservedAt']);
    ensure(DEPLOY.test(pending.id) && instant(pending.firstObservedAt), 'state-pending-identity');
  }
  for (const [index, event] of state.failures.entries()) {
    validateEvent(event, repository, !!state.source);
    if (!state.source) ensure(state.failureIds[index] === event.id, 'state-failure-identity');
    else ensure(state.failureIds[index].endsWith(`:${event.runId}:${event.attempt}`), 'state-failure-identity');
  }
  for (const key of ['publication', 'priorPublication', 'recovery']) if (state[key] != null) { validateEvent(state[key], repository, false); ensure(state[key].kind === 'published', 'state-publication-repair'); }
  for (const effect of state.pendingEffects) {
    fields(effect, ['type', 'key', 'deployId', 'event', 'count']);
    ensure(['failure', 'recovery'].includes(effect.type) && effectKey(effect.key), 'state-effect-repair');
    validateEvent(effect.event, repository, !!state.source);
    if (effect.deployId !== undefined) ensure(DEPLOY.test(effect.deployId) && effect.deployId === effect.event.id, 'state-effect-identity');
    if (effect.count !== undefined) ensure(Number.isInteger(effect.count) && effect.count >= 1 && effect.count <= 200, 'state-effect-count');
    if (!state.source) ensure(effect.type === 'failure' ? effect.key === `failure:${effect.event.id}` : new RegExp(`^recovery:${effect.event.id}:\\d+$`).test(effect.key), 'state-effect-identity');
    else ensure(effect.key.endsWith(`:${effect.event.runId}:${effect.event.attempt}`) && (effect.type === 'failure' ? !effect.key.includes(':recovery:') : effect.key.startsWith(`${state.source}:recovery:`)), 'state-effect-identity');
  }
  validateAudit(state.audit);
  if (state.pendingAudit !== undefined) validateAudit(state.pendingAudit);
  for (const event of state.healthEvents) validateHealthEvent(event);
  if (state.consumedHealthEvents !== undefined) {
    ensure(Array.isArray(state.consumedHealthEvents) && state.consumedHealthEvents.length <= 200 && state.consumedHealthEvents.every((key) => /^coverage-gap:\d+:\d+:\d+$|^observation-recovery:\d+$/.test(key)), 'state-health-consumption');
  }
  return state;
}

function fields(value, keys) {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key)), 'state-schema-fields-repair');
}
function positiveInt(value) { ensure(Number.isSafeInteger(value) && value > 0, 'state-integer-identity'); }
function optionalTime(value) { if (value != null) ensure(!!instant(value), 'state-time-repair'); }
function effectKey(value) {
  return typeof value === 'string' && value.length <= 120 && /^(?:failure:[a-f0-9]{24}|recovery:[a-f0-9]{24}:\d+|(?:observer|main-ci):\d+:\d+:\d+|(?:observer|main-ci):recovery:\d+:\d+|coverage-gap:\d+:\d+:\d+)$/.test(value);
}
function validateEvent(event, repository, isRun) {
  if (isRun) {
    fields(event, ['runId', 'attempt', 'repository', 'sha', 'providerUpdatedAt', 'firstObservedTerminalAt', 'category']);
    positiveInt(event.runId); positiveInt(event.attempt);
    ensure(event.repository === repository && SHA.test(event.sha) && ['workflow-failure', 'workflow-success', 'coverage-gap'].includes(event.category), 'state-run-identity');
  } else {
    fields(event, ['id', 'sha', 'createdAt', 'providerUpdatedAt', 'firstObservedTerminalAt', 'exactFailureTimeAvailable', 'stage', 'providerState', 'subject', 'kind', 'publishedAt']);
    ensure(DEPLOY.test(event.id) && SHA.test(event.sha) && ['failure', 'pending', 'ready', 'published'].includes(event.kind), 'state-deploy-identity');
    ensure(PROVIDER_STATES.has(event.providerState) && ((event.kind === 'failure' && event.providerState === 'error') || (['ready', 'published'].includes(event.kind) && event.providerState === 'ready') || (event.kind === 'pending' && PENDING_STATES.has(event.providerState))), 'state-provider-state');
    ensure(event.stage === 'unknown' || Object.hasOwn(STAGES, event.stage), 'state-stage-repair');
    ensure(typeof event.subject === 'string' && event.subject === safeSubject(event.subject) && event.exactFailureTimeAvailable === false, 'state-subject-repair');
    ensure(instant(event.createdAt) && millis(event.providerUpdatedAt) >= millis(event.createdAt), 'state-chronology-repair');
    if (event.kind === 'published') ensure(instant(event.publishedAt) && millis(event.publishedAt) >= millis(event.createdAt), 'state-publication-time');
    else ensure(event.publishedAt === undefined, 'state-publication-kind');
  }
  ensure(instant(event.providerUpdatedAt) && instant(event.firstObservedTerminalAt), 'state-event-time');
}
function validateHealthEvent(event) {
  fields(event, ['key', 'type', 'at', 'previousAt', 'tuple', 'sha']);
  ensure(['gap', 'complete'].includes(event.type) && instant(event.at) && /^\d{1,20}:\d{1,6}$/.test(event.tuple) && SHA.test(event.sha), 'state-health-event');
  ensure(event.type === 'gap' ? /^coverage-gap:\d+:\d+:\d+$/.test(event.key) && event.key.endsWith(`:${event.tuple}`) && instant(event.previousAt) && millis(event.previousAt) < millis(event.at) : /^observation-recovery:\d+$/.test(event.key), 'state-health-key');
}
function validateAudit(value) {
  fields(value, ['observer', 'main-ci']);
  for (const cursor of Object.values(value)) {
    fields(cursor, ['anchor', 'nextShard', 'shards', 'pending', 'consumed', 'boundary', 'lastFullAuditAt', 'lastFaultAt', 'lastRecoveryAt']);
    ensure(instant(cursor.anchor) && Number.isInteger(cursor.nextShard) && cursor.nextShard >= 0 && cursor.nextShard < 30 && Array.isArray(cursor.shards) && cursor.shards.length <= 30, 'state-audit-cursor');
    ensure(Array.isArray(cursor.pending) && cursor.pending.length <= 200 && cursor.consumed && typeof cursor.consumed === 'object' && !Array.isArray(cursor.consumed) && Object.keys(cursor.consumed).length <= 200, 'state-audit-bound');
    for (const pending of cursor.pending) { fields(pending, ['id', 'attempt']); positiveInt(pending.id); positiveInt(pending.attempt); }
    for (const [key, outcome] of Object.entries(cursor.consumed)) ensure(/^\d+:\d+$/.test(key) && ['failure', 'timed_out', 'action_required', 'startup_failure', 'cancelled', 'neutral', 'skipped', 'stale', 'replay', 'success'].includes(outcome), 'state-audit-consumed');
    for (const key of ['boundary', 'lastFullAuditAt', 'lastFaultAt', 'lastRecoveryAt']) optionalTime(cursor[key]);
    for (const shard of cursor.shards) {
      if (!shard) continue;
      fields(shard, ['index', 'from', 'to', 'completedAt']);
      ensure(Number.isInteger(shard.index) && shard.index >= 0 && shard.index < 30 && instant(shard.from) && instant(shard.to) && millis(shard.to) > millis(shard.from) && instant(shard.completedAt), 'state-audit-shard');
    }
  }
}

function incomplete(state, reason) { return { state: copy(state), effects: [], coverageComplete: false, reason }; }

export function reduceObservation(saved, observation) {
  validateState(saved);
  const { deploys, site, now, complete, bootstrap = false } = observation;
  if (!complete || !instant(now) || site?.id !== SITE_ID) return incomplete(saved, 'incomplete-provider-coverage');
  const records = new Map();
  for (const event of deploys) {
    if (event.kind === 'invalid') return incomplete(saved, 'invalid-provider-evidence');
    if (!event.id) continue;
    if (records.has(event.id) && JSON.stringify(records.get(event.id)) !== JSON.stringify(event)) return incomplete(saved, 'conflicting-deploy-records');
    records.set(event.id, event);
  }
  const published = [...records.values()].find((e) => e.kind === 'published' && e.id === site.published_deploy?.id);
  if (bootstrap && !published) return incomplete(saved, 'bootstrap-publication-unproved');
  const state = copy(saved);
  const effects = [];
  if (bootstrap) {
    for (const event of records.values()) {
      if (event.kind === 'historical-failure' && !state.historicalExcludedIds.includes(event.id)) {
        state.historicalExcludedIds.push(event.id);
      }
    }
  }
  const pending = new Map(state.pendingDeploys.map((e) => [e.id, e]));
  for (const e of records.values()) {
    if (e.kind === 'pending') pending.set(e.id, pending.get(e.id) ?? { id: e.id, firstObservedAt: now });
    else pending.delete(e.id);
  }
  const failures = [...records.values()].filter((e) => e.kind === 'failure').sort((a, b) => millis(a.createdAt) - millis(b.createdAt) || a.id.localeCompare(b.id));
  for (const e of failures) {
    if (state.seenFailureIds.includes(e.id) || state.historicalExcludedIds.includes(e.id)) continue;
    if (bootstrap && millis(e.createdAt) < millis(published.createdAt) && !saved.pendingDeploys.some((p) => p.id === e.id)) { state.historicalExcludedIds.push(e.id); continue; }
    if (state.phase === 'healthy') { state.failureIds = []; state.failures = []; }
    if (!state.failureIds.length) {
      // A later publication observed beside a failure cannot be its predecessor.
      state.priorPublication = [saved.publication, published].filter((p) => p && millis(p.createdAt) < millis(e.createdAt)).sort((a, b) => millis(b.createdAt) - millis(a.createdAt))[0] ?? null;
    }
    state.phase = 'incident';
    state.failureIds.push(e.id);
    state.seenFailureIds.push(e.id);
    state.failures.push(e);
    effects.push({ type: 'failure', key: `failure:${e.id}`, deployId: e.id, event: e, count: state.failureIds.length });
  }
  state.pendingDeploys = [...pending.values()];
  if (published) {
    const recoverable = state.failures.length && state.failures.every((f) => millis(published.createdAt) > millis(f.createdAt) && millis(published.publishedAt) > millis(f.firstObservedTerminalAt));
    if (state.phase === 'incident' && recoverable) {
      state.phase = 'recovering';
      state.recovery = published;
      effects.push({ type: 'recovery', key: `recovery:${published.id}:${state.generation + 1}`, deployId: published.id, event: published });
    } else if (state.phase === 'initializing' && bootstrap) state.phase = 'healthy';
    state.publication = published;
  }
  state.generation += 1;
  state.pendingDiscoveryBoundary = now;
  if (observation.discoveryAnchorId) state.pendingDiscoveryAnchorId = observation.discoveryAnchorId;
  state.pendingObservedAt = now;
  const recoveryValid = published && state.failures.every((f) => millis(published.createdAt) > millis(f.createdAt) && millis(published.publishedAt) > millis(f.firstObservedTerminalAt));
  const retainedEffects = saved.pendingEffects.filter((e) => e.type !== 'recovery' || (recoveryValid && e.deployId === published.id));
  if (state.phase === 'recovering' && !recoveryValid) { state.phase = 'incident'; state.recovery = null; }
  state.pendingEffects = [...retainedEffects, ...effects.filter((e) => !retainedEffects.some((p) => p.key === e.key))];
  state.deliveryComplete = false;
  try { validateState(state); } catch { return incomplete(saved, 'state-bound-repair'); }
  return { state, effects, coverageComplete: true };
}

function namespace(state) {
  if (state.replayRunId) { ensure(/^\d+$/.test(state.replayRunId), 'replay-identity'); return `haven-netlify-replay:${state.replayRunId}`; }
  return state.source === 'observer' ? 'haven-netlify-observer-health' : state.source === 'main-ci' ? 'haven-main-ci-alert' : 'haven-netlify-production-alert';
}
function labelNames(state) {
  const name = state.replayRunId ? 'netlify-alert-synthetic' : state.source === 'observer' ? 'netlify-observer-health' : state.source === 'main-ci' ? 'main-ci-failure' : 'netlify-production-failure';
  return [name, ...(state.failureIds.length > 1 ? [`${name}-repeated`] : [])];
}
function describe(event) {
  if (event?.runId) return `Commit: \`${event.sha}\`\nRun: https://github.com/${event.repository}/actions/runs/${event.runId}/attempts/${event.attempt}\nAttempt: ${event.attempt}\nObserved outcome: ${event.category}\nProvider update: ${event.providerUpdatedAt}\nNext action: inspect the linked workflow attempt and restore complete coverage.`;
  if (!event) return 'No confirmed failure. Initialization requires a complete provider observation.';
  const stage = STAGES[event.stage];
  return `Commit: \`${event.sha}\`\nSubject: ${event.subject}\nDeploy: \`${event.id}\`\nProvider state: ${event.providerState}\nProvider updated at: ${event.providerUpdatedAt} (exact failure time unavailable)\nFirst observed terminal at: ${event.firstObservedTerminalAt}\nStage: ${stage ? stage[0] : 'stage unavailable from provider metadata'}\nDeploy log: ${deployUrl(event.id)}\nProduction: ${PRODUCTION_URL}\nNext action: ${stage ? stage[1] : 'Inspect the linked deploy log.'}`;
}
function describeRecovery(effect, observedAt) {
  const event = effect.event;
  if (event.runId) return `Recovery observed at: ${observedAt}\n${describe(event)}`;
  return `Recovery commit: \`${event.sha}\`\nRecovery deploy: \`${event.id}\`\nProvider state: ready\nPublished at: ${event.publishedAt}\nRecovery observed at: ${observedAt}\nDeploy log: ${deployUrl(event.id)}\nProduction: ${PRODUCTION_URL}`;
}
export function renderIncident(state) {
  validateState(state);
  const prefix = state.replayRunId ? '[SYNTHETIC]' : state.source === 'observer' ? '[Netlify observer health]' : state.source === 'main-ci' ? '[Main CI]' : '[Netlify production]';
  const count = state.failureIds.length;
  const title = `${prefix} ${count > 1 ? `repeated failure (${count})` : count ? 'verification failed' : 'monitor initialization'}`;
  const previous = state.priorPublication;
  const body = `<!-- ${namespace(state)} -->\n${state.replayRunId ? `Synthetic lifecycle replay ${state.replayRunId}; not a production incident.\n` : ''}Repository: ${state.repository}\nSite: ${state.siteId}\n${describe(state.failures.at(-1))}\n\nPrevious provider publication: ${previous ? `deploy ${previous.id}, commit ${previous.sha}, published at ${previous.publishedAt}` : 'unknown'}. Live route availability: unchecked.\n\nDistinct failure attempts: ${count}\n${STATE_START}\n${JSON.stringify(state)}\n${STATE_END}`;
  return { title, body, labels: labelNames(state), assignees: [state.repository.split('/')[0]] };
}
function replaceOwned(body, rendered) {
  if (!body) return rendered;
  // The whole machine-owned header precedes the state block. Human text after it
  // is retained byte-for-byte; malformed/multiple state blocks are never reset.
  const end = body.indexOf(STATE_END);
  ensure(end >= 0 && body.indexOf(STATE_START) === body.lastIndexOf(STATE_START) && end === body.lastIndexOf(STATE_END), 'state-block-repair');
  return rendered + body.slice(end + STATE_END.length);
}
function assigned(issue, owner) { return issue?.assignees?.some((a) => (a.login ?? a) === owner); }
function labeled(issue, labels) { return labels.every((label) => issue?.labels?.some((l) => (l.name ?? l) === label)); }
async function writeConfirmed(write, read, predicate, category) {
  try { await write(); } catch { /* Response may have been lost after acceptance. */ }
  const result = await read();
  ensure(predicate(result), category);
  return result;
}

export async function reconcileEffects(plan, adapter) {
  ensure(plan.coverageComplete, 'delivery-incomplete-coverage');
  const state = copy(validateState(plan.state));
  const owner = state.repository.split('/')[0];
  const marker = `<!-- ${namespace(state)} -->`;
  let issue = await adapter.findIssue(marker);
  if (!issue) issue = await writeConfirmed(() => adapter.createIssue(renderIncident(state)), () => adapter.findIssue(marker), (value) => !!value, 'delivery-create-readback');
  ensure(issue.body?.includes(marker), 'delivery-namespace');
  const previous = await adapter.load();
  // A retry of the same plan must not downgrade an acknowledged transaction.
  if (previous?.generation > state.generation) throw fault('state-generation-conflict');
  state.issueNumber = issue.number;
  state.deliveryComplete = false;
  state.assignmentConfirmedAt = null;
  // Discovery cursors are prepared alongside effects, but remain uncommitted
  // until readback verifies every effect. A restart retains the desired audit.
  const desiredAudit = copy(state.audit);
  if (state.source) { state.pendingAudit = desiredAudit; state.audit = previous?.audit ?? {}; }
  const persist = async () => {
    validateState(state);
    return writeConfirmed(() => adapter.save(state), () => adapter.load(), (value) => JSON.stringify(value) === JSON.stringify(state), 'delivery-state-readback');
  };
  await persist();
  const applyBody = async (phase, count) => {
    const view = { ...state, phase, failureIds: state.failureIds.slice(0, count), failures: state.failures.slice(0, count) };
    const rendered = renderIncident(view);
    const current = await adapter.getIssue(issue.number);
    const body = replaceOwned(current.body, rendered.body);
    // adapter.save owns the durable state; body replacement must carry the full
    // desired transaction, even while the visible title advances one event.
    const durableBody = body.replace(/<!-- haven-alert-state:v1 -->[\s\S]*?<!-- \/haven-alert-state -->/, `${STATE_START}\n${JSON.stringify(state)}\n${STATE_END}`);
    const labels = [...new Set([...(current.labels ?? []).map((l) => l.name ?? l).filter((l) => !l.startsWith(labelNames(state)[0])), ...rendered.labels])];
    issue = await writeConfirmed(() => adapter.updateIssue(issue.number, { title: rendered.title, body: durableBody, labels, assignees: [owner], state: phase === 'healthy' ? current.state : 'open' }), () => adapter.getIssue(issue.number), (value) => assigned(value, owner) && labeled(value, rendered.labels) && value.body === durableBody && (phase === 'healthy' || value.state === 'open'), 'delivery-assignment-label-readback');
  };
  const effects = [...state.pendingEffects];
  if (!effects.length) await applyBody(state.phase, state.failureIds.length);
  for (const effect of effects) {
    await applyBody(effect.type === 'failure' ? 'incident' : state.phase, effect.count ?? state.failureIds.length);
    const key = `<!-- ${namespace(state)}:effect:${effect.key} -->`;
    const comments = await adapter.listComments(issue.number);
    if (!comments.some((c) => c.body?.includes(key))) {
      const body = `${key}\n${effect.type === 'recovery' ? describeRecovery(effect, state.pendingObservedAt) : `Distinct failure ${effect.count ?? state.failureIds.length}.\n${describe(effect.event)}`}`;
      await writeConfirmed(() => adapter.createComment(issue.number, { body }), () => adapter.listComments(issue.number), (values) => values.some((c) => c.body === body), 'delivery-comment-readback');
    }
    // Assignment timing ends only after issue and occurrence evidence readback.
    const readback = await adapter.getIssue(issue.number);
    ensure(assigned(readback, owner), 'delivery-assignment-readback');
    if (effect.type === 'failure') state.assignmentConfirmedAt = adapter.clock();
    if (effect.type === 'recovery') {
      ensure(await adapter.validatePublication(effect, state), 'delivery-publication-changed');
      await writeConfirmed(() => adapter.updateIssue(issue.number, { state: 'closed' }), () => adapter.getIssue(issue.number), (value) => value.state === 'closed', 'delivery-close-readback');
      if (!await adapter.validatePublication(effect, state)) {
        await adapter.updateIssue(issue.number, { state: 'open' });
        throw fault('delivery-publication-race');
      }
      state.phase = 'healthy';
    }
  }
  if (state.phase === 'healthy') await writeConfirmed(() => adapter.updateIssue(issue.number, { state: 'closed' }), () => adapter.getIssue(issue.number), (value) => value.state === 'closed', 'delivery-initialization-close-readback');
  state.pendingEffects = [];
  state.discoveryBoundary = state.pendingDiscoveryBoundary ?? state.discoveryBoundary;
  if (state.pendingDiscoveryAnchorId) state.discoveryAnchorId = state.pendingDiscoveryAnchorId;
  state.lastSuccessfulObservationAt = state.pendingObservedAt ?? state.lastSuccessfulObservationAt;
  state.deliveryComplete = true;
  if (state.source) { state.audit = desiredAudit; delete state.pendingAudit; }
  await persist();
  return { state, issueNumber: issue.number, deliveryComplete: true };
}

function auditCursor(state, source, now) {
  return state.audit?.[source] ?? { anchor: now, nextShard: 0, shards: [], pending: [], consumed: {}, boundary: null, lastFullAuditAt: null, lastFaultAt: null };
}
export function planRunAudit(state, { source, now }) {
  ensure(['observer', 'main-ci'].includes(source) && instant(now), 'audit-source');
  const cursor = auditCursor(state, source, now);
  const anchor = millis(cursor.anchor);
  const shards = Array.from({ length: 3 }, (_, offset) => {
    const index = (cursor.nextShard + offset) % 30;
    return { index, from: utc(anchor - (31 - index) * DAY), to: utc(anchor - (30 - index) * DAY) };
  });
  const recent = { from: utc(Math.min(millis(now) - DAY, anchor - DAY, millis(cursor.boundary ?? now) - DAY)), to: now };
  return { shards, queries: [recent, ...shards].map((r) => ({ per_page: 100, created: `${r.from}..${r.to}`, branch: 'main' })), pendingRunIds: cursor.pending.map((r) => r.id), maxRequests: 50, maxPagesPerPartition: 10 };
}
const failureOutcomes = new Set(['failure', 'timed_out', 'action_required', 'startup_failure', 'cancelled']);
export function normalizeRun(run, options) {
  const expectedPath = `.github/workflows/${options.source === 'observer' ? 'netlify-production-failure-alert.yml' : 'ci-gates.yml'}`;
  if (run.workflow_id !== options.workflowId || run.repository?.full_name !== options.repository || run.head_repository?.full_name !== options.repository || run.head_branch !== 'main' || run.path !== expectedPath) return null;
  if (run.event === 'workflow_dispatch') {
    // The primary CI workflow has no synthetic replay mode. Its manual runs
    // use the same repository/workflow/main-source checks as push runs above.
    // Only the provider observer must prove live versus synthetic dispatch.
    if (options.source === 'observer') ensure(['observe', 'replay'].includes(run.verifiedMode), 'audit-ambiguous-dispatch');
  } else if (!(options.source === 'observer' ? ['push', 'schedule'] : ['push']).includes(run.event)) return null;
  if (!Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || !SHA.test(run.head_sha) || !instant(run.created_at, options.now) || !instant(run.updated_at, options.now)) throw fault('audit-run-identity');
  if (!['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(run.status) || (run.conclusion !== null && !['success', 'failure', 'timed_out', 'action_required', 'startup_failure', 'cancelled', 'neutral', 'skipped', 'stale'].includes(run.conclusion))) throw fault('audit-run-outcome');
  return run;
}
export function reduceRunAudit(saved, options) {
  validateState(saved);
  const { source, now, repository, runs, attempts = [], events = [], complete, completedShards = [], auditComplete = false } = options;
  if (!complete) return incomplete(saved, 'audit-incomplete-range');
  const state = copy(saved);
  const cursor = copy(auditCursor(state, source, now));
  const values = new Map();
  try {
    for (const raw of [...runs, ...attempts]) {
      const run = normalizeRun(raw, options);
      if (run) values.set(`${run.id}:${run.run_attempt}`, run);
    }
  } catch { return incomplete(saved, 'audit-run-identity'); }
  for (const run of values.values()) {
    for (let attempt = 1; attempt < run.run_attempt; attempt++) if (!values.has(`${run.id}:${attempt}`) && !cursor.consumed[`${run.id}:${attempt}`]) return incomplete(saved, 'audit-missing-attempt');
    if (source === 'observer' && run.event === 'workflow_dispatch' && !['observe', 'replay'].includes(run.verifiedMode)) return incomplete(saved, 'audit-ambiguous-dispatch');
  }
  const effects = [];
  const consumedEvents = new Set(state.consumedHealthEvents ?? []);
  if (source === 'observer') {
    for (const event of events) {
      try { validateHealthEvent(event); } catch { return incomplete(saved, 'audit-invalid-ledger-event'); }
      if (consumedEvents.has(event.key)) continue;
      if (event.type === 'gap') {
        const [runId, attempt] = event.tuple.split(':').map(Number);
        effects.push({ type: 'failure', key: event.key, event: { runId, attempt, repository, sha: event.sha, providerUpdatedAt: event.at, firstObservedTerminalAt: now, category: 'coverage-gap' } });
        cursor.lastFaultAt = utc(Math.max(millis(cursor.lastFaultAt ?? event.at), millis(event.at)));
      }
      consumedEvents.add(event.key);
    }
    // The producer removes only acknowledged events. Once absent from its next
    // complete snapshot, their consumer IDs may be compacted safely.
    if (options.events !== undefined) state.consumedHealthEvents = [...consumedEvents].filter((key) => events.some((event) => event.key === key));
  }
  const pending = new Map(cursor.pending.map((r) => [r.id, r]));
  const ordered = [...values.values()].sort((a, b) => millis(a.updated_at) - millis(b.updated_at) || a.run_attempt - b.run_attempt);
  let success = null;
  for (const run of ordered) {
    const key = `${run.id}:${run.run_attempt}`;
    if (run.status !== 'completed') { pending.set(run.id, { id: run.id, attempt: run.run_attempt }); continue; }
    pending.delete(run.id);
    if (cursor.consumed[key]) continue;
    if (run.verifiedMode === 'replay') { cursor.consumed[key] = 'replay'; continue; }
    const event = { runId: run.id, attempt: run.run_attempt, repository, sha: run.head_sha,
      providerUpdatedAt: instant(run.updated_at), firstObservedTerminalAt: now, category: failureOutcomes.has(run.conclusion) ? 'workflow-failure' : 'workflow-success' };
    if (failureOutcomes.has(run.conclusion)) {
      const effectKey = `${source}:${run.workflow_id}:${key}`;
      effects.push({ type: 'failure', key: effectKey, event });
      cursor.lastFaultAt = utc(Math.max(millis(cursor.lastFaultAt ?? run.updated_at), millis(run.updated_at)));
    } else if (run.conclusion === 'success' && (source === 'main-ci' || run.observationComplete === true)) success = { run, event };
    // Successful runs need no failure dedup entry. Retaining every five-minute
    // success forever would exhaust the state bound. Recovery has its own key.
    if (run.conclusion !== 'success') cursor.consumed[key] = run.conclusion;
  }
  cursor.pending = [...pending.values()];
  effects.sort((a, b) => millis(a.event.providerUpdatedAt) - millis(b.event.providerUpdatedAt));
  for (const shard of completedShards) cursor.shards[shard.index] = { ...shard, completedAt: now };
  if (completedShards.length) cursor.nextShard = (completedShards.at(-1).index + 1) % 30;
  const fullShardCoverage = cursor.shards.filter(Boolean).length === 30 && cursor.shards.every((shard) => millis(now) - millis(shard.completedAt) <= 50 * 60_000);
  if (auditComplete && (completedShards.length === 0 || fullShardCoverage)) cursor.lastFullAuditAt = now;
  const fresh = !!cursor.lastFullAuditAt && millis(now) - millis(cursor.lastFullAuditAt) <= 50 * 60_000;
  const coverageComplete = fresh;
  if (success && cursor.lastFaultAt && millis(success.run.updated_at) > millis(cursor.lastFaultAt) && millis(success.run.updated_at) > millis(cursor.lastRecoveryAt ?? '1970-01-01T00:00:00Z') && fresh && !cursor.pending.length) {
    effects.push({ type: 'recovery', key: `${source}:recovery:${success.run.id}:${success.run.run_attempt}`, event: success.event });
    cursor.lastRecoveryAt = success.run.updated_at;
  }
  cursor.boundary = now;
  if (completedShards.length && cursor.nextShard === 0 && cursor.shards.filter(Boolean).length === 30) { cursor.anchor = now; cursor.shards = []; }
  state.audit[source] = cursor;
  // Direct reducer callers can enumerate a complete whole audit in one pass.
  return { state, effects, progressComplete: true, coverageComplete, reason: fresh ? undefined : 'audit-warming-or-stale' };
}

export async function replayLifecycle({ adapter, runId, now }) {
  ensure(/^\d+$/.test(runId), 'replay-identity');
  const repository = adapter.repository ?? 'example/haven';
  const existing = await adapter.load();
  ensure(!existing || existing.replayRunId === runId, 'replay-namespace');
  let state = existing ?? { ...initialState({ now, repository, siteId: SITE_ID }), replayRunId: runId };
  // Reruns reuse this run's original fixture clock and issue namespace.
  now = state.activationAt;
  if (existing?.deliveryComplete && existing.phase === 'healthy') {
    const issue = await adapter.findIssue(`<!-- haven-netlify-replay:${runId} -->`);
    const comments = await adapter.listComments(issue.number);
    ensure(issue.state === 'closed' && assigned(issue, repository.split('/')[0]) && comments.filter((c) => c.body.includes(':effect:failure:')).length === 2 && comments.some((c) => c.body.includes(':effect:recovery:')) && comments.some((c) => c.body.includes(':preview-ignore -->')), 'replay-readback');
    return { success: true, counts: [1, 1, 2], previewIgnored: true, issueNumber: issue.number };
  }
  const counts = [];
  const id = (n) => n.toString(16).padStart(24, '0');
  const make = (n) => ({ kind: 'failure', id: id(n), sha: 'a'.repeat(40), createdAt: utc(millis(now) - (4 - n) * 60_000), providerUpdatedAt: now, firstObservedTerminalAt: now, stage: 'unknown', providerState: 'error', subject: 'Synthetic lifecycle fixture', exactFailureTimeAvailable: false });
  const site = { id: SITE_ID };
  for (const event of [make(1), make(1), make(2)]) {
    const result = await reconcileEffects(reduceObservation(state, { deploys: [event], site, now, complete: true }), adapter);
    state = result.state;
    counts.push(event.id === id(1) ? 1 : state.failureIds.length);
  }
  ensure(counts.join(',') === '1,1,2', 'replay-count');
  const preview = classifyDeploy({
    site_id: SITE_ID, id: id(9), state: 'error', context: 'deploy-preview', branch: 'synthetic-preview',
    commit_ref: 'a'.repeat(40), draft: false, created_at: utc(millis(now) - 30_000), updated_at: now,
  }, { site: { id: SITE_ID, name: SITE_NAME, admin_url: ADMIN_URL },
    commit: { sha: 'a'.repeat(40), exists: true, onMain: false, message: 'Synthetic preview' }, now });
  ensure(preview.kind === 'ignored' && preview.reason === 'non-production', 'replay-preview-exclusion');
  const ignored = reduceObservation(state, { deploys: [preview], site, now, complete: true });
  ensure(ignored.effects.length === 0 && ignored.state.failureIds.length === 2 && ignored.state.phase === 'incident', 'replay-preview-mutation');
  state = (await reconcileEffects(ignored, adapter)).state;
  const previewMarker = `<!-- haven-netlify-replay:${runId}:preview-ignore -->`;
  if (!(await adapter.listComments(state.issueNumber)).some((comment) => comment.body?.includes(previewMarker))) {
    await adapter.createComment(state.issueNumber, { body: `${previewMarker}\nSynthetic deploy-preview failure exclusion verified; the production incident count remained 2.` });
  }
  const published = { ...make(3), kind: 'published', providerState: 'ready', createdAt: utc(millis(now) + 60_000), providerUpdatedAt: utc(millis(now) + 120_000), publishedAt: utc(millis(now) + 120_000) };
  const recovery = reduceObservation(state, { deploys: [published], site: { ...site, published_deploy: { id: published.id } }, now: utc(millis(now) + 180_000), complete: true });
  const done = await reconcileEffects(recovery, adapter);
  const issue = await adapter.getIssue(done.issueNumber);
  const comments = await adapter.listComments(done.issueNumber);
  ensure(issue.state === 'closed' && assigned(issue, repository.split('/')[0]) && comments.filter((c) => c.body.includes(':effect:failure:')).length === 2 && comments.some((c) => c.body.includes(':effect:recovery:')) && comments.some((c) => c.body.includes(':preview-ignore -->')), 'replay-readback');
  return { success: true, counts, previewIgnored: true, issueNumber: issue.number };
}
export async function finalizeReplay({ adapter, runId, outcome }) {
  ensure(/^\d+$/.test(runId), 'replay-identity');
  const marker = `<!-- haven-netlify-replay:${runId} -->`;
  const issue = await adapter.findIssue(marker);
  if (!issue || !issue.body?.includes(marker) || issue.body.includes('<!-- haven-netlify-production-alert -->') || !issue.title.startsWith('[SYNTHETIC]') || !labeled(issue, ['netlify-alert-synthetic'])) return;
  if (outcome === 'success') return;
  const key = `<!-- haven-netlify-replay:${runId}:cleanup-failure -->`;
  if (!(await adapter.listComments(issue.number)).some((c) => c.body?.includes(key))) await adapter.createComment(issue.number, { body: `${key}\nSynthetic replay failed. This closure is cleanup, not recovery proof.` });
  await adapter.updateIssue(issue.number, { state: 'closed' });
}

// Fetch is injectable for integration tests. HTTP status/body/headers never enter
// messages. Every API URL is built locally; provider-supplied URLs are ignored.
export function createTransport({ token, provider = 'github', fetchImpl = fetch, maxRequests = 500, deadline = Date.now() + 180_000 }) {
  ensure(typeof token === 'string' && token.length > 0, `${provider}-credential-missing`);
  const root = provider === 'github' ? 'https://api.github.com' : 'https://api.netlify.com/api/v1';
  const stats = { requests: 0, pages: 0, remaining: null, limit: null };
  const request = async (path, { method = 'GET', body } = {}) => {
    ensure(path.startsWith('/') && !path.startsWith('//'), 'request-path');
    ensure(++stats.requests <= maxRequests && Date.now() < deadline, 'request-budget');
    let response;
    try { response = await fetchImpl(root + path, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw fault(`${provider}-network`); }
    if (provider === 'github') {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const limit = response.headers.get('x-ratelimit-limit');
      if (remaining !== null && limit !== null) {
        stats.remaining = Number(remaining); stats.limit = Number(limit);
        ensure(stats.remaining > stats.limit * 0.2, 'github-quota-reserve');
      }
    }
    if (!response.ok) throw fault(response.status === 404 ? `${provider}-not-found` : response.status === 401 || response.status === 403 ? `${provider}-authorization` : response.status === 429 ? `${provider}-rate-limit` : `${provider}-http`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw fault(`${provider}-invalid-json`); }
  };
  const pages = async (path, field, maxPages = 100) => {
    const values = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      stats.pages++;
      const rows = field ? result[field] : result;
      ensure(Array.isArray(rows), 'pagination-shape');
      values.push(...rows);
      if (rows.length < 100) return values;
    }
    throw fault('pagination-bound');
  };
  return { request, pages, stats };
}

function trustedAuthor(value, repository) {
  const user = value?.user;
  return (user?.type === 'Bot' && user.login === 'github-actions[bot]') || (user?.type === 'User' && user.login?.toLowerCase() === repository.split('/')[0].toLowerCase());
}
export function createGithubAdapter({ transport, repository = REPOSITORY, marker, validatePublication = async () => false }) {
  ensure(REPO.test(repository), 'repository-identity');
  const root = `/repos/${repository}`;
  let cachedIssue;
  const getIssue = async (number) => {
    positiveInt(number);
    const issue = await transport.request(`${root}/issues/${number}`);
    ensure(issue.number === number && !issue.pull_request && trustedAuthor(issue, repository) && issue.body?.includes(marker), 'state-trusted-owner-identity');
    return issue;
  };
  const findIssue = async (expected = marker) => {
    ensure(expected === marker, 'state-marker-identity');
    // Issue-list search can lag immediately after creation. Once the exact
    // created issue is known, read it directly so delivery confirmation does
    // not depend on eventual list indexing.
    if (cachedIssue?.body?.includes(expected)) return getIssue(cachedIssue.number);
    const matches = (await transport.pages(`${root}/issues?state=all`)).filter((i) => !i.pull_request && trustedAuthor(i, repository) && i.body?.includes(expected));
    ensure(matches.length <= 1, 'state-duplicate-canonical-repair');
    cachedIssue = matches[0] ?? null;
    return cachedIssue;
  };
  const load = async () => {
    const issue = cachedIssue ? await getIssue(cachedIssue.number) : await findIssue();
    if (!issue) return null;
    ensure(issue.body?.includes(marker) && !issue.body.includes('<!-- haven-netlify-replay:') === !marker.includes('haven-netlify-replay:'), 'state-namespace-repair');
    ensure(issue.body.split(STATE_START).length === 2 && issue.body.split(STATE_END).length === 2, 'state-block-repair');
    let state;
    try { state = JSON.parse(issue.body.split(STATE_START)[1].split(STATE_END)[0]); } catch { throw fault('state-json-repair'); }
    validateState(state, { repository });
    ensure(`<!-- ${namespace(state)} -->` === marker, 'state-namespace-repair');
    return state;
  };
  const updateIssue = (number, patch) => transport.request(`${root}/issues/${number}`, { method: 'PATCH', body: patch });
  return { repository, clock: () => new Date().toISOString(), findIssue, getIssue, load,
    createIssue: async (value) => {
      // Read labels first; create them only when GitHub confirms they are absent.
      for (const name of [value.labels[0], `${value.labels[0]}-repeated`]) {
        try { await transport.request(`${root}/labels/${encodeURIComponent(name)}`); }
        catch (error) { if (error.category !== 'github-not-found') throw error; await transport.request(`${root}/labels`, { method: 'POST', body: { name, color: 'B60205' } }); }
      }
      cachedIssue = await transport.request(`${root}/issues`, { method: 'POST', body: value });
      return cachedIssue;
    },
    updateIssue,
    save: async (state) => {
      const issue = cachedIssue ? await getIssue(cachedIssue.number) : await findIssue();
      ensure(issue, 'state-issue-missing');
      const next = renderIncident(state);
      await updateIssue(issue.number, { body: replaceOwned(issue.body, next.body) });
      return state;
    },
    listComments: async (number) => (await transport.pages(`${root}/issues/${number}/comments`)).filter((comment) => trustedAuthor(comment, repository)),
    createComment: (number, body) => transport.request(`${root}/issues/${number}/comments`, { method: 'POST', body }),
    validatePublication,
  };
}

export async function collectProvider({ provider, github, state, now, repository = REPOSITORY }) {
  const site = await provider.request(`/sites/${SITE_ID}`);
  ensure(exactSite(site) && site.admin_url === ADMIN_URL && DEPLOY.test(site.published_deploy?.id ?? ''), 'provider-publication-missing');
  const baseline = await provider.request(`/sites/${SITE_ID}/deploys/${site.published_deploy.id}`);
  const bootstrap = state.discoveryBoundary === null;
  const cutoff = bootstrap ? -Infinity : millis(state.discoveryBoundary) - 10 * 60_000;
  const rows = new Map();
  let anchorFound = !state.discoveryAnchorId;
  let lastCreated = Infinity;
  let ordered = true;
  let exhausted = false;
  let baselineFound = false;
  let discoveryAnchorId;
  for (let page = 1; page <= 100; page++) {
    const values = await provider.request(`/sites/${SITE_ID}/deploys?production=true&branch=main&per_page=100&page=${page}`);
    ensure(Array.isArray(values), 'provider-pagination-shape');
    for (const record of values) {
      ensure(DEPLOY.test(record.id ?? '') && instant(record.created_at, now), 'provider-discovery-identity');
      discoveryAnchorId ??= record.id;
      if (record.id === baseline.id) baselineFound = true;
      if (record.id === state.discoveryAnchorId) anchorFound = true;
      const created = millis(record.created_at);
      if (created > lastCreated) ordered = false;
      lastCreated = created;
      if (rows.has(record.id)) ensure(JSON.stringify(rows.get(record.id)) === JSON.stringify(record), 'provider-conflicting-records');
      rows.set(record.id, record);
    }
    if (values.length < 100) { exhausted = true; break; }
    // Bootstrap needs the complete unresolved window, not the site's lifetime
    // history. The current published deploy is the recovery baseline; anything
    // older is already superseded by that verified publication.
    if (bootstrap && baselineFound && ordered) { exhausted = true; break; }
    // Netlify returns newest-created deployments first. Validate that ordering
    // through the retained anchor and ten-minute overlap; observed disorder
    // disables the early exit and requires API exhaustion instead.
    if (!bootstrap && state.discoveryAnchorId && anchorFound && ordered && lastCreated < cutoff) { exhausted = true; break; }
  }
  ensure(exhausted && anchorFound && (!bootstrap || baselineFound), 'provider-discovery-boundary-incomplete');
  const pendingIds = new Set(state.pendingDeploys.map((pending) => pending.id));
  for (const pending of state.pendingDeploys) {
    // Re-read retained IDs independently of the discovery window, including
    // attempts created before activation that finish weeks later.
    rows.set(pending.id, await provider.request(`/sites/${SITE_ID}/deploys/${pending.id}`));
  }
  rows.set(baseline.id, baseline);
  const commits = new Map();
  const deploys = [];
  for (const record of rows.values()) {
    const isBaseline = record.id === baseline.id;
    const isPending = PENDING_STATES.has(record.state);
    if (!isBaseline && (state.seenFailureIds.includes(record.id) || state.historicalExcludedIds.includes(record.id)) && record.state === 'error') continue;
    if (!isBaseline && !pendingIds.has(record.id)) {
      // Completed historical records cannot become newly failed. Their SHA does
      // not need a GitHub lookup. Bootstrap still enumerates all metadata so no
      // older unfinished attempt is lost.
      if (bootstrap && !isPending && millis(record.created_at) < millis(baseline.created_at)) {
        if (record.state === 'error' && record.skipped !== true && record.superseded !== true && record.context === 'production' && record.branch === 'main') {
          deploys.push({ kind: 'historical-failure', id: record.id, createdAt: instant(record.created_at, now) });
        }
        continue;
      }
      if (record.state === 'ready') continue;
    }
    let commit;
    if (record.site_id === SITE_ID && record.context === 'production' && record.branch === 'main' && SHA.test(record.commit_ref ?? '') && !record.draft && !record.skipped && !record.superseded && !['canceled', 'cancelled', 'skipped'].includes(record.state)) {
      if (!commits.has(record.commit_ref)) {
        ensure(commits.size < 100, 'provider-commit-verification-budget');
        const value = await github.request(`/repos/${repository}/commits/${record.commit_ref}`);
        const comparison = await github.request(`/repos/${repository}/compare/${record.commit_ref}...main`);
        commits.set(record.commit_ref, { sha: value.sha, exists: value.sha === record.commit_ref, onMain: ['ahead', 'identical'].includes(comparison.status) && comparison.base_commit?.sha === record.commit_ref, message: value.commit?.message });
      }
      commit = commits.get(record.commit_ref);
    }
    deploys.push(classifyDeploy(record, { site, commit, now }));
  }
  const freshSite = await provider.request(`/sites/${SITE_ID}`);
  ensure(exactSite(freshSite) && freshSite.admin_url === ADMIN_URL && freshSite.published_deploy?.id === baseline.id, 'provider-publication-churn');
  return { deploys, site: freshSite, now, complete: true, bootstrap, discoveryAnchorId: discoveryAnchorId ?? baseline.id };
}

async function observeOnce({ provider, github, adapter, now }) {
  const saved = await adapter.load() ?? initialState({ now, repository: REPOSITORY });
  // The observer reads consumption acknowledgements but never writes health.
  // Keep unconsumed events across artifact expiry and workflow replacement.
  const healthReader = createGithubAdapter({ transport: github, marker: '<!-- haven-netlify-observer-health -->' });
  const health = await healthReader.load();
  if (health?.deliveryComplete) saved.healthEvents = saved.healthEvents.filter((event) => !health.consumedHealthEvents?.includes(event.key));
  const plan = reduceObservation(saved, await collectProvider({ provider, github, state: saved, now }));
  ensure(plan.coverageComplete, plan.reason);
  const tuple = `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`;
  ensure(/^\d+:\d+$/.test(tuple), 'run-identity');
  const previousAt = saved.lastSuccessfulObservationAt;
  if (previousAt && millis(now) - millis(previousAt) > 15 * 60_000) plan.state.healthEvents.push({ key: `coverage-gap:${saved.generation}:${tuple}`, type: 'gap', at: now, previousAt, tuple, sha: process.env.GITHUB_SHA });
  ensure(SHA.test(process.env.GITHUB_SHA ?? ''), 'run-sha');
  plan.state.healthEvents.push({ key: `observation-recovery:${plan.state.generation}`, type: 'complete', at: now, tuple, sha: process.env.GITHUB_SHA });
  const result = await reconcileEffects(plan, adapter);
  return { ...result, observedDeploys: plan.state.pendingDeploys.length, requests: github.stats.requests + provider.stats.requests };
}

async function collectRuns({ github, state, source, workflowId, now, notification }) {
  const planned = planRunAudit(state, { source, now });
  const root = `/repos/${REPOSITORY}/actions`;
  const records = new Map();
  for (const query of planned.queries) {
    const params = new URLSearchParams({ branch: 'main', created: query.created });
    const runs = await github.pages(`${root}/workflows/${workflowId}/runs?${params}`, 'workflow_runs', 10);
    for (const run of runs) records.set(run.id, run);
  }
  for (const id of new Set([...planned.pendingRunIds, ...(Number.isSafeInteger(notification) ? [notification] : [])])) records.set(id, await github.request(`${root}/runs/${id}`));
  const attempts = [];
  for (const run of records.values()) {
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      if (state.audit[source]?.consumed[`${run.id}:${attempt}`]) continue;
      const value = attempt === run.run_attempt ? run : await github.request(`${root}/runs/${run.id}/attempts/${attempt}`);
      if (source === 'observer' && value.event === 'workflow_dispatch') {
        const jobs = await github.pages(`${root}/runs/${run.id}/attempts/${attempt}/jobs`, 'jobs', 10);
        const replay = jobs.find((j) => j.name === 'Synthetic lifecycle replay' && j.conclusion !== 'skipped');
        const live = jobs.find((j) => j.name === 'Observe production' && j.conclusion !== 'skipped');
        if (replay && !live) value.verifiedMode = 'replay';
        if (live && !replay) value.verifiedMode = 'observe';
      }
      attempts.push(value);
      if (attempt === run.run_attempt) records.set(run.id, value);
    }
  }
  return { planned, runs: [...records.values()], attempts };
}

async function watch(source, github) {
  if (source === 'main-ci') return legacyMainCi(github);
  const workflowName = source === 'observer' ? 'netlify-production-failure-alert.yml' : 'ci-gates.yml';
  const workflow = await github.request(`/repos/${REPOSITORY}/actions/workflows/${workflowName}`);
  const marker = `<!-- ${source === 'observer' ? 'haven-netlify-observer-health' : 'haven-main-ci-alert'} -->`;
  let adapter;
  let validationState;
  const now = new Date().toISOString();
  const refresh = async () => {
    // A final unfiltered recent sweep catches newer failed attempts before close.
    const rows = await github.pages(`/repos/${REPOSITORY}/actions/workflows/${workflow.id}/runs?branch=main&created=${encodeURIComponent(`${validationState.audit[source].boundary}..${new Date().toISOString()}`)}`, 'workflow_runs', 10);
    return rows.every((r) => r.status === 'completed' && !failureOutcomes.has(r.conclusion));
  };
  adapter = createGithubAdapter({ transport: github, marker, validatePublication: refresh });
  const state = await adapter.load() ?? { ...initialState({ now, repository: REPOSITORY }), source };
  let event;
  if (process.env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const notification = event?.workflow_run?.workflow_id === workflow.id ? event.workflow_run.id : undefined;
  const { planned, runs, attempts } = await collectRuns({ github, state, source, workflowId: workflow.id, now, notification });
  let providerState;
  if (source === 'observer') {
    const readOnly = createGithubAdapter({ transport: github, marker: '<!-- haven-netlify-production-alert -->' });
    providerState = await readOnly.load();
    for (const r of [...runs, ...attempts]) r.observationComplete = providerState?.deliveryComplete === true && providerState.healthEvents.some((e) => e.type === 'complete' && e.tuple === `${r.id}:${r.run_attempt}` && e.sha === r.head_sha && millis(e.at) <= millis(r.updated_at));
  }
  const fullAudit = (state.audit[source]?.nextShard ?? 0) === 27;
  const audited = reduceRunAudit(state, { source, workflowId: workflow.id, repository: REPOSITORY, now, runs, attempts, events: providerState?.deliveryComplete ? providerState.healthEvents : [], complete: true, completedShards: planned.shards, auditComplete: fullAudit });
  // Completed partitions persist even when a previous full audit is stale.
  // Staleness blocks recovery, not the progress needed to restore coverage.
  ensure(audited.progressComplete, audited.reason);
  const next = audited.state;
  next.source = source;
  if (!audited.coverageComplete) {
    next.pendingEffects = next.pendingEffects.filter((effect) => effect.type !== 'recovery');
    if (next.phase === 'recovering') next.phase = 'incident';
  }
  for (const effect of audited.effects) {
    if (effect.type === 'failure') {
      if (next.failureIds.includes(effect.key)) continue;
      if (next.phase === 'healthy') { next.failureIds = []; next.failures = []; }
      next.phase = 'incident'; next.failureIds.push(effect.key); next.failures.push(effect.event); effect.count = next.failureIds.length;
    } else next.phase = 'recovering';
  }
  if (next.phase === 'initializing' && fullAudit) next.phase = 'healthy';
  next.pendingEffects = [...next.pendingEffects, ...audited.effects.filter((e) => !next.pendingEffects.some((p) => p.key === e.key))];
  next.generation++;
  next.pendingObservedAt = now;
  next.pendingDiscoveryBoundary = now;
  validationState = next;
  return reconcileEffects({ state: next, effects: audited.effects, coverageComplete: true }, adapter);
}

// Compatibility lane: main CI retains its existing active-issue convention.
// Historical issues are not imported into the observer's versioned ledger.
// Completion events and explicit run-id notifications trigger this lane;
// only observer health uses historical catch-up.
export async function resolveMainCiNotification({ eventName, event, github, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (eventName === 'workflow_run') return event.workflow_run;
  if (eventName !== 'workflow_dispatch' || !event.inputs?.primary_run_id) return null;
  const id = Number(event.inputs.primary_run_id);
  ensure(/^[1-9][0-9]*$/.test(event.inputs.primary_run_id) && Number.isSafeInteger(id), 'main-ci-notification-id');
  // The terminal job notifies just before its own workflow becomes complete.
  // Poll only that run; never manufacture a healthy result for unfinished CI.
  for (let poll = 0; poll < 10; poll++) {
    const run = await github.request(`/repos/${REPOSITORY}/actions/runs/${id}`);
    ensure(run.id === id, 'main-ci-notification-run');
    if (run.status === 'completed') return run;
    if (poll < 9) await pause(2000);
  }
  throw fault('main-ci-notification-incomplete');
}

async function legacyMainCi(github) {
  if (!['workflow_run', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) return { unchanged: true };
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const input = await resolveMainCiNotification({ eventName: process.env.GITHUB_EVENT_NAME, event, github });
  if (!input) return { unchanged: true };
  const root = `/repos/${REPOSITORY}`;
  const workflow = await github.request(`${root}/actions/workflows/ci-gates.yml`);
  if (input?.workflow_id !== workflow.id || input.head_branch !== 'main') {
    ensure(process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch', 'main-ci-notification-source');
    return { unchanged: true };
  }
  const run = await github.request(`${root}/actions/runs/${input.id}/attempts/${input.run_attempt}`);
  ensure(normalizeRun(run, { source: 'main-ci', workflowId: workflow.id, repository: REPOSITORY, now: new Date().toISOString() }), 'main-ci-source');
  if (run.status !== 'completed' || (!failureOutcomes.has(run.conclusion) && run.conclusion !== 'success') || run.conclusion === 'cancelled') return { unchanged: true };
  const marker = '<!-- haven-main-ci-alert -->';
  const open = (await github.pages(`${root}/issues?state=open`)).filter((issue) => !issue.pull_request && trustedAuthor(issue, REPOSITORY) && issue.body?.includes(marker));
  ensure(open.length <= 1, 'main-ci-duplicate-active');
  let issue = open[0];
  const effectMarker = `<!-- haven-main-ci-attempt:${run.id}:${run.run_attempt} -->`;
  const occurrence = describe({ runId: run.id, attempt: run.run_attempt, repository: REPOSITORY, sha: run.head_sha, providerUpdatedAt: instant(run.updated_at), category: run.conclusion === 'success' ? 'workflow-success' : 'workflow-failure' });
  const owner = REPOSITORY.split('/')[0];
  if (run.conclusion === 'success') {
    if (!issue || millis(run.updated_at) <= millis(issue.created_at)) return { unchanged: true };
    const lastAt = issue.body.match(/<!-- haven-main-ci-latest:(.*?) -->/)?.[1];
    if (lastAt && millis(run.updated_at) <= millis(lastAt)) return { unchanged: true };
    const comments = (await github.pages(`${root}/issues/${issue.number}/comments`)).filter((comment) => trustedAuthor(comment, REPOSITORY));
    if (!comments.some((c) => c.body?.includes(effectMarker))) await github.request(`${root}/issues/${issue.number}/comments`, { method: 'POST', body: { body: `${effectMarker}\nRecovered: required main CI passed.\n\n${occurrence}` } });
    await github.request(`${root}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } });
    return { issueNumber: issue.number };
  }
  const comments = issue ? (await github.pages(`${root}/issues/${issue.number}/comments`)).filter((comment) => trustedAuthor(comment, REPOSITORY)) : [];
  if (issue?.body.includes(effectMarker) || comments.some((c) => c.body?.includes(effectMarker))) return { issueNumber: issue.number };
  const previousCount = Number(issue?.body.match(/<!-- haven-main-ci-alert-count:(\d+) -->/)?.[1] ?? 0);
  ensure(Number.isSafeInteger(previousCount) && previousCount < 200, 'main-ci-count-bound');
  const count = previousCount + 1;
  const labels = ['main-ci-failure', ...(count > 1 ? ['main-ci-failure-repeated'] : [])];
  for (const name of labels) {
    try { await github.request(`${root}/labels/${name}`); }
    catch (error) { if (error.category !== 'github-not-found') throw error; await github.request(`${root}/labels`, { method: 'POST', body: { name, color: 'B60205' } }); }
  }
  const title = count > 1 ? `[Main CI] repeated production verification failure (${count})` : '[Main CI] production verification failed';
  const latest = `## Latest failure\n\n${effectMarker}\n<!-- haven-main-ci-latest:${instant(run.updated_at)} -->\n${occurrence}`;
  const body = issue ? issue.body.replace(/<!-- haven-main-ci-alert-count:\d+ -->/, `<!-- haven-main-ci-alert-count:${count} -->`).replace(/## Latest failure[\s\S]*$/, latest) : `${marker}\n<!-- haven-main-ci-alert-count:${count} -->\nA required production verification run failed after merge. This issue blocks subsequent technical release claims until a later main run passes. Reopen the related Linear delivery issue when applicable.\n\n${latest}`;
  if (issue) issue = await github.request(`${root}/issues/${issue.number}`, { method: 'PATCH', body: { title, body, labels, assignees: [owner] } });
  else issue = await github.request(`${root}/issues`, { method: 'POST', body: { title, body, labels, assignees: [owner] } });
  await github.request(`${root}/issues/${issue.number}/comments`, { method: 'POST', body: { body: `${effectMarker}\nConsecutive failure ${count}.\n\n${occurrence}` } });
  const confirmed = await github.request(`${root}/issues/${issue.number}`);
  ensure(assigned(confirmed, owner) && labeled(confirmed, labels), 'main-ci-assignment-readback');
  return { issueNumber: issue.number };
}

export async function main(argv = process.argv.slice(2)) {
  const [mode, source] = argv;
  ensure(['observe', 'replay', 'finalize-replay', 'watch'].includes(mode), 'command');
  ensure(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === 'refs/heads/main', 'trusted-main-only');
  const github = createTransport({ token: process.env.GITHUB_TOKEN, maxRequests: mode === 'watch' ? 50 : 1000 });
  const now = new Date().toISOString();
  let result;
  if (mode === 'watch') {
    ensure(['observer', 'main-ci'].includes(source), 'watch-source');
    result = await watch(source, github);
  } else if (mode === 'replay' || mode === 'finalize-replay') {
    ensure(!process.env.NETLIFY_AUTH_TOKEN, 'replay-provider-credential-forbidden');
    const runId = process.env.GITHUB_RUN_ID;
    ensure(/^\d+$/.test(runId ?? ''), 'replay-identity');
    const adapter = createGithubAdapter({ transport: github, marker: `<!-- haven-netlify-replay:${runId} -->`, validatePublication: async () => true });
    result = mode === 'replay' ? await replayLifecycle({ adapter, runId, now }) : await finalizeReplay({ adapter, runId, outcome: process.env.REPLAY_OUTCOME });
  } else {
    // A main push gets one immediate observation. The five-minute schedule owns
    // follow-up reconciliation so a single workflow cannot exhaust provider
    // quota while a normal production build is still pending.
    const provider = createTransport({ token: process.env.NETLIFY_AUTH_TOKEN, provider: 'netlify' });
    const passGithub = createTransport({ token: process.env.GITHUB_TOKEN, maxRequests: 1000 });
    const adapter = createGithubAdapter({ transport: passGithub, marker: '<!-- haven-netlify-production-alert -->', validatePublication: async (effect, state) => {
      const fresh = await collectProvider({ provider, github: passGithub, state, now: new Date().toISOString() });
      return fresh.site.published_deploy?.id === effect.deployId && fresh.deploys.every((d) => d.kind !== 'invalid' && (d.kind !== 'failure' || state.seenFailureIds.includes(d.id) || state.historicalExcludedIds.includes(d.id))) && fresh.deploys.some((d) => d.kind === 'published' && d.id === effect.deployId);
    } });
    result = await observeOnce({ provider, github: passGithub, adapter, now: new Date().toISOString() });
    github.stats.requests += passGithub.stats.requests;
  }
  const summary = { outcome: 'complete', mode, source: source ?? null, issueNumber: result?.issueNumber ?? null,
    ...(result?.previewIgnored === true ? { previewIgnored: true } : {}), requests: github.stats.requests, remaining: github.stats.remaining };
  console.log(JSON.stringify(summary));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${JSON.stringify(summary)}\n\`\`\`\n`);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  const category = typeof error.category === 'string' && /^[a-z0-9-]{1,80}$/.test(error.category) ? error.category : 'observer-unexpected-failure';
  console.error(JSON.stringify({ outcome: 'incomplete', category }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nObservation incomplete: ${category}. No complete-coverage claim.\n`);
  process.exitCode = 1;
});
