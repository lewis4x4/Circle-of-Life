// Local-only production-component proof against explicitly synthetic adapters.
// Start preview.mjs first. This runner refuses external network access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const origin = 'http://127.0.0.1:8948';
const output = path.resolve('docs/workforce/evidence');
const browser = await chromium.launch({ headless: true });
const errors = [];
const externalRequests = [];
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) await route.continue();
    else { externalRequests.push(url.origin); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?view=schedule`);
  await page.getByRole('heading', { name: 'Schedule', exact: true }).waitFor();
  const offName = /Synthetic Person A, Wed, Sep 30: Off/;
  const dayName = /Synthetic Person A, Wed, Sep 30: Day 6:00a–6:00p/;
  await page.getByRole('button', { name: offName }).waitFor();
  await page.getByRole('button', { name: offName }).click();
  await page.getByRole('button', { name: dayName }).waitFor();
  assert(await page.getByRole('button', { name: 'Publish week', exact: true }).isDisabled());
  await page.getByRole('button', { name: dayName }).click();
  const night = page.getByRole('button', { name: /Synthetic Person A, Wed, Sep 30: Night 6:00p–6:00a \(\+1 day\)/ });
  await night.waitFor();
  await night.click();
  await page.getByRole('button', { name: offName }).waitFor();
  assert.equal(await page.getByText('1 unsaved cell change.', { exact: true }).count(), 0);
  checks.push('Real grid cycled Off → configured Day → configured Night → Off and removed the no-op change.');
  await page.getByRole('button', { name: offName }).click();
  await page.getByRole('button', { name: 'Save 1 changes', exact: true }).click();
  await page.getByText('Draft saved.', { exact: true }).waitFor();
  const saved = await page.evaluate(() => window.__syntheticScheduleProof());
  const call = saved.calls.find((item) => item.name === 'schedule_bulk_upsert');
  assert.deepEqual(call.args.p_cells, [{ staff_id: 'sample-a', shift_date: '2026-09-30', shift_definition_id: 'synthetic-day' }]);
  const assignment = saved.assignments.find((item) => item.staff_id === 'sample-a' && item.shift_date === '2026-09-30');
  assert.equal(assignment.custom_start_time, '06:00:00');
  assert.equal(assignment.custom_end_time, '18:00:00');
  assert.equal(await page.getByRole('button', { name: 'Save draft', exact: true }).isDisabled(), true);
  checks.push('Save submitted the configured shift ID to the fixture RPC; reload displayed its saved 06:00–18:00 times.');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, 'schedule-desktop.png'), fullPage: true, animations: 'disabled' });
  const desktopAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await page.getByRole('button', { name: 'Publish week', exact: true }).click();
  await page.getByText('Published. Assigned staff can now see this week in My schedule.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Publish week', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: dayName }).isDisabled(), true);
  const posted = await page.evaluate(() => window.__syntheticScheduleProof());
  assert.equal(posted.schedule.status, 'published');
  assert.equal(posted.calls.filter((item) => item.name === 'schedule_publish').length, 1);
  checks.push('Publishing the synthetic week refreshed the actual component into read-only mode with edit/publish controls removed.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Synthetic Person A, Mon, Sep 28: Day/ }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.locator('table').evaluate((table) => ({
    pageWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    gridWidth: table.parentElement.clientWidth,
    gridScrollWidth: table.parentElement.scrollWidth,
  }));
  assert(layout.documentScrollWidth <= layout.pageWidth, 'The phone page must not overflow horizontally');
  assert(layout.gridScrollWidth > layout.gridWidth, 'The seven-day grid must retain its scrollable columns');
  await page.screenshot({ path: path.join(output, 'schedule-phone.png'), fullPage: true, animations: 'disabled' });
  const phoneAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  checks.push('390px phone viewport kept page width contained while the seven-day table remained horizontally scrollable.');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(externalRequests.length, 0, 'Fixture attempted an external request');
  const violations = [...desktopAxe.violations, ...phoneAxe.violations].map(({ id, impact, description, nodes }) => ({ id, impact, description, affectedNodes: nodes.length }));
  await fs.writeFile(path.join(output, 'schedule-browser.json'), JSON.stringify({
    checked_at: new Date().toISOString(),
    scope: 'Synthetic local Supabase/route/shell adapters; actual Schedule component, Workforce context, and production CSS. Not hosted authentication, database, notification, or staff acceptance.',
    actual_component: 'src/app/(admin)/schedules/[id]/page.tsx',
    screenshots: { desktop: { file: 'schedule-desktop.png', viewport: '1440×1000', state: 'Draft after a configured Day shift was saved' }, phone: { file: 'schedule-phone.png', viewport: '390×844', state: 'Published, read only' } },
    checks, phone_layout: layout, page_errors: errors, external_requests: externalRequests,
    accessibility: { standard: 'WCAG 2 A/AA + 2.1 AA', desktop_violations: desktopAxe.violations.length, phone_violations: phoneAxe.violations.length, violations },
    production_mutations: false,
  }, null, 2));
  assert.equal(violations.length, 0, JSON.stringify(violations));
  console.log(`PASS Schedule synthetic browser proof: ${checks.length} interaction/layout checks; desktop + phone screenshots; zero page errors, external requests, or axe violations.`);
} finally { await browser.close(); }
